import { NextRequest, NextResponse } from "next/server";

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
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set." },
      { status: 400 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const session = await auth();
  const requesterEmail = session?.user?.email ?? "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mileageReportPdf",
        requesterEmail,
        month: body.month ?? "",
        secret,
      }),
      redirect: "follow",
    });
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text), { status: 200 });
    } catch {
      return NextResponse.json(
        { error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
