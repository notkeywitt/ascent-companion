import { NextRequest, NextResponse } from "next/server";

import { savePhoto } from "@/lib/toolBatch";
import { BATCH_PHOTO_ROLES, type BatchPhotoRole } from "@/lib/toolBatchRules";

/**
 * POST /api/tools/batch/photo?item=<itemId>&id=<photoId>&role=tool|serial|extra
 * Body: the JPEG itself (no base64, no JSON — a third smaller on a weak signal).
 * The phone queues each photo and sends it in the background; a repeated photo
 * id is ignored, so a retry after a dropped connection is safe.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_BYTES = 4_000_000; // under Vercel's 4.5 MB body cap

export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const itemId = q.get("item") ?? "";
  const id = q.get("id") ?? "";
  const role = (q.get("role") ?? "") as BatchPhotoRole;
  if (!ID_RE.test(itemId) || !ID_RE.test(id) || !BATCH_PHOTO_ROLES.includes(role)) {
    return NextResponse.json({ error: "Bad photo parameters." }, { status: 400 });
  }
  const mime = (req.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return NextResponse.json({ error: "Not an image." }, { status: 400 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) return NextResponse.json({ error: "Empty image." }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: "Image too large." }, { status: 413 });
  const saved = await savePhoto({ id, itemId, role, mime, bytes });
  if (!saved) return NextResponse.json({ error: "No such batch item." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
