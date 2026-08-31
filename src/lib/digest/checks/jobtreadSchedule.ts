/**
 * Check "jobtread-schedule" (Calendar) — JobTread's own schedule: dated job
 * work like a site visit, an inspection, or an install date, today or soon.
 *
 * A JobTread `task` serves BOTH the schedule (`isToDo=false`) and to-do lists
 * (`isToDo=true`) — see `getScheduledTasks` in src/lib/jobtread.ts, the sibling
 * of `getOpenToDos` (which `jobtread-todos` reads). This check reads the
 * schedule half, so job-level dated work shows up alongside the shared Google
 * calendars (`calendar-events`) instead of only living inside JobTread where
 * the office would have to go look for it.
 *
 * Filed under Calendar, not To-Do: a schedule item is "what's happening when",
 * the same kind of thing calendar-events reports — not "what needs doing".
 * "Open" = `progress` is null or under 1. An item already past its date is
 * skipped rather than flagged, unlike an overdue to-do — a missed inspection
 * date usually means it moved, not that it's still owed.
 *
 * READ-ONLY: one org-wide JobTread query, no writes.
 */
import { getScheduledTasks, type OpenToDo } from "@/lib/jobtread";
import { dueDateOf, matchesWatch } from "./jobtreadTodos";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { JobTreadScheduleConfig } from "../settings";

export const jobtreadScheduleCheck = defineCheck<JobTreadScheduleConfig>({
  id: "jobtread-schedule",
  title: "JobTread Schedule",
  category: "calendar",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as JobTreadScheduleConfig,

  async run({ config, pave, today, log }): Promise<CheckResult> {
    if (!pave?.grantKey) return checkError("JobTread isn't configured, so the schedule can't be read.");

    let tasks: OpenToDo[];
    try {
      tasks = await getScheduledTasks(pave);
    } catch (e) {
      return checkError(`Couldn't read the schedule from JobTread: ${e instanceof Error ? e.message : String(e)}`);
    }
    log(`${tasks.length} open schedule item(s) in JobTread`);

    const todayMs = Date.parse(`${today}T00:00:00Z`);
    const cutoff = todayMs + config.daysAhead * 86_400_000;

    let filteredOut = 0;
    let noDateSkipped = 0;
    let pastSkipped = 0;
    const items: DigestItem[] = [];
    for (const t of tasks) {
      if (!matchesWatch(t.assignees, config.watchMembers)) {
        filteredOut++;
        continue;
      }
      const due = dueDateOf(t);
      if (!due) {
        noDateSkipped++;
        continue; // nothing to show "today or soon" against
      }
      const dueMs = Date.parse(`${due}T00:00:00Z`);
      if (dueMs < todayMs) {
        pastSkipped++;
        continue; // already past — not this check's job to flag as overdue
      }
      if (dueMs > cutoff) continue; // outside the window

      const who = t.assignees.length > 0 ? t.assignees.join(", ") : "Unassigned";
      items.push({
        title: t.name,
        detail:
          (t.jobName ? `Job: ${t.jobName}. ` : "") +
          `${due === today ? "Today" : due}.` +
          (t.description ? ` ${t.description.slice(0, 200)}` : ""),
        sourceLink: t.jobId ? `https://app.jobtread.com/jobs/${t.jobId}` : undefined,
        sourceLabel: t.jobId ? "Open job in JobTread" : undefined,
        date: due,
        group: who,
      });
    }

    if (filteredOut) log(`${filteredOut} schedule item(s) not on the watch list were skipped`);
    if (noDateSkipped) log(`${noDateSkipped} schedule item(s) with no date were skipped`);
    if (pastSkipped) log(`${pastSkipped} schedule item(s) already past their date were skipped`);

    items.sort((a, b) => (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99"));
    const capped = items.slice(0, config.maxItems);
    if (capped.length < items.length) {
      log(`${items.length - capped.length} schedule item(s) trimmed at the ${config.maxItems}-item cap`);
    }

    if (capped.length === 0) {
      return allClear(`Nothing on the JobTread schedule in the next ${config.daysAhead} days.`);
    }
    return {
      // Informational, like calendar-events — a full schedule isn't a problem.
      status: "ok",
      items: capped,
      summary: `${capped.length} scheduled item${capped.length === 1 ? "" : "s"} in the next ${config.daysAhead} days.`,
    };
  },
});
