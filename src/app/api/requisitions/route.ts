import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

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
//   POST { jobId?, jobLabel?, type?, priority?, neededBy?, deliverTo?,
//          description, estCost?, requestedBy?, clientKey? }
//                        → { ok, reqId, date, duplicate? }             (submit)
//   PATCH { reqId, status?, officeNotes? }
//                        → { ok, requisition }                         (office-only)
export const dynamic = "force-dynamic";

async function callAppsScript(payload: Record<string, unknown>) {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.", status: 400 };
  }
  try {
    // Apps Script answers via a 302 to a one-time content URL, always HTTP 200
    // there — success/failure is the `ok` field in the body.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret }),
      redirect: "follow",
    });
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as unknown, status: 200 };
    } catch {
      return {
        error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
        status: 502,
      };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Unknown error", status: 502 };
  }
}

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
