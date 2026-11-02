import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptOrThrow } from "@/lib/appsScript";

/**
 * House Manual → a PDF from the office's computer, filed in Drive by the Apps
 * Script bridge (ascent-appscript HouseManualFiles.js) in "House Manual Files"
 * as "<Job> - <file>". The builder then links it as a PDF link, which the live
 * page serves with no Google login (src/app/m/[token]/file/[fileId]).
 *
 *   POST { jobName, fileName, pdfBase64 } → { file: { id, name, url } }
 *
 * Rides the "house-manual" view with /api/house-manual.
 */

export const maxDuration = 60;

/** Vercel refuses a request body over 4.5 MB; base64 adds a third. */
const MAX_PDF_BYTES = 3 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const pdfBase64 = String(body.pdfBase64 ?? "");
  if (!pdfBase64) return NextResponse.json({ error: "Choose a PDF." }, { status: 400 });
  if ((pdfBase64.length * 3) / 4 > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "The PDF is over 3 MB." }, { status: 413 });
  }
  try {
    // A write: never retried.
    const r = await callAppsScriptOrThrow<{ file: { id: string; name: string; url: string } }>(
      {
        action: "uploadHouseManualPdf",
        jobName: String(body.jobName ?? ""),
        fileName: String(body.fileName ?? ""),
        pdfBase64,
      },
      { timeoutMs: 50_000 },
    );
    return NextResponse.json({ file: r.file });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const error = /Unknown action/i.test(m) ? "PDF upload is not deployed yet. Run ./deploy.sh in ascent-appscript." : m;
    return NextResponse.json({ error }, { status: 502 });
  }
}
