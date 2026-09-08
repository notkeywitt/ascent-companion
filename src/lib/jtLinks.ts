/**
 * Links OUT to JobTread's own web app.
 *
 * One definition per destination, because a URL shape that lives at three call
 * sites drifts at three call sites — which is exactly how every time-entry link
 * in the Assistant ended up pointing at `/jobs/<id>/time`, a path JobTread does
 * not have. It silently served the job's HOME page instead, so "open this
 * entry in JobTread" landed nowhere near the entry.
 *
 * THE TIME PAGE IS NOT PER-JOB. JobTread files time under ONE org-wide page,
 * `/time`, and narrows it with query params — `userId`, `startDate`, `endDate`
 * (owner-supplied, from a real filtered address bar, 2026-09-06). There is no
 * confirmed JOB parameter, so these links narrow to the person and the day and
 * stop there. Do not add a `jobId` guess: an unrecognised param is the same
 * silent wrong-page failure this module exists to end.
 *
 * Dates are ORG-LOCAL calendar days (YYYY-MM-DD) — the day the office would
 * call the entry's, not a UTC slice of its timestamp. Read them with `orgDay`.
 */

const APP = "https://app.jobtread.com";

/** A day already in YYYY-MM-DD, or "" for anything else. */
function day(v?: string | null): string {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/**
 * JobTread's time page, narrowed to whichever of these are known.
 *
 * Every argument is optional and each narrows independently: no `userId` gives
 * the whole crew's day, no dates give one person's whole history. Passing the
 * same day as `from` and `to` is the single-day case — what a link on ONE entry
 * wants.
 */
export function jtTimeUrl(
  opts: { userId?: string | null; from?: string | null; to?: string | null } = {},
): string {
  const p = new URLSearchParams();
  const userId = String(opts.userId ?? "").trim();
  const from = day(opts.from);
  const to = day(opts.to);
  if (userId) p.set("userId", userId);
  if (from) p.set("startDate", from);
  // A range needs both ends; a lone `from` reads as "that day".
  if (to || from) p.set("endDate", to || from);
  const q = p.toString();
  return q ? `${APP}/time?${q}` : `${APP}/time`;
}

/** A job's home page in JobTread. */
export const jtJobUrl = (jobId: string) => `${APP}/jobs/${encodeURIComponent(jobId)}`;

/**
 * The TO-DO list, opened on one to-do when a task id is given — `?taskId=` is
 * what selects it there (owner-supplied address, 2026-09-08).
 *
 * NOT per-job, the same trap as the time page above: a to-do links to
 * `/to-dos?taskId=<id>`, never to its job. Linking a to-do at its job's home
 * page lands the reader on the job and leaves them to find the to-do.
 */
export function jtToDoUrl(taskId?: string | null): string {
  const id = String(taskId ?? "").trim();
  return id ? `${APP}/to-dos?taskId=${encodeURIComponent(id)}` : `${APP}/to-dos`;
}

/**
 * A job's SCHEDULE (its Gantt chart), opened on one task when a task id is
 * given — `?taskId=` is what selects a bar there (owner-supplied address,
 * 2026-09-06).
 */
export function jtScheduleUrl(jobId: string, taskId?: string | null): string {
  const id = String(taskId ?? "").trim();
  return id
    ? `${jtJobUrl(jobId)}/schedule?taskId=${encodeURIComponent(id)}`
    : `${jtJobUrl(jobId)}/schedule`;
}

/**
 * A job's BUDGET page. There is no confirmed per-cost-code parameter, so a
 * link on one division row stops at the budget — the same rule as the time
 * page above: never guess a param.
 */
export const jtBudgetUrl = (jobId: string) => `${jtJobUrl(jobId)}/budget`;
