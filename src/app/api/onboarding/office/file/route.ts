import { NextRequest } from "next/server";

import { mergePdfs, profileSheet } from "@/lib/onboarding/pdf";
import { bad, pdfResponse } from "@/lib/onboarding/respond";
import { getFormPdf, getIntake, getSubmissionPdf, listForms, listSubmissions } from "@/lib/onboarding/store";

// PDFs for the office — /onboarding/office, `employees` view.
//
//   GET ?formId=              → the blank form
//   GET ?email=&formId=       → one new hire's filled, signed form
//   GET ?email=&packet=1      → the whole packet for the bookkeeper: the
//                               profile page, then every signed form in order
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const email = (q.get("email") ?? "").trim().toLowerCase();
  const formId = Number(q.get("formId"));

  if (!email) {
    if (!Number.isInteger(formId)) return bad("Send formId.");
    const f = await getFormPdf(formId);
    if (!f) return bad("No such form.", 404);
    return pdfResponse(f.bytes, f.form.fileName || `${f.form.name}.pdf`);
  }

  const intake = await getIntake(email);
  if (!intake) return bad("No paperwork for that email.", 404);
  const who = `${intake.lastName}, ${intake.firstName}`;

  if (q.get("packet")) {
    const order = new Map((await listForms()).map((f, i) => [f.id, i]));
    const subs = (await listSubmissions(email)).sort(
      (a, b) => (order.get(a.formId) ?? 99) - (order.get(b.formId) ?? 99),
    );
    const parts = [
      await profileSheet(intake.profile, {
        position: intake.position,
        hireDate: intake.hireDate,
        invitedAt: intake.invitedAt,
        profileAt: intake.profileAt ?? "",
      }),
    ];
    for (const s of subs) {
      const pdf = await getSubmissionPdf(email, s.formId);
      if (pdf) parts.push(pdf.bytes);
    }
    return pdfResponse(await mergePdfs(parts), `${who} - new hire packet.pdf`, true);
  }

  if (!Number.isInteger(formId)) return bad("Send formId or packet.");
  const s = await getSubmissionPdf(email, formId);
  if (!s) return bad("That form is not signed yet.", 404);
  return pdfResponse(s.bytes, `${who} - ${s.meta.formName}.pdf`);
}
