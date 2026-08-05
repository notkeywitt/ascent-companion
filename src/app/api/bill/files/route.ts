import { NextRequest, NextResponse } from "next/server";
import { getBillFiles } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: just a bill's attached files (the scanned invoice).
 *
 * /api/bill returns these too, but alongside the job budget and both
 * cost-to-complete aggregates — four calls the coding board already has. This is
 * the one call it's missing, fetched lazily when a bill is opened in the drawer.
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const docId = req.nextUrl.searchParams.get("docId")?.trim();
  if (!docId) return NextResponse.json({ error: "Pass docId" }, { status: 400 });
  try {
    return NextResponse.json({ files: await getBillFiles(getPaveConfig(), docId) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
