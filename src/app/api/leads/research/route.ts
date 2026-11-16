import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { cancelRun, getRun, latestRuns, requestResearch, runsForLead } from "@/lib/leadResearch";

/**
 * Lead research, the page's side. Gated by the "leads" view (/api/leads).
 *
 * GET               the newest run per lead (the board's marks)
 * GET ?leadId=…     one lead's runs, newest first
 * GET ?id=…         one run, with its files (no bytes)
 * POST { leadId, name, address, note? }   ask a Mac to research the lead
 * DELETE ?id=…      stop a waiting run, or discard a finished one
 *
 * Writes only the companion's lead_research tables.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const leadId = req.nextUrl.searchParams.get("leadId");
  if (id) {
    const got = await getRun(id);
    return got ? NextResponse.json(got) : NextResponse.json({ error: "No such run." }, { status: 404 });
  }
  if (leadId) return NextResponse.json({ runs: await runsForLead(leadId) });
  return NextResponse.json({ latest: await latestRuns() });
}

export async function POST(req: NextRequest) {
  let body: { leadId?: string; name?: string; address?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const leadId = String(body.leadId ?? "").trim();
  if (!leadId) return NextResponse.json({ error: "leadId is required." }, { status: 400 });
  const session = await auth();
  const run = await requestResearch(leadId, session?.user?.email ?? "", String(body.note ?? "").trim(), {
    name: String(body.name ?? ""),
    address: String(body.address ?? ""),
  });
  return NextResponse.json({ run });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const session = await auth();
  await cancelRun(id, session?.user?.email ?? "someone");
  return NextResponse.json({ ok: true });
}
