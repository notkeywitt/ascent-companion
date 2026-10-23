import { NextRequest, NextResponse } from "next/server";

import { cleanConfig, configFor } from "@/lib/onboarding/fields";
import { readPdfFields } from "@/lib/onboarding/pdf";
import { bad, sessionEmail } from "@/lib/onboarding/respond";
import { createForm, deleteForm, getFormPdf, moveForm, updateForm } from "@/lib/onboarding/store";

// The blank forms the new hires fill — /onboarding/office, `employees` view.
//
//   POST (multipart: name, file) → read the PDF's fields, guess each one's setup, store
//   PATCH { id, name?, fields?, active?, move? } → rename, re-set fields, hide, reorder
//   DELETE ?id=                  → remove the blank form
//
// A request body over 4.5 MB never reaches a Vercel function, so the cap is 4 MB.
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Send the PDF as a form upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return bad("Choose a PDF.");
  if (file.size > MAX_BYTES) return bad("The PDF is over 4 MB.");
  const name = String(form.get("name") ?? "").trim().slice(0, 120) || file.name.replace(/\.pdf$/i, "");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let info;
  try {
    info = await readPdfFields(bytes);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "That PDF could not be read.");
  }
  const fields = configFor(info.fields);
  const id = await createForm({ name, fileName: file.name, bytes, fields, pages: info.pages, by: await sessionEmail() });
  return NextResponse.json({ ok: true, id, fillable: fields.length > 0 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return bad("Bad form id.");

  if (body.move === -1 || body.move === 1) {
    await moveForm(id, body.move);
    return NextResponse.json({ ok: true });
  }

  const patch: Parameters<typeof updateForm>[1] = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if (typeof body.active === "boolean") patch.active = body.active;
  if (body.fields !== undefined) {
    // The PDF itself decides which fields exist and what kind each is; the
    // editor can only re-label and re-assign them.
    const f = await getFormPdf(id);
    if (!f) return bad("No such form.", 404);
    const base = configFor((await readPdfFields(f.bytes)).fields);
    patch.fields = cleanConfig(body.fields, base);
  }
  await updateForm(id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return bad("Bad form id.");
  await deleteForm(id);
  return NextResponse.json({ ok: true });
}
