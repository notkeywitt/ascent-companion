import { NextRequest, NextResponse } from "next/server";

import {
  groupKey,
  hasSignatureField,
  missingAnswers,
  profileMissing,
  type Answers,
} from "@/lib/onboarding/fields";
import { fillForm } from "@/lib/onboarding/pdf";
import { bad, clientIp, pdfResponse, sessionEmail } from "@/lib/onboarding/respond";
import { getFormPdf, getIntake, getSubmissionPdf, saveSubmission } from "@/lib/onboarding/store";

// One form of the new hire's OWN paperwork (the `onboarding` view).
//
//   GET ?blank=1  → the blank form, to read before filling it in
//   GET           → the copy you signed
//   POST { answers, ssn, signature, signedName, agree } → fill, sign, store
//
// The SSN in a POST is used to fill the PDF and is then dropped: it is never
// written anywhere but the filled PDF itself.
export const dynamic = "force-dynamic";

const PNG_PREFIX = "data:image/png;base64,";
const MAX_SIGNATURE = 400_000;

async function ids(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const formId = Number(id);
  return Number.isInteger(formId) ? formId : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const email = await sessionEmail();
  if (!email) return bad("Sign in first.", 401);
  const formId = await ids(ctx);
  if (formId === null) return bad("Bad form id.");
  if (!(await getIntake(email))) return bad("There is no paperwork waiting for this account.", 404);

  if (req.nextUrl.searchParams.get("blank")) {
    const f = await getFormPdf(formId);
    if (!f || !f.form.active) return bad("That form is not in your paperwork.", 404);
    return pdfResponse(f.bytes, f.form.fileName || `${f.form.name}.pdf`);
  }
  const s = await getSubmissionPdf(email, formId);
  if (!s) return bad("You have not signed that form yet.", 404);
  return pdfResponse(s.bytes, `${s.meta.formName}.pdf`);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const email = await sessionEmail();
  if (!email) return bad("Sign in first.", 401);
  const formId = await ids(ctx);
  if (formId === null) return bad("Bad form id.");

  const intake = await getIntake(email);
  if (!intake) return bad("There is no paperwork waiting for this account.", 404);
  if (intake.sentAt) return bad("The office already has your paperwork. Ask them to reopen it.", 409);
  if (!intake.profileAt || profileMissing(intake.profile).length) return bad("Finish your profile first.", 409);

  const f = await getFormPdf(formId);
  if (!f || !f.form.active) return bad("That form is not in your paperwork.", 404);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("Body must be JSON.");
  if (body.agree !== true) return bad("Tick the box to agree to sign electronically.");
  const signedName = String(body.signedName ?? "").trim().slice(0, 120);
  if (!signedName) return bad("Type your full name to sign.");
  const sig = String(body.signature ?? "");
  if (!sig.startsWith(PNG_PREFIX) || sig.length > MAX_SIGNATURE) return bad("Draw your signature.");
  const signaturePng = new Uint8Array(Buffer.from(sig.slice(PNG_PREFIX.length), "base64"));

  // Keep only answers to THIS form's employee questions.
  const fields = f.form.fields;
  const allowed = new Set<string>();
  for (const c of fields) {
    if (c.role !== "employee") continue;
    allowed.add(c.name);
    if (c.group) allowed.add(groupKey(c.group));
  }
  const raw = body.answers && typeof body.answers === "object" ? (body.answers as Record<string, unknown>) : {};
  const answers: Answers = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!allowed.has(k)) continue;
    if (typeof v === "boolean") answers[k] = v;
    else if (typeof v === "string") answers[k] = v.slice(0, 500);
  }
  const missing = missingAnswers(fields, answers);
  if (missing.length) return bad(`Fill in: ${missing.join(", ")}.`);

  let bytes: Uint8Array;
  try {
    bytes = await fillForm({
      template: f.bytes,
      formName: f.form.name,
      fields,
      answers,
      profile: intake.profile,
      ssn: String(body.ssn ?? "").replace(/[^\d-]/g, "").slice(0, 11),
      signaturePng,
      signer: {
        name: signedName,
        email,
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent") ?? "",
        at: new Date(),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return bad(`The form could not be filled (${msg}). Tell the office.`, 500);
  }

  await saveSubmission({ email, formId, formName: f.form.name, bytes, signedName, ip: clientIp(req) });
  return NextResponse.json({ ok: true, signedOnRecord: !hasSignatureField(fields) });
}
