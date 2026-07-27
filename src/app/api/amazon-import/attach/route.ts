import { NextRequest, NextResponse } from "next/server";
import { attachFileToDocument } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Attach one invoice PDF to an Amazon bill just created by the batch importer.
 * The browser unzips the invoice zip and matches each PDF to its order by the
 * Amazon order-id pattern, then POSTs the matched bytes here per PDF (keeping
 * each request small — no Vercel body-limit risk). Attaching to JT is enough for
 * Drive: the hourly mirror (pullJtBillPdfsToDrive) files it into the right
 * Year/Month/Customer/Job folder automatically.
 *
 * multipart/form-data: file (PDF, ≤15 MB), docId (the JT document id)
 */
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Writes are OFF (COMPANION_WRITES_ENABLED)." }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  const docId = String(form.get("docId") ?? "").trim();
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  if (!docId) return NextResponse.json({ error: "Missing docId." }, { status: 400 });

  const mime = (file.type || "application/pdf").toLowerCase();
  if (mime !== "application/pdf") {
    return NextResponse.json({ error: `Expected a PDF, got "${mime}".` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 15 MB." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name && file.name.toLowerCase().endsWith(".pdf") ? file.name : `${docId}.pdf`;

  try {
    const { id } = await attachFileToDocument(getPaveConfig(), docId, bytes, "application/pdf", name);
    return NextResponse.json({ ok: true, fileId: id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Attach failed." },
      { status: 502 },
    );
  }
}
