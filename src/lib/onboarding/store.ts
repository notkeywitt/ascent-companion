/**
 * New-hire paperwork — the companion DB reads and writes, and the two roster
 * calls (the Employee tab, through Apps Script).
 *
 * SERVER ONLY. Tables: `onboarding_forms`, `onboarding_intakes`,
 * `onboarding_submissions` (schema.ts carries what each holds).
 *
 * The Employee tab stays the roster's source of truth: an invite adds the
 * row there, the profile step writes the new hire's own values onto it, and
 * this DB keeps only what the roster has no column for (the address in parts,
 * the emergency contact) plus the forms.
 */
import { and, asc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { onboardingForms, onboardingIntakes, onboardingSubmissions } from "@/db/schema";
import { callAppsScript } from "@/lib/appsScript";

import { cleanProfile, rosterAddress, usDate, type FieldConfig, type Profile } from "./fields";

const now = () => new Date().toISOString();

function parseFields(s: string): FieldConfig[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as FieldConfig[]) : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ forms */

export interface FormSummary {
  id: number;
  name: string;
  fileName: string;
  pages: number;
  sort: number;
  active: boolean;
  fields: FieldConfig[];
  updatedAt: string;
}

const summaryCols = {
  id: onboardingForms.id,
  name: onboardingForms.name,
  fileName: onboardingForms.fileName,
  pages: onboardingForms.pages,
  sort: onboardingForms.sort,
  active: onboardingForms.active,
  fields: onboardingForms.fields,
  updatedAt: onboardingForms.updatedAt,
};

type SummaryRow = { [K in keyof typeof summaryCols]: (typeof onboardingForms.$inferSelect)[K] };

function toSummary(r: SummaryRow): FormSummary {
  return { ...r, active: r.active === 1, fields: parseFields(r.fields) };
}

/** Every form (no PDF bytes), in the office's order. */
export async function listForms(onlyActive = false): Promise<FormSummary[]> {
  await ensureDb();
  const rows = await db
    .select(summaryCols)
    .from(onboardingForms)
    .where(onlyActive ? eq(onboardingForms.active, 1) : undefined)
    .orderBy(asc(onboardingForms.sort), asc(onboardingForms.id));
  return rows.map(toSummary);
}

export async function getFormPdf(id: number): Promise<{ form: FormSummary; bytes: Uint8Array } | null> {
  await ensureDb();
  const rows = await db.select().from(onboardingForms).where(eq(onboardingForms.id, id)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return { form: toSummary(r), bytes: new Uint8Array(r.bytes) };
}

export async function createForm(input: {
  name: string;
  fileName: string;
  bytes: Uint8Array;
  fields: FieldConfig[];
  pages: number;
  by: string;
}): Promise<number> {
  await ensureDb();
  const last = await listForms();
  const sort = last.length ? Math.max(...last.map((f) => f.sort)) + 1 : 0;
  const at = now();
  const res = await db
    .insert(onboardingForms)
    .values({
      name: input.name,
      fileName: input.fileName,
      bytes: Buffer.from(input.bytes),
      fields: JSON.stringify(input.fields),
      pages: input.pages,
      sort,
      active: 1,
      createdAt: at,
      createdBy: input.by,
      updatedAt: at,
    })
    .returning({ id: onboardingForms.id });
  return res[0].id;
}

export async function updateForm(
  id: number,
  patch: { name?: string; fields?: FieldConfig[]; active?: boolean; sort?: number },
): Promise<void> {
  await ensureDb();
  const set: Partial<typeof onboardingForms.$inferInsert> = { updatedAt: now() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.fields !== undefined) set.fields = JSON.stringify(patch.fields);
  if (patch.active !== undefined) set.active = patch.active ? 1 : 0;
  if (patch.sort !== undefined) set.sort = patch.sort;
  await db.update(onboardingForms).set(set).where(eq(onboardingForms.id, id));
}

/** Move a form one place up or down the list. */
export async function moveForm(id: number, dir: -1 | 1): Promise<void> {
  const forms = await listForms();
  const i = forms.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= forms.length) return;
  [forms[i], forms[j]] = [forms[j], forms[i]];
  for (let k = 0; k < forms.length; k++) {
    if (forms[k].sort !== k) await updateForm(forms[k].id, { sort: k });
  }
}

/** Remove a blank form. Filled copies already submitted keep their own PDF. */
export async function deleteForm(id: number): Promise<void> {
  await ensureDb();
  await db.delete(onboardingForms).where(eq(onboardingForms.id, id));
}

/* ---------------------------------------------------------------- intakes */

export type IntakeRow = typeof onboardingIntakes.$inferSelect;

export interface Intake extends Omit<IntakeRow, "profile"> {
  profile: Profile;
}

function toIntake(r: IntakeRow): Intake {
  let p: unknown = {};
  try {
    p = JSON.parse(r.profile);
  } catch {
    /* an unreadable profile is an empty one */
  }
  const profile = cleanProfile(p);
  if (!profile.firstName) profile.firstName = r.firstName;
  if (!profile.lastName) profile.lastName = r.lastName;
  if (!profile.email) profile.email = r.email;
  return { ...r, profile };
}

export async function getIntake(email: string): Promise<Intake | null> {
  await ensureDb();
  const rows = await db
    .select()
    .from(onboardingIntakes)
    .where(eq(onboardingIntakes.email, email.trim().toLowerCase()))
    .limit(1);
  return rows[0] ? toIntake(rows[0]) : null;
}

export async function listIntakes(): Promise<Intake[]> {
  await ensureDb();
  const rows = await db.select().from(onboardingIntakes);
  return rows.map(toIntake).sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));
}

