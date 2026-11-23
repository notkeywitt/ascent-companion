import { db, ensureDb } from "@/db";
import { preconChecklists } from "@/db/schema";
import { asPreconState, preconProgress, preconStarted, type PreconProgress } from "@/lib/preconChecklist";

/**
 * Every job's precon progress, by JobTread job id, for the jobs whose checklist
 * someone has started. Read by /api/precon-checklist?summary=1 (the Jobs page
 * tab) and the Job Board's PreCon cards. Companion DB only.
 */
export async function readPreconSummary(): Promise<Record<string, PreconProgress>> {
  await ensureDb();
  const rows = await db.select().from(preconChecklists);
  const out: Record<string, PreconProgress> = {};
  for (const r of rows) {
    try {
      const s = asPreconState(JSON.parse(r.value));
      if (preconStarted(s)) out[r.jobId] = preconProgress(s);
    } catch {
      /* a broken row reads as no checklist */
    }
  }
  return out;
}
