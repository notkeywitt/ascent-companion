import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import { writesEnabled } from "@/lib/config";

/**
 * The fix for one stray backup PDF (a `backup-unmatched` finding). Apps Script
 * `backupFileFix` (BackupFix.js) reads the Expenditure row that names the file
 * and says where it belongs.
 *
 *   GET  ?fileId=…        → the plan: where the PDF is, its bill, the proposal
 *   POST { fileId }       → carry the plan out: move it, or quarantine it
 *
 * The move is a Drive write and, for a void bill, a sheet write. Neither writes
 * JobTread. Quarantine MOVES the file; nothing is trashed. Gated by the
 * "invoicing-summary" view (lib/views.ts).
 */
export const maxDuration = 120;

const FILE_ID = /^[-\w]{20,}$/;

export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("fileId") ?? "";
  if (!FILE_ID.test(fileId)) return NextResponse.json({ error: "fileId is required." }, { status: 400 });
  const res = await callAppsScript<Record<string, unknown>>({ action: "backupFileFix", fileId }, { timeoutMs: 60_000 });
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  if (res.data?.ok !== true) {
    return NextResponse.json({ error: String(res.data?.error || "The PDF could not be read.") }, { status: 502 });
  }
  return NextResponse.json(res.data);
}

export async function POST(req: NextRequest) {
  let body: { fileId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const fileId = String(body.fileId ?? "").trim();
  if (!FILE_ID.test(fileId)) return NextResponse.json({ error: "fileId is required." }, { status: 400 });
  if (!writesEnabled()) {
    return NextResponse.json({ wrote: false, error: "Writes are OFF. The PDF was not moved." });
  }
  const res = await callAppsScript<Record<string, unknown>>(
    { action: "backupFileFix", fileId, apply: true, confirm: true },
    { timeoutMs: 110_000 },
  );
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  if (res.data?.ok !== true) {
    return NextResponse.json({ error: String(res.data?.error || "The PDF was not moved.") }, { status: 502 });
  }
  return NextResponse.json(res.data);
}
