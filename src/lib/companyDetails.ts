/**
 * Ascent's own details and documents — the DB half. SERVER ONLY.
 * Tables: `company_details`, `company_documents` (src/db/schema.ts).
 *
 * The details began as the Project Database's "Details" tab. `readDetails`
 * copies that tab in ONCE, the first time the table has no rows, through the
 * read-only `chatRecords` action (record "details"). After that the table is
 * the source of truth and nothing here writes the sheet back.
 */
import { desc, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { companyDetails, companyDocuments } from "@/db/schema";
import { appsScriptConfigured, callAppsScript } from "@/lib/appsScript";
import { DETAIL_FIELDS, EMPTY_DETAILS, type DetailKey, type DetailValues } from "@/lib/companyDetailsRules";

export interface DetailsState {
  values: DetailValues;
  updatedAt: string;
  updatedBy: string;
}

/** The sheet's column header for each key — what `chatRecords` returns. */
const SHEET_COLUMN: Record<DetailKey, string> = {
  tax: "Tax",
  po: "P&O",
  ubi: "UBI",
  reseller_permit: "Reseller Permit",
  contractor_license: "Contractor License",
};

async function rows() {
  await ensureDb();
  return db.select().from(companyDetails);
}

/** One-time copy of the sheet's Details row. Best-effort: a failure leaves the table empty. */
async function seedFromSheet(): Promise<void> {
  if (!appsScriptConfigured()) return;
  const r = await callAppsScript<{ rows?: Record<string, string>[] }>({ action: "chatRecords", record: "details" });
  const row = r.data?.rows?.[0];
  if (!row) return;
  const at = new Date().toISOString();
  const seed = DETAIL_FIELDS.map((f) => ({
    key: f.key,
    value: String(row[SHEET_COLUMN[f.key]] ?? "").trim(),
    updatedAt: at,
    updatedBy: "imported from the Details sheet",
  }));
  // onConflictDoNothing: two requests seeding at once must not fail or overwrite an edit.
  await db.insert(companyDetails).values(seed).onConflictDoNothing();
}

export async function readDetails(): Promise<DetailsState> {
  let all = await rows();
  if (all.length === 0) {
    try {
      await seedFromSheet();
    } catch {
      // The sheet is only a starting point. Show blanks and let the office type them in.
    }
    all = await rows();
  }
  const values: DetailValues = { ...EMPTY_DETAILS };
  let updatedAt = "";
  let updatedBy = "";
  for (const r of all) {
    if (r.key in values) values[r.key as DetailKey] = r.value;
    if (r.updatedAt > updatedAt) {
      updatedAt = r.updatedAt;
      updatedBy = r.updatedBy;
    }
  }
  return { values, updatedAt, updatedBy };
}

/** Save the changed keys. Returns what each one was before, for the journal. */
export async function writeDetails(
  changes: Partial<DetailValues>,
  by: string,
): Promise<{ key: DetailKey; before: string; after: string }[]> {
  const before = (await readDetails()).values;
  const at = new Date().toISOString();
  const changed: { key: DetailKey; before: string; after: string }[] = [];
  for (const f of DETAIL_FIELDS) {
    const next = changes[f.key];
    if (next === undefined || next === before[f.key]) continue;
    await db
      .insert(companyDetails)
      .values({ key: f.key, value: next, updatedAt: at, updatedBy: by })
      .onConflictDoUpdate({ target: companyDetails.key, set: { value: next, updatedAt: at, updatedBy: by } });
    changed.push({ key: f.key, before: before[f.key], after: next });
  }
  return changed;
}

export interface CompanyDocument {
  id: number;
  name: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
}

const docColumns = {
  id: companyDocuments.id,
  name: companyDocuments.name,
  fileName: companyDocuments.fileName,
  mime: companyDocuments.mime,
  size: companyDocuments.size,
  uploadedAt: companyDocuments.uploadedAt,
  uploadedBy: companyDocuments.uploadedBy,
};

/** Newest first. Never selects the bytes. */
export async function listDocuments(): Promise<CompanyDocument[]> {
  await ensureDb();
  return db.select(docColumns).from(companyDocuments).orderBy(desc(companyDocuments.id));
}

export async function addDocument(d: {
  name: string;
  fileName: string;
  mime: string;
  bytes: Uint8Array;
  by: string;
}): Promise<number> {
  await ensureDb();
  const [row] = await db
    .insert(companyDocuments)
    .values({
      name: d.name,
      fileName: d.fileName,
      mime: d.mime,
      size: d.bytes.byteLength,
      bytes: Buffer.from(d.bytes),
      uploadedAt: new Date().toISOString(),
      uploadedBy: d.by,
    })
    .returning({ id: companyDocuments.id });
  return row.id;
}

export async function getDocument(id: number): Promise<{ doc: CompanyDocument; bytes: Buffer } | null> {
  await ensureDb();
  const [row] = await db.select().from(companyDocuments).where(eq(companyDocuments.id, id));
  if (!row) return null;
  const { bytes, ...doc } = row;
  return { doc, bytes };
}

export async function renameDocument(id: number, name: string): Promise<void> {
  await ensureDb();
  await db.update(companyDocuments).set({ name }).where(eq(companyDocuments.id, id));
}

export async function deleteDocument(id: number): Promise<void> {
  await ensureDb();
  await db.delete(companyDocuments).where(eq(companyDocuments.id, id));
}
