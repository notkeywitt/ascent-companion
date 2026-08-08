import { NextRequest, NextResponse } from "next/server";
import { callAppsScriptResponse } from "@/lib/appsScript";

import { auth } from "@/auth";

// Admin-only: render the whole month's mileage (every driver) to a PDF. Apps
// Script builds the Doc → PDF and saves it in a "Mileage Reports" Drive folder;
// this route just forwards the request with the signed-in email so Apps Script
// can enforce admin access (the client can't spoof it). The report ignores any
// driver filter — it's the full month for all employees.
//
//   POST { month }  (YYYY-MM)
//   → { ok, pdfUrl, fileName, tripCount, totalMiles } | { ok:false, error }
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Doc→PDF export takes a few seconds

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const session = await auth();
  const requesterEmail = session?.user?.email ?? "";

  // Renders a Doc and exports it to a PDF in Drive — a write (it creates the
  // file), so never retried. Stay just under this route's maxDuration (60s).
  return callAppsScriptResponse(
    { action: "mileageReportPdf", requesterEmail, month: body.month ?? "" },
    { timeoutMs: 50_000 },
  );
}
