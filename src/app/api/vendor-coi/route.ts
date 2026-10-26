import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

/**
 * A vendor's certificate of insurance (COI), filed as a PDF in the Vendor COIs
 * Drive folder as "<Vendor> COI - <year>". Apps Script holds the Drive grant, so
 * this only forwards (ascent-appscript VendorCoi.js).
 *
 *   GET  ?vendor=<name>          → { ok, file: { name, url, updated } | null }
 *   POST { vendor, pdfBase64 }   → { ok, file }
 *
 * Gated by the "vendors" view (src/lib/views.ts).
 */
export const maxDuration = 60;

/** Vercel refuses a request body over 4.5 MB; base64 adds a third. */
const MAX_PDF_BYTES = 3 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const vendor = req.nextUrl.searchParams.get("vendor")?.trim();
  if (!vendor) return NextResponse.json({ error: "Pass ?vendor=<name>" }, { status: 400 });
  return callAppsScriptResponse({ action: "getVendorCoi", vendor }, { timeoutMs: 50_000 });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const vendor = String(body.vendor ?? "").trim();
  const pdfBase64 = String(body.pdfBase64 ?? "");
  if (!vendor || !pdfBase64) {
    return NextResponse.json({ error: "vendor and pdfBase64 are required." }, { status: 400 });
  }
  if ((pdfBase64.length * 3) / 4 > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "The PDF is over 3 MB." }, { status: 413 });
  }
  // A write: never retried.
  return callAppsScriptResponse(
    { action: "saveVendorCoi", vendor, pdfBase64 },
    { timeoutMs: 50_000 },
  );
}
