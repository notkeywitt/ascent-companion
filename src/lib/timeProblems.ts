/**
 * What can be wrong with one time record, in the words the whole app uses.
 *
 * Its own module because both sides need it and only one of them may import the
 * other's dependencies: `lib/timeSync.ts` (server — JobTread grant + the shared
 * secret) decides which problem a record has, and the Time Sync page (client)
 * draws it. Pure data, no imports, so the client bundle carries the labels
 * without dragging the grant-holding module in behind them.
 */

/**
 * The problems, worst first. The first two are readable from the Time Entries
 * sheet alone; the last three need JobTread (see `auditWorked`).
 *
 *   not-posted    — no JobTread entry id at all. The push never happened, or it
 *                   failed on a path that left the row un-finalized.
 *   push-failed   — the row carries an id AND an error status. This is the
 *                   refused clock-out: the entry exists in JobTread but its stop
 *                   time never landed, so JobTread shows fewer hours than the
 *                   employee logged (often none — it reads as still running).
 *   missing-in-jt — the row names an id JobTread no longer has. Deleted there.
 *   open-in-jt    — JobTread still has the entry OPEN although the row records a
 *                   stop time. Same symptom as push-failed, found the other way.
 *   time-mismatch — JobTread's start or stop disagrees with what the row says
 *                   the employee logged, by more than the tolerance.
 */
export type TimeProblem =
  | "not-posted"
  | "push-failed"
  | "missing-in-jt"
  | "open-in-jt"
  | "time-mismatch";

/** Display order, and "what do I fix first". */
export const PROBLEM_ORDER: TimeProblem[] = [
  "not-posted",
  "push-failed",
  "missing-in-jt",
  "open-in-jt",
  "time-mismatch",
];

/** The heading over a group of these, on the page and in the digest. */
export const PROBLEM_LABEL: Record<TimeProblem, string> = {
  "not-posted": "Never reached JobTread",
  "push-failed": "JobTread refused it",
  "missing-in-jt": "Gone from JobTread",
  "open-in-jt": "Still running in JobTread",
  "time-mismatch": "JobTread's hours don't match",
};

/** What the office should do about it — one line, under the heading. */
export const PROBLEM_FIX: Record<TimeProblem, string> = {
  "not-posted": "Nothing was lost. Retry posts the record to JobTread.",
  "push-failed":
    "JobTread already has the entry — its stop time is what didn't land, so the hours read short. " +
    "Set the stop time in JobTread; do not re-post, it would duplicate.",
  "missing-in-jt": "Someone deleted the entry in JobTread. Re-enter it there if the time was worked.",
  "open-in-jt": "The entry never closed in JobTread, so it counts no hours. Set its stop time there.",
  "time-mismatch":
    "JobTread holds different times than the employee logged. Either someone edited it there, or the push landed wrong.",
};

/** Whether this problem is fixed by re-posting from here, or by hand in JobTread. */
export const PROBLEM_RETRYABLE: Record<TimeProblem, boolean> = {
  "not-posted": true,
  "push-failed": false,
  "missing-in-jt": false,
  "open-in-jt": false,
  "time-mismatch": false,
};

/* ------------------------------------------------- reading a record's verdict */

/** The status every push path writes when JobTread itself refused the record. */
export const isErrorStatus = (status: string) => /^JobTread error/i.test((status ?? "").trim());

/**
 * What the Time Entries row says about itself, with no JobTread call.
 *
 * Null means the row looks fine as far as the sheet can tell — `auditWorked`
 * (lib/timeSync) is what asks JobTread whether it really is. Order matters: a
 * row with no id is `not-posted` whatever its status says, because that is the
 * one state a Retry can fix.
 */
export function sheetProblem(jtEntryId: string, jtStatus: string): TimeProblem | null {
  if (!(jtEntryId ?? "").trim()) return "not-posted";
  return isErrorStatus(jtStatus) ? "push-failed" : null;
}

/* --------------------------------------------------------- local wall clocks */

/**
 * Read a local wall clock in either shape the two sides write it. The Apps
 * Script log stores "YYYY-MM-DD HH:MM" (a space, no seconds — `_tetWallClock`
 * in EmployeeTime.js); the routes and `jtIsoToOrgLocal` produce
 * "YYYY-MM-DDTHH:MM:SS". Both name the same minute, so both parse here.
 *
 * `ms` is the digits read as UTC. That is NOT the real instant, and doesn't need
 * to be: it is only ever compared against another stamp read the same way.
 */
export function wallClock(v: string): { date: string; hhmm: string; ms: number } | null {
  const m = (v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    hhmm: `${m[4]}:${m[5]}`,
    ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)),
  };
}

/** Just the "07:30" of a local stamp, for a one-line difference. "" if unreadable. */
export function clockOf(local: string): string {
  return wallClock(local)?.hhmm ?? "";
}

/** Minutes between two local wall clocks. NaN when either is unreadable. */
export function driftMinutes(aLocal: string, bLocal: string): number {
  const a = wallClock(aLocal);
  const b = wallClock(bLocal);
  if (!a || !b) return NaN;
  return Math.abs(a.ms - b.ms) / 60_000;
}
