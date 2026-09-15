/**
 * Check "time-not-in-jobtread" (Crew) — time records that did not reach JobTread
 * correctly, or at all.
 *
 * WHY THIS IS A DIGEST CHECK AND NOT JUST A PAGE. The Time Sync page has always
 * held this answer, and nobody opens a page to find out whether a thing they
 * don't know about happened. The failure is silent on every side: the employee's
 * phone said "saved" (the write is detached — it answers before JobTread is
 * contacted), the sheet holds the record either way, and JobTread simply shows
 * fewer hours than were worked. It surfaces days later as "my hours are wrong",
 * by which time payroll is closing. So it gets read out twice a day instead.
 *
 * WHAT IT CATCHES is everything `auditWorked` (src/lib/timeSync.ts) can tell:
 * the sheet's own record of a failed push, plus a JobTread cross-check of the
 * last few days that finds the entries nobody could have known were wrong — one
 * left running because its clock-out was refused, one deleted in JobTread, one
 * whose times no longer match what the employee logged.
 *
 * READ-ONLY: one Apps Script read of the Time Entries tab, one paged JobTread
 * read of the window. It never posts, and never retries — a retry is a person's
 * decision, on the Time Sync page the items link to.
 */
import { auditWorked, type ProblemRow } from "@/lib/timeSync";
import { PROBLEM_LABEL, PROBLEM_ORDER, clockOf } from "@/lib/timeProblems";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { TimeNotInJobtreadConfig } from "../settings";

function toItem(r: ProblemRow): DigestItem {
  const span = clockOf(r.start) && clockOf(r.end) ? ` ${clockOf(r.start)}–${clockOf(r.end)}` : "";
  return {
    title: `${r.employee || "Someone"} — ${r.jobLabel || "no job"}${span}`,
    // The EntryID is the row's own idempotency key, so it names the same record
    // on every run. The problem rides along: a record that goes from "never
    // posted" to "hours don't match" is new news and must come back undismissed.
    key: `time-sync:${r.entryId}:${r.problem}`,
    detail: `${PROBLEM_LABEL[r.problem]}. ${r.detail}`,
    date: r.date,
    group: PROBLEM_LABEL[r.problem],
    sourceLink: "/time-sync",
    sourceLabel: "Open Time Sync",
  };
}

export const timeNotInJobtreadCheck = defineCheck<TimeNotInJobtreadConfig>({
  id: "time-not-in-jobtread",
  title: "Time Not In JobTread",
  category: "crew",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as TimeNotInJobtreadConfig,

  async run({ config, log }): Promise<CheckResult> {
    let audit;
    try {
      audit = await auditWorked({
        windowDays: config.windowDays,
        toleranceMinutes: config.toleranceMinutes,
      });
    } catch (e) {
      // The sheet is the record that proves nothing was lost. If it can't be
      // read, say so — an empty "all clear" here would be a lie with payroll
      // consequences.
      return checkError(
        `Couldn't read the Time Entries record: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }

    log(
      `${audit.total} records on file; ${audit.checked} cross-checked against JobTread ` +
        `(${audit.from} to ${audit.to})${audit.jtError ? `; JobTread read failed: ${audit.jtError}` : ""}`,
    );

    if (!audit.rows.length) {
      // A failed cross-check with a clean sheet is NOT all clear — half the
      // question went unanswered, and the half that can hide a wrong number is
      // the half that failed.
      return audit.jtError
        ? checkError(`Every record has a JobTread entry, but JobTread couldn't be checked: ${audit.jtError}`)
        : allClear(`All ${audit.total} time records are in JobTread with the hours they were logged with.`);
    }

    // Worst problem first, then newest — the same order the page uses, capped so
    // one bad week can't push every other check off the card.
    const rows = audit.rows.slice(0, Math.max(1, config.maxItems));
    const counts = PROBLEM_ORDER.map((p) => ({
      problem: p,
      n: audit.rows.filter((r) => r.problem === p).length,
    })).filter((c) => c.n > 0);

    const summary =
      `${audit.rows.length} time ${audit.rows.length === 1 ? "record" : "records"} need attention — ` +
      counts.map((c) => `${c.n} ${PROBLEM_LABEL[c.problem].toLowerCase()}`).join(", ") +
      ".";

    return { status: "warning", items: rows.map(toItem), summary };
  },
});
