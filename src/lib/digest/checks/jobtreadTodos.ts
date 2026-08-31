/**
 * Check "jobtread-todos" (To-Do) — open JobTread to-dos, overdue or due soon.
 *
 * JobTread's `task` object serves both the schedule (`isToDo=false`) and to-do
 * lists (`isToDo=true`) — see `getOpenToDos` in src/lib/jobtread.ts. This check
 * reads the to-do half and turns it into "what still needs doing", grouped by
 * who it's assigned to, so the digest can act as a real to-do manager instead
 * of a link to go look one up.
 *
 * "Open" = `progress` is null or under 1 (JobTread has no separate boolean
 * completion flag on the task itself). "Due soon" = due within
 * `dueWithinDays`; "overdue" = due date already passed. An UNDATED to-do is
 * skipped by default (see `JobTreadTodosConfig.includeUndated`) — this check
 * is a morning glance, not a full backlog dump.
 *
 * READ-ONLY: one org-wide JobTread query, no writes.
 */
import { getOpenToDos, type OpenToDo } from "@/lib/jobtread";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { JobTreadTodosConfig } from "../settings";

/** The date this to-do is due by, preferring endDate over startDate. */
export function dueDateOf(t: Pick<OpenToDo, "startDate" | "endDate">): string | null {
  return t.endDate || t.startDate || null;
}

/** Whether a due date (YYYY-MM-DD) has already passed, relative to `today` (YYYY-MM-DD). */
export function isOverdue(due: string, today: string): boolean {
  return due < today;
}

/** Whether a person is on the watch list — empty list matches everyone. */
export function matchesWatch(assignees: string[], watch: string[]): boolean {
  if (watch.length === 0) return true;
  const norm = watch.map((w) => w.toLowerCase().trim()).filter(Boolean);
  return assignees.some((a) => norm.some((w) => a.toLowerCase().includes(w)));
}

/** The "Where" for a task item — job name, plus its street address when JobTread
 *  has one on file. Shared by jobtread-todos and jobtread-schedule so the two
 *  checks describe a job's location the same way. */
export function jobWhere(t: Pick<OpenToDo, "jobName" | "jobAddress">): string | null {
  if (!t.jobName) return null;
  return t.jobAddress ? `${t.jobName} — ${t.jobAddress}` : t.jobName;
}

export const jobtreadTodosCheck = defineCheck<JobTreadTodosConfig>({
  id: "jobtread-todos",
  title: "Open To-Dos",
  category: "todo",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as JobTreadTodosConfig,

  async run({ config, pave, today, log }): Promise<CheckResult> {
    if (!pave?.grantKey) return checkError("JobTread isn't configured, so to-dos can't be read.");

    let todos: OpenToDo[];
    try {
      todos = await getOpenToDos(pave);
    } catch (e) {
      return checkError(`Couldn't read to-dos from JobTread: ${e instanceof Error ? e.message : String(e)}`);
    }
    log(`${todos.length} open to-do(s) in JobTread`);

    const cutoff = new Date(`${today}T00:00:00Z`).getTime() + config.dueWithinDays * 86_400_000;

    let filteredOut = 0;
    let undatedSkipped = 0;
    let overdueCount = 0;
    const items: DigestItem[] = [];
    for (const t of todos) {
      if (!matchesWatch(t.assignees, config.watchMembers)) {
        filteredOut++;
        continue;
      }
      const due = dueDateOf(t);
      if (!due) {
        undatedSkipped++;
        if (!config.includeUndated) continue;
      }
      const overdue = due ? isOverdue(due, today) : false;
      if (due) {
        const dueMs = Date.parse(`${due}T00:00:00Z`);
        if (!overdue && dueMs > cutoff) continue; // due soon window only
      }
      if (overdue) overdueCount++;

      const who = t.assignees.length > 0 ? t.assignees.join(", ") : "Unassigned";
      const where = jobWhere(t);
      items.push({
        title: t.name,
        detail: [
          where ? `Where: ${where}` : "",
          `When: ${due ? `${overdue ? "overdue, was due " : "due "}${due}` : "no due date"}`,
          t.description ? t.description.slice(0, 200) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        sourceLink: t.jobId ? `https://app.jobtread.com/jobs/${t.jobId}` : undefined,
        sourceLabel: t.jobId ? "Open job in JobTread" : undefined,
        date: due ?? undefined,
        group: who,
      });
    }

    if (filteredOut) log(`${filteredOut} to-do(s) not on the watch list were skipped`);
    if (undatedSkipped && !config.includeUndated) {
      log(`${undatedSkipped} to-do(s) with no due date were skipped (includeUndated is off)`);
    }

    items.sort((a, b) => (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99"));
    const capped = items.slice(0, config.maxItems);
    if (capped.length < items.length) {
      log(`${items.length - capped.length} to-do(s) trimmed at the ${config.maxItems}-item cap`);
    }

    if (capped.length === 0) {
      return allClear(`No open to-dos due within ${config.dueWithinDays} days.`);
    }
    return {
      status: "warning",
      items: capped,
      summary:
        `${capped.length} open to-do${capped.length === 1 ? "" : "s"} due within ${config.dueWithinDays} days` +
        (overdueCount > 0 ? ` (${overdueCount} overdue)` : "") +
        ".",
    };
  },
});
