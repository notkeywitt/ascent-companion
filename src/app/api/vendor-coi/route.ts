import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptOrThrow, callAppsScriptResponse } from "@/lib/appsScript";
import { coiByVendor } from "@/lib/vendorCoi";

/**
 * A vendor's certificate of insurance (COI), filed as a PDF in the Vendor COIs
 * Drive folder as "<Vendor> COI - <year>". Apps Script holds the Drive grant, so
 * this only forwards (ascent-appscript VendorCoi.js).
 *
 *   GET  ?vendor=<name>          → { ok, file: { name, url, updated } | null }
 *   GET  ?all=1                  → { years: { "<vendor key>": newest year } }
 *                                  — the vendor list's COI marks, from ONE
 *                                  read-only listing of the folder (the bridge's
 *                                  listDriveFolder), not one lookup per vendor
 *   POST { vendor, pdfBase64 }   → { ok, file }
 *
 * Gated by the "vendors" view (src/lib/views.ts).
 */
export const maxDuration = 60;

/** Vercel refuses a request body over 4.5 MB; base64 adds a third. */
const MAX_PDF_BYTES = 3 * 1024 * 1024;

/** The Vendor COIs folder — VENDOR_COI_FOLDER_ID in ascent-appscript VendorCoi.js. */
const COI_FOLDER_ID = "1plJrn5OyeTRFJiHyYY8C4pOFYWBQBFsJ";

/** The folder listing, held ten minutes: every bill list's COI dots read it. */
let listed: { at: number; body: { years: Record<string, number>; truncated: boolean } } | null = null;
const LIST_TTL_MS = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("all") === "1") {
    if (listed && Date.now() - listed.at < LIST_TTL_MS) return NextResponse.json(listed.body);
    try {
      const r = await callAppsScriptOrThrow<{ children?: { name: string; isFolder: boolean }[]; truncated?: boolean }>(
        { action: "listDriveFolder", id: COI_FOLDER_ID },
        { timeoutMs: 50_000 },
      );
      const files = (r.children ?? []).filter((c) => !c.isFolder).map((c) => c.name);
      listed = { at: Date.now(), body: { years: coiByVendor(files), truncated: !!r.truncated } };
      return NextResponse.json(listed.body);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }
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
