import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { preconChecklists } from "@/db/schema";
import { readPreconSummary } from "@/lib/preconRead";
import { applyPreconOp, asPreconOp, asPreconState, emptyPreconState } from "@/lib/preconChecklist";

/**
 * Preconstruction Checklist — a job's 27 precon steps (src/lib/preconChecklist.ts),
 * the Jobs page's Precon tab.
 *
 *   GET ?jobId=          → { state }     (no row = the template, nothing started)
 *   GET ?summary=1       → { summary }   { [jobId]: PreconProgress } for every job with a row
 *   POST { jobId, op }   → { state }     one change: status, note, hide, add,
 *                                        remove or questions
 *
 * POST sends ONE op, applied to the row as stored, so two people changing
 * different steps at once do not overwrite each other.
 *
 * Writes the companion DB only. Gated by the "precon" view (office, admin, lead).
 */

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9]{6,32}$/;

async function read(jobId: string) {
  const [row] = await db.select().from(preconChecklists).where(eq(preconChecklists.jobId, jobId)).limit(1);
  return row ? asPreconState(JSON.parse(row.value)) : emptyPreconState();
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("summary") === "1") return NextResponse.json({ summary: await readPreconSummary() });
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
  const op = asPreconOp(body.op);
  if (!ID.test(jobId) || !op) return NextResponse.json({ error: "Send jobId and op." }, { status: 400 });
  const session = await auth();
  const by = session?.user?.email ?? "";
  const at = new Date().toISOString();
  await ensureDb();
  const state = applyPreconOp(await read(jobId), op, by, at);
  const row = { jobId, value: JSON.stringify(state), updatedAt: at, updatedBy: by };
  await db.insert(preconChecklists).values(row).onConflictDoUpdate({ target: preconChecklists.jobId, set: row });
  return NextResponse.json({ state });
}
