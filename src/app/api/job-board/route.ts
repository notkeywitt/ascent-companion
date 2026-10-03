import { NextResponse } from "next/server";
import { getJobBoard, getJobs, getRecentJobToDos } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import {
  ACTIVE_PHASE,
  PRECON_PHASES,
  sortJobsPageCards,
  type JobBoardCard,
  type JobsPageCard,
} from "@/lib/jobBoard";

/**
 * Read-only: the Jobs page's two job rows — Active and PreCon — each card with
 * its customer, its place on the JobTread schedule and its three newest open
 * to-dos. Gated by the "job-board" view (src/lib/views.ts), so a role without
 * the page cannot read every job's to-dos by calling this directly.
 *
 * Three reads, all cached and all shared: `getJobBoard` (Phase + schedule, the
 * same read as the home board), `getJobs` (number + address) and
 * `getRecentJobToDos`. The leads row is not here — the page reuses the home
 * page's lead board, which reads /api/leads under its own gate.
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    const [board, jobs, todos] = await Promise.all([
      getJobBoard(cfg),
      getJobs(cfg),
      getRecentJobToDos(cfg, 3),
    ]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const toCard = (c: JobBoardCard): JobsPageCard => ({
      id: c.id,
      name: c.name,
      number: jobById.get(c.id)?.number ?? "",
      customer: c.customer,
      address: jobById.get(c.id)?.address ?? "",
      phase: c.phase,
      schedule: c.schedule,
      todos: todos[c.id] ?? [],
    });
    const inPhase = (keep: (phase: string) => boolean) =>
      sortJobsPageCards(board.filter((c) => c.phase !== null && keep(c.phase)).map(toCard));

    return NextResponse.json({
      active: inPhase((p) => p === ACTIVE_PHASE),
      precon: inPhase((p) => PRECON_PHASES.includes(p)),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
