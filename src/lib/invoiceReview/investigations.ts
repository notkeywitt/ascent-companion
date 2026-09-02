/**
 * The state of a month's INVESTIGATION PASS — started, still going, finished,
 * or failed.
 *
 * WHY THIS MODULE EXISTS. The pass (investigate.ts) is a tool loop that can run
 * for minutes. It used to be awaited inside the browser's own request, so a
 * locked phone, a backgrounded tab or a network hop killed the fetch — the
 * office got "Load failed", the run died with it, and nothing anywhere recorded
 * that it had ever been asked for. The run is now DETACHED: the route claims a
 * month here, answers the browser immediately, and finishes the work in
 * `after()`. The page polls this row.
 *
 * ONE ROW PER MONTH. The output worth keeping is the verdicts, and those live in
 * dispositions.ts. This is only the status line — but it also carries the
 * closing "where to start" note, which used to exist only in the response and
 * vanished on reload.
 *
 * NOT best-effort, unlike its neighbours. Everywhere else in this feature an
 * unreachable companion DB costs a memory, never the review. Here the row IS
 * how the browser learns the answer, so `beginInvestigation` lets its error
 * through: better to refuse the run than to start a five-minute pass whose
 * result nobody can ever collect.
 */
import { eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { invoiceReviewInvestigations } from "@/db/schema";

/**
 * How long a 'running' row is believed.
 *
 * A run that is killed mid-flight — a deploy, the route's 300 s ceiling, a
 * crashed lambda — never gets to file its own defeat, so a stale claim would
 * otherwise block the month for good. Set above the route's `maxDuration` so a
 * pass that is merely slow is never declared dead while it is still working.
 */
export const STALE_AFTER_MS = 6 * 60 * 1000;

export interface InvestigationState {
  ym: string;
  status: "running" | "done" | "error";
  model: string;
  note: string;
  error: string;
  startedAt: string;
  startedBy: string;
  finishedAt: string;
  findingsConsidered: number;
  dispositionCount: number;
  truncated: boolean;
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number } | null;
}

function ageMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY;
}

function toState(r: typeof invoiceReviewInvestigations.$inferSelect): InvestigationState {
  let usage: InvestigationState["usage"] = null;
  try {
    const parsed = JSON.parse(r.usage) as Record<string, number>;
    if (parsed && typeof parsed.input === "number") {
      usage = {
        input: parsed.input ?? 0,
        output: parsed.output ?? 0,
        cacheWrite: parsed.cacheWrite ?? 0,
        cacheRead: parsed.cacheRead ?? 0,
      };
    }
  } catch {
    /* a row whose usage JSON won't parse still has a status worth reading */
  }

  // A claim older than the ceiling is READ as a failure without being
  // rewritten. The run that made it cannot come back to correct the record, so
  // the inference has to happen here — and it must not be persisted, or a slow
  // run that does finish would find its own row already marked dead.
  const stale = r.status === "running" && ageMs(r.startedAt) > STALE_AFTER_MS;

  return {
    ym: r.ym,
    status: stale ? "error" : (r.status as InvestigationState["status"]),
    model: r.model,
    note: r.note,
    error: stale
      ? "The investigation stopped before it finished — most likely it ran past its time limit. Press Investigate to try again."
      : r.error,
    startedAt: r.startedAt,
    startedBy: r.startedBy,
    finishedAt: r.finishedAt,
    findingsConsidered: r.findingsConsidered,
    dispositionCount: r.dispositionCount,
    truncated: r.truncated,
    usage,
  };
}

/**
 * Claim a month for an investigation.
 *
 * Returns `{ ok: false }` when one is ALREADY running and its claim is still
 * fresh — the pass is the most expensive call in the app, and two of them on
 * one month would spend twice to write the same verdicts. THROWS if the claim
 * cannot be written at all (see the module note).
 */
export async function beginInvestigation(
  ym: string,
  model: string,
  by: string,
): Promise<{ ok: true } | { ok: false; startedAt: string; startedBy: string }> {
  await ensureDb();
  const existing = await readInvestigation(ym);
  if (existing?.status === "running") {
    return { ok: false, startedAt: existing.startedAt, startedBy: existing.startedBy };
  }
  const row = {
    ym,
    status: "running",
    model,
    note: "",
    error: "",
    startedAt: new Date().toISOString(),
    startedBy: by,
    finishedAt: "",
    findingsConsidered: 0,
    dispositionCount: 0,
    truncated: false,
    usage: "{}",
  };
  await db
    .insert(invoiceReviewInvestigations)
    .values(row)
    .onConflictDoUpdate({ target: invoiceReviewInvestigations.ym, set: row });
  return { ok: true };
}

/** File a finished pass. Best-effort: the verdicts are already saved, and
 *  losing the status line must not turn a good run into an error. */
export async function finishInvestigation(
  ym: string,
  result: {
    model: string;
    note: string;
    findingsConsidered: number;
    dispositionCount: number;
    truncated: boolean;
    usage: unknown;
  },
): Promise<void> {
  try {
    await ensureDb();
    await db
      .update(invoiceReviewInvestigations)
      .set({
        status: "done",
        model: result.model,
        note: result.note,
        error: "",
        finishedAt: new Date().toISOString(),
        findingsConsidered: result.findingsConsidered,
        dispositionCount: result.dispositionCount,
        truncated: result.truncated,
        usage: JSON.stringify(result.usage ?? {}),
      })
      .where(eq(invoiceReviewInvestigations.ym, ym));
  } catch (e) {
    console.error("[invoice-review] could not file the finished investigation:", e);
  }
}

/** Record why a pass stopped. Best-effort for the same reason as above — but
 *  worth trying hard, because an unrecorded failure is exactly the silence this
 *  whole module exists to remove. */
export async function failInvestigation(ym: string, message: string): Promise<void> {
  try {
    await ensureDb();
    await db
      .update(invoiceReviewInvestigations)
      .set({
        status: "error",
        error: message || "Unknown error",
        finishedAt: new Date().toISOString(),
      })
      .where(eq(invoiceReviewInvestigations.ym, ym));
  } catch (e) {
    console.error("[invoice-review] could not file the failed investigation:", e);
  }
}

/** A month's investigation state, or null when none has ever run (or the DB is
 *  unreachable — the page then simply offers to start one). */
export async function readInvestigation(ym: string): Promise<InvestigationState | null> {
  try {
    await ensureDb();
    const rows = await db
      .select()
      .from(invoiceReviewInvestigations)
      .where(eq(invoiceReviewInvestigations.ym, ym))
      .limit(1);
    return rows[0] ? toState(rows[0]) : null;
  } catch {
    return null;
  }
}
