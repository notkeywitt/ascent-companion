import { NextRequest, NextResponse } from "next/server";
import { budgetCodeMaps, getJobBudget } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

const MAX_JOBS = 25;

/**
 * Read-only: cost code → jobCostItemId, for one or more jobs.
 *
 * JobTread cost items are PER-JOB, so a CSI code like "07 46 23" resolves to a
 * different cost item id on every job — the labor importer has to look each row's
 * CSI up against *its own* job's budget. First budget leaf wins per code, the same
 * rule the Apps Script budget map uses.
 *
 * `timeTrackable` is the same map built ONLY from leaves whose cost type is
 * time-trackable. JobTread refuses a time entry on any other leaf, and a single
 * code often has both a Materials leaf and a Labor leaf — first-leaf-wins picks
 * the wrong one. The labor importer resolves against this map; bill coding keeps
 * using `budgets`.
 *
 * GET /api/job-budget?jobIds=a,b  →  { budgets, timeTrackable, errors }
 *   both maps: { [jobId]: { [code]: costItemId } }
 */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const ids = [
    ...new Set(
      (req.nextUrl.searchParams.get("jobIds") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) {
    return NextResponse.json({ error: "jobIds required" }, { status: 400 });
  }
  if (ids.length > MAX_JOBS) {
    return NextResponse.json({ error: `Too many jobs (max ${MAX_JOBS})` }, { status: 400 });
  }

  const cfg = getPaveConfig();
  const budgets: Record<string, Record<string, string>> = {};
  const timeTrackable: Record<string, Record<string, string>> = {};
  const errors: Record<string, string> = {};

  await Promise.all(
    ids.map(async (jobId) => {
      try {
        const items = await getJobBudget(cfg, jobId);
        const maps = budgetCodeMaps(items);
        budgets[jobId] = maps.byCode;
        timeTrackable[jobId] = maps.timeTrackable;
      } catch (e) {
        errors[jobId] = e instanceof Error ? e.message : "Unknown error";
      }
    }),
  );

  return NextResponse.json({ budgets, timeTrackable, errors });
}
