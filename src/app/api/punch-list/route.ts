import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { punchLists } from "@/db/schema";
import { applyPunchOp, asPunchOp, asPunchState, emptyPunchState } from "@/lib/punchList";

/**
 * Punch List — a job's final inspection checklist (src/lib/punchList.ts), the
 * Jobs page's Punch List tab.
 *
 *   GET ?jobId=          → { state }  (no row = the whole template, nothing done)
 *   POST { jobId, op }   → { state }  one change: check, hide, add or remove
 *
 * POST sends ONE op, applied to the row as stored, so two people ticking
 * different items at once do not overwrite each other.
 *
 * Writes the companion DB only. Gated by the "jobs-hub" view.
 */

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9]{6,32}$/;

async function read(jobId: string) {
  const [row] = await db.select().from(punchLists).where(eq(punchLists.jobId, jobId)).limit(1);
  return row ? asPunchState(JSON.parse(row.value)) : emptyPunchState();
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!ID.test(jobId)) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  await ensureDb();
  return NextResponse.json({ state: await read(jobId) });
}

export async function POST(req: NextRequest) {
  let body: { jobId?: unknown; op?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "").trim();
  const op = asPunchOp(body.op);
  if (!ID.test(jobId) || !op) return NextResponse.json({ error: "Send jobId and op." }, { status: 400 });
  const session = await auth();
  const by = session?.user?.email ?? "";
  const at = new Date().toISOString();
  await ensureDb();
  const state = applyPunchOp(await read(jobId), op, by, at);
  const row = { jobId, value: JSON.stringify(state), updatedAt: at, updatedBy: by };
  await db.insert(punchLists).values(row).onConflictDoUpdate({ target: punchLists.jobId, set: row });
  return NextResponse.json({ state });
}