export async function createIntake(row: {
  email: string;
  firstName: string;
  lastName: string;
  position: string;
  hireDate: string;
  employeeId: string;
  by: string;
}): Promise<void> {
  await ensureDb();
  await db
    .insert(onboardingIntakes)
    .values({
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      position: row.position,
      hireDate: row.hireDate,
      employeeId: row.employeeId,
      invitedAt: now(),
      invitedBy: row.by,
    })
    .onConflictDoUpdate({
      target: onboardingIntakes.email,
      // A re-invite re-opens the paperwork; the profile already given stays.
      set: {
        firstName: row.firstName,
        lastName: row.lastName,
        position: row.position,
        hireDate: row.hireDate,
        employeeId: row.employeeId,
        invitedBy: row.by,
        sentAt: null,
        sentBy: "",
      },
    });
}

export async function saveIntakeProfile(email: string, profile: Profile): Promise<void> {
  await ensureDb();
  await db
    .update(onboardingIntakes)
    .set({
      profile: JSON.stringify(profile),
      profileAt: now(),
      firstName: profile.firstName,
      lastName: profile.lastName,
    })
    .where(eq(onboardingIntakes.email, email));
}

/** "Sent to bookkeeper": stamp it, and delete the filled PDFs (they hold SSNs). */
export async function markIntakeSent(email: string, by: string): Promise<void> {
  await ensureDb();
  await db.delete(onboardingSubmissions).where(eq(onboardingSubmissions.email, email));
  await db.update(onboardingIntakes).set({ sentAt: now(), sentBy: by }).where(eq(onboardingIntakes.email, email));
}

/** Remove a new hire's paperwork entirely. The roster row and sign-in stay. */
export async function deleteIntake(email: string): Promise<void> {
  await ensureDb();
  await db.delete(onboardingSubmissions).where(eq(onboardingSubmissions.email, email));
  await db.delete(onboardingIntakes).where(eq(onboardingIntakes.email, email));
}

/* ------------------------------------------------------------ submissions */

export interface SubmissionMeta {
  email: string;
  formId: number;
  formName: string;
  signedName: string;
  submittedAt: string;
}

const metaCols = {
  email: onboardingSubmissions.email,
  formId: onboardingSubmissions.formId,
  formName: onboardingSubmissions.formName,
  signedName: onboardingSubmissions.signedName,
  submittedAt: onboardingSubmissions.submittedAt,
};

