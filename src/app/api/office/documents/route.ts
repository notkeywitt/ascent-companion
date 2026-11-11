import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { addDocument, deleteDocument, getDocument, listDocuments, renameDocument } from "@/lib/companyDetails";
import { docProblem } from "@/lib/companyDetailsRules";
import { openJournal } from "@/lib/financialJournal";

/**
 * Ascent's company documents (reseller permit, contractor license, insurance…),
 * kept in the companion database. Gated by the "office" view: office + admin.
 *
 * GET                       → { documents } (no file bytes)
 * POST multipart (name, file) → { ok, id }     PDF or photo, 4 MB at most
 * PATCH { id, name }        → { ok }           rename
 * DELETE ?id=               → { ok }
 *
 * The file itself is at /api/office/documents/file?id=.
 */
export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET() {
  return NextResponse.json({ documents: await listDocuments() });
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Send the file as a form upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Choose a file.");
  const problem = docProblem(file);
  if (problem) return fail(problem);
  const name =
    String(form.get("name") ?? "").trim().slice(0, 120) || file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Document";

  const by = (await auth())?.user?.email ?? "";
  const id = await addDocument({
    name,
    fileName: file.name.slice(0, 200),
    mime: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    by,
  });
  const journal = await openJournal("/api/office/documents");
  await journal.record([
    { action: "company-document.add", entity: "company-document", entityId: String(id), after: name },
  ]);
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  const name = String(body?.name ?? "").trim().slice(0, 120);
  if (!Number.isInteger(id) || !name) return fail("Send id and name.");
  if (!(await getDocument(id))) return fail("No such document.", 404);
  await renameDocument(id, name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return fail("Bad document id.");
  const found = await getDocument(id);
  if (!found) return fail("No such document.", 404);
  await deleteDocument(id);
  const journal = await openJournal("/api/office/documents");
  await journal.record([
    {
      action: "company-document.delete",
      entity: "company-document",
      entityId: String(id),
      before: found.doc.name,
      beforeSource: "read",
    },
  ]);
  return NextResponse.json({ ok: true });
}
