import { NextRequest, NextResponse } from "next/server";

import { listUnsyncedLeave, retryLeavePost } from "@/lib/leaveService";
import { listUnsyncedWorked, retryWorked } from "@/lib/timeSync";

/**
 * Office/admin — re-post stranded records to JobTread. One at a time
 * ({ kind, id }) or everything at once ({ all: true }). The JobTread write is
 * still gated by COMPANION_WRITES_ENABLED; with writes off, retries report
 * "not posted (writes off)" and change nothing.
 *
 * POST { kind:"worked", id:"<entryId>" }        → { ok, jtStatus, jtEntryId? }
 * POST { kind:"leave",  id:<requestId> }        → { ok, jtPosted, jtStatus }
 * POST { all:true }                             → { ok, summary, results }
 */
export const dynamic = "force-dynamic";
// "Retry all" walks every stranded record, each costing a JobTread create plus a
// sheet write-back, so it needs far more than the default budget. A run cut short
// is safe: whatever posted is recorded, and the view still lists the rest.
export const maxDuration = 120;

interface Body {
  kind?: "worked" | "leave";
  id?: string | number;
  all?: boolean;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  if (body.all) return NextResponse.json(await retryAll());

  const kind = body.kind;
  if (kind === "worked") {
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });
    return NextResponse.json(await retryWorked(id));
  }
  if (kind === "leave") {
    const id = Number(body.id);
    if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "numeric id is required." }, { status: 400 });
    return NextResponse.json(await retryLeavePost(id));
  }
  return NextResponse.json({ ok: false, error: "Pass { all:true } or { kind, id }." }, { status: 400 });
}

async function retryAll() {
  const results: Array<{ kind: string; id: string; ok: boolean; jtStatus: string; error?: string }> = [];
  let posted = 0;
  let tried = 0;

  const worked = await listUnsyncedWorked().catch(() => ({ rows: [] as Array<{ entryId: string }> }));
  for (const r of worked.rows) {
    tried++;
    const res = await retryWorked(r.entryId);
    const ok = res.ok && res.jtStatus === "pushed";
    if (ok) posted++;
    results.push({ kind: "worked", id: r.entryId, ok, jtStatus: res.jtStatus, error: res.error });
  }

  const leave = (await listUnsyncedLeave().catch(() => [])) as Array<{ id: number }>;
  for (const r of leave) {
    tried++;
    const res = await retryLeavePost(r.id);
    const ok = res.ok && "jtPosted" in res && res.jtPosted;
    if (ok) posted++;
    results.push({
      kind: "leave",
      id: String(r.id),
      ok,
      jtStatus: res.ok ? ("jtStatus" in res ? res.jtStatus : "") : "",
      error: res.ok ? undefined : res.error,
    });
  }

  return { ok: true, summary: { tried, posted, failed: tried - posted }, results };
}
