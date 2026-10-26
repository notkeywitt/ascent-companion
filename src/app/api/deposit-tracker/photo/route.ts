import { NextRequest, NextResponse } from "next/server";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { OFFICE_JOB_ID, uploadFileToJobFolder } from "@/lib/jobtread";
import { DEPOSIT_FOLDER } from "@/lib/depositTracker";

/**
 * POST multipart { file, name } — one check photo onto the Office job's Files
 * tab, folder "Deposits". The deposit tracker's first write. One photo a
 * request: the phone shrinks each one to a JPEG first, and Vercel refuses a
 * request body over 4.5 MB.
 *
 * Gated by the "deposit-tracker" view (src/lib/views.ts), admin by default.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  if (!writesEnabled()) {
    return NextResponse.json({ error: "JobTread writes are off in this app." }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const name = String(form?.get("name") ?? "").trim().slice(0, 200);
  if (!(file instanceof Blob) || !name) {
    return NextResponse.json({ error: "Send a photo and its name." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "The file is not a photo." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "The photo is larger than 4 MB." }, { status: 413 });
  }
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const saved = await uploadFileToJobFolder(getPaveConfig(), OFFICE_JOB_ID, DEPOSIT_FOLDER, bytes, file.type, name);
    return NextResponse.json({ file: saved });
  } catch (e) {
    console.error("[deposit-tracker/photo]", e);
    return NextResponse.json(
      { error: `Saving to JobTread: ${e instanceof Error ? e.message : "Unknown error"}` },
      { status: 502 },
    );
  }
}
