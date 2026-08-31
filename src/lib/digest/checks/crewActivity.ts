/**
 * Check "crew-activity" (Crew) — who worked where yesterday, and who's clocked
 * in right now, straight from JobTread time entries.
 *
 * ONE check answers both halves of "what's happening on our job sites" by doing
 * nothing more than reading `organization.timeEntries` at whatever moment it
 * happens to run (see `getOrgTimeEntries` in src/lib/jobtread.ts):
 *  - "Yesterday" — every entry started in the previous COMPANY-TIMEZONE calendar
 *    day, grouped by job.
 *  - "Right now" — every entry still open (`endedAt` null) at run time, grouped
 *    by job. Run this at midnight and it's correctly empty (nobody's clocked in
 *    at midnight); run it at 9am and it reflects who's actually on site. No
 *    time-of-day branching needed here — that distinction comes entirely from
 *    WHEN the scheduler calls this, not from anything this check decides.
 *
 * READ-ONLY: two JobTread queries (bounded by date/openOnly), no writes.
 */
import { getOrgTimeEntries, orgLocalToJtIso, type OrgTimeEntry } from "@/lib/jobtread";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { CrewActivityConfig } from "../settings";

/** "Customer — Job", falling back to just the job name when there's no customer. */
function jobLabel(jobName: string, customer: string): string {
  return customer && jobName ? `${customer} — ${jobName}` : jobName || "Unassigned job";
}

/** Yesterday's local calendar date (YYYY-MM-DD), one day back from `today` — plain
 *  calendar-value arithmetic (not true-instant math), so it's unaffected by DST. */
function yesterdayOf(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const prior = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  return prior.toISOString().slice(0, 10);
}

/** One job's entries -> a single digest item: who, on what, how long. */
function summarizeJob(jobId: string, entries: OrgTimeEntry[], group: string): DigestItem {
  const first = entries[0];
  const byUser = new Map<string, number>(); // name -> total minutes
  const tasks = new Set<string>();
  for (const e of entries) {
    byUser.set(e.userName || "Unknown", (byUser.get(e.userName || "Unknown") ?? 0) + e.minutes);
    if (e.costItemName) tasks.add(e.costItemName);
  }
  const names = [...byUser.keys()].filter(Boolean);
  const totalHours = [...byUser.values()].reduce((s, m) => s + m, 0) / 60;
  const taskList = [...tasks].slice(0, 3).join(", ");
  const detail = [
    names.length ? names.join(", ") : "",
    taskList || undefined,
    group === "Yesterday" && totalHours > 0 ? `${totalHours.toFixed(1)} hrs` : undefined,
  ]
    .filter(Boolean)
    .join(" — ");
  return {
    title: jobLabel(first.jobName, first.customer),
    detail: detail || undefined,
    sourceLink: jobId ? `https://app.jobtread.com/jobs/${jobId}` : undefined,
    sourceLabel: jobId ? "Open job in JobTread" : undefined,
    group,
  };
}

function groupByJob(entries: OrgTimeEntry[], group: string, maxJobs: number): DigestItem[] {
  const byJob = new Map<string, OrgTimeEntry[]>();
  for (const e of entries) {
    const key = e.jobId || `_${e.jobName}`;
    const list = byJob.get(key) ?? [];
    list.push(e);
    byJob.set(key, list);
  }
  return [...byJob.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxJobs)
    .map(([jobId, list]) => summarizeJob(jobId.startsWith("_") ? "" : jobId, list, group));
}

export const crewActivityCheck = defineCheck<CrewActivityConfig>({
  id: "crew-activity",
  title: "Crew Activity",
  category: "crew",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as CrewActivityConfig,

  async run({ config, pave, today, log }): Promise<CheckResult> {
    if (!pave?.grantKey) return checkError("JobTread isn't configured, so crew activity can't be read.");

    const yesterday = yesterdayOf(today);
    const sinceIso = orgLocalToJtIso(`${yesterday}T00:00`);
    const untilIso = orgLocalToJtIso(`${today}T00:00`);

    let yesterdayEntries: OrgTimeEntry[] = [];
    let openEntries: OrgTimeEntry[] = [];
    try {
      [yesterdayEntries, openEntries] = await Promise.all([
        getOrgTimeEntries(pave, { sinceIso, untilIso }),
        getOrgTimeEntries(pave, { openOnly: true }),
      ]);
    } catch (e) {
      return checkError(`Couldn't read time entries from JobTread: ${e instanceof Error ? e.message : String(e)}`);
    }
    log(`${yesterdayEntries.length} entr(y/ies) from yesterday, ${openEntries.length} clocked in right now`);

    const items: DigestItem[] = [
      ...groupByJob(openEntries, "Right now", config.maxJobs),
      ...groupByJob(yesterdayEntries, "Yesterday", config.maxJobs),
    ];

    if (items.length === 0) {
      return allClear("No crew activity yesterday, and nobody's currently clocked in.");
    }
    const jobsYesterday = new Set(yesterdayEntries.map((e) => e.jobId)).size;
    const clockedInNow = new Set(openEntries.map((e) => e.userName)).size;
    return {
      status: "ok",
      items,
      summary:
        `${clockedInNow} clocked in right now` +
        (jobsYesterday > 0 ? `; activity on ${jobsYesterday} job${jobsYesterday === 1 ? "" : "s"} yesterday` : "") +
        ".",
    };
  },
});
