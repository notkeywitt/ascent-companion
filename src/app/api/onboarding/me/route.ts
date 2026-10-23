import { NextRequest, NextResponse } from "next/server";

import { cleanProfile, profileMissing, type FieldConfig } from "@/lib/onboarding/fields";
import { bad, sessionEmail } from "@/lib/onboarding/respond";
import {
  findRosterByEmail,
  getIntake,
  listForms,
  listSubmissions,
  saveIntakeProfile,
  writeProfileToRoster,
} from "@/lib/onboarding/store";

// The new hire's OWN paperwork — gated by the `onboarding` view (every role).
// Every read and write is keyed on the signed-in email, never on anything in
// the request, so one person can only ever see or change their own.
//
//   GET           → { intake: null }                    nothing waiting for you
//                   { intake, forms:[{id, name, pages, fields, submitted}] }
//   PATCH {profile} → saves the profile step: here, and onto your Employee tab row.
export const dynamic = "force-dynamic";

/** The fields the new hire's phone needs: their own, and nothing the office set. */
function employeeFields(fields: FieldConfig[]): FieldConfig[] {
  return fields.filter((f) => f.role === "employee");
}

export async function GET() {
  const email = await sessionEmail();
  if (!email) return bad("Sign in first.", 401);
  const intake = await getIntake(email);
  if (!intake) return NextResponse.json({ intake: null });
  const [forms, subs] = await Promise.all([listForms(true), listSubmissions(email)]);
  const byForm = new Map(subs.map((s) => [s.formId, s]));
  return NextResponse.json({
    intake: {
      firstName: intake.firstName,
      lastName: intake.lastName,
      position: intake.position,
      hireDate: intake.hireDate,
      profile: intake.profile,
      profileAt: intake.profileAt,
      sentAt: intake.sentAt,
    },
    forms: forms.map((f) => {
      const s = byForm.get(f.id);
      return {
        id: f.id,
        name: f.name,
        pages: f.pages,
        fields: employeeFields(f.fields),
        submitted: s ? { at: s.submittedAt, signedName: s.signedName } : null,
      };
    }),
  });
}

export async function PATCH(req: NextRequest) {
  const email = await sessionEmail();
  if (!email) return bad("Sign in first.", 401);
  const intake = await getIntake(email);
  if (!intake) return bad("There is no paperwork waiting for this account.", 404);
  if (intake.sentAt) return bad("The office already has your paperwork. Ask them to reopen it.", 409);

  const body = await req.json().catch(() => null);
  const profile = cleanProfile(body?.profile);
  profile.email = email; // the sign-in, never what was typed
  const missing = profileMissing(profile);
  if (missing.length) return bad(`Fill in: ${missing.join(", ")}.`);

  await saveIntakeProfile(email, profile);

  // The roster row is found by THIS email, so a stale id on the invite can
  // never point the write at somebody else's row.
  try {
    const row = await findRosterByEmail(email);
    if (!row) {
      return bad("Your profile is saved, but the office roster has no row for your email. Tell the office.", 502);
    }
    await writeProfileToRoster(row.id, profile);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return bad(`Your profile is saved, but the office roster did not update (${msg}). Tap Save again.`, 502);
  }
  return NextResponse.json({ ok: true, profile });
}