export async function listSubmissions(email?: string): Promise<SubmissionMeta[]> {
  await ensureDb();
  return db
    .select(metaCols)
    .from(onboardingSubmissions)
    .where(email ? eq(onboardingSubmissions.email, email) : undefined);
}

export async function getSubmissionPdf(email: string, formId: number): Promise<{ meta: SubmissionMeta; bytes: Uint8Array } | null> {
  await ensureDb();
  const rows = await db
    .select()
    .from(onboardingSubmissions)
    .where(and(eq(onboardingSubmissions.email, email), eq(onboardingSubmissions.formId, formId)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  const { bytes, ...rest } = r;
  return {
    meta: { email: rest.email, formId: rest.formId, formName: rest.formName, signedName: rest.signedName, submittedAt: rest.submittedAt },
    bytes: new Uint8Array(bytes),
  };
}

export async function saveSubmission(row: {
  email: string;
  formId: number;
  formName: string;
  bytes: Uint8Array;
  signedName: string;
  ip: string;
}): Promise<void> {
  await ensureDb();
  const values = { ...row, bytes: Buffer.from(row.bytes), submittedAt: now() };
  await db
    .insert(onboardingSubmissions)
    .values(values)
    .onConflictDoUpdate({
      target: [onboardingSubmissions.email, onboardingSubmissions.formId],
      set: { formName: values.formName, bytes: values.bytes, signedName: values.signedName, submittedAt: values.submittedAt, ip: values.ip },
    });
}

/** Reopen one form for the new hire: the filled copy is deleted. */
export async function deleteSubmission(email: string, formId: number): Promise<void> {
  await ensureDb();
  await db
    .delete(onboardingSubmissions)
    .where(and(eq(onboardingSubmissions.email, email), eq(onboardingSubmissions.formId, formId)));
}

/* ----------------------------------------------------------------- roster */

export interface RosterEmployee {
  id: string;
  firstName: string;
  lastName: string;
  position: string;
  hireDate: string;
  status: string;
  email: string;
}

/** The Employee tab row for this email, or null. Throws when the roster cannot be read. */
export async function findRosterByEmail(email: string): Promise<RosterEmployee | null> {
  const r = await callAppsScript<{ ok?: boolean; error?: string; employees?: RosterEmployee[] }>({
    action: "listEmployeesFull",
  });
  if (r.error || r.data?.ok === false) throw new Error(r.error ?? r.data?.error ?? "Could not read the roster.");
  const want = email.trim().toLowerCase();
  return (r.data?.employees ?? []).find((e) => (e.email ?? "").trim().toLowerCase() === want) ?? null;
}

/** Add the Employee tab row. Returns its new Employee ID. */
export async function addRosterEmployee(fields: {
  firstName: string;
  lastName: string;
  email: string;
  position: string;
  hireDate: string;
}): Promise<string> {
  const r = await callAppsScript<{ ok?: boolean; error?: string; employee?: { id: string } }>({
    action: "addEmployee",
    fields: { ...fields, status: "Active" },
  });
  if (r.error || r.data?.ok === false || !r.data?.employee?.id) {
    throw new Error(r.error ?? r.data?.error ?? "Could not add the roster row.");
  }
  return r.data.employee.id;
}

/** Write the profile step's values onto the new hire's own roster row. */
export async function writeProfileToRoster(employeeId: string, p: Profile): Promise<void> {
  const r = await callAppsScript<{ ok?: boolean; error?: string }>({
    action: "updateEmployee",
    id: employeeId,
    fields: {
      firstName: p.firstName,
      lastName: p.lastName,
      phone: p.phone,
      address: rosterAddress(p),
      birthday: usDate(p.birthday),
      dl: p.dl,
    },
  });
  if (r.error || r.data?.ok === false) throw new Error(r.error ?? r.data?.error ?? "Could not update the roster.");
}
