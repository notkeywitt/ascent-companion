import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { callAppsScript } from "@/lib/appsScript";

// Proxy to the Apps Script web app's requisition actions. A field lead submits a
// request for the office to buy/approve something for their job; Apps Script
// holds the Sheets grant and appends one row to the Project Database
// "Requisitions" tab, then the office tracks it through its status lifecycle.
// The Assistant is only the UI. The requester's identity is taken from the
// session server-side (never from the client body), so a lead can't submit as —
// or read another lead's requests as — someone else. The secret stays
// server-side; the route sits behind normal Google sign-in.
//
// Env (shared with /api/email, /api/mileage, /api/employees):
//   APPS_SCRIPT_SYNC_URL    — the Apps Script web-app /exec URL
//   APPS_SCRIPT_SYNC_SECRET — must equal Script Property SYNC_TRIGGER_SECRET
//
//   GET  ?status=&job=   → { ok, isOffice, statuses, requisitions }   (tracking view)
//   POST { title?, requestedBy?, jobId?, jobLabel?, type?, priority?, neededBy?,
//          deliverTo?, description, estCost?, clientKey? }
//                        → { ok, reqId, date, duplicate? }             (submit)
//   PATCH { reqId, status?, officeNotes? }
//                        → { ok, requisition }                         (office-only)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Identity from the session — Apps Script uses it to decide office (all
  // requests + filters) vs. own-requests-only. The client cannot spoof it.
  const session = await auth();
  const requesterEmail = session?.user?.email ?? "";
  const status = req.nextUrl.searchParams.get("status") ?? "";
  const job = req.nextUrl.searchParams.get("job") ?? "";

  const result = await callAppsScript({ action: "listRequisitions", requesterEmail, status, job });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 200 });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const description = String(body.description ?? "").trim();
  if (!description) {
    return NextResponse.json({ error: "Describe what you need." }, { status: 400 });
  }

  // Attribute the request to the signed-in user, not to anything the client sends.
  const session = await auth();
  const requesterEmail = session?.user?.email ?? "";

  const result = await callAppsScript({
    action: "logRequisition",
    requesterEmail,
    requestedBy: body.requestedBy ?? "",
    title: body.title ?? "",
    jobId: body.jobId ?? "",
    jobLabel: body.jobLabel ?? "",
    type: body.type ?? "",
    priority: body.priority ?? "",
    neededBy: body.neededBy ?? "",
    deliverTo: body.deliverTo ?? "",
    description,
    estCost: body.estCost ?? "",
    clientKey: body.clientKey ?? "",
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 200 });
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  // The office-only gate is enforced by Apps Script against this session email.
  const session = await auth();
  const requesterEmail = session?.user?.email ?? "";

  const result = await callAppsScript({
    action: "updateRequisition",
    requesterEmail,
    reqId: body.reqId ?? "",
    ...(Object.prototype.hasOwnProperty.call(body, "status") ? { status: body.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, "officeNotes") ? { officeNotes: body.officeNotes } : {}),
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 200 });
}
