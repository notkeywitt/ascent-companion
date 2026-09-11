/**
 * Links OUT to JobTread's own web app.
 *
 * One definition per destination, because a URL shape that lives at three call
 * sites drifts at three call sites — which is how every time-entry link in the
 * Assistant once pointed at a guessed address and landed nowhere near the
 * entry. Guess nothing here; every address below came from the owner's own
 * address bar, dated.
 *
 * THE TIME PAGE HAS TWO ADDRESSES. Org-wide it is `/time`; a single job's is
 * `/jobs/<jobId>/time` (owner-supplied, 2026-09-11 — the earlier note here said
 * that path did not exist, which was wrong). Both read the same query params:
 * `userId`, `startDate`, `endDate` (owner-supplied 2026-09-06) and
 * `timeEntryId`, which OPENS one entry (owner-supplied 2026-09-08). A JOB is a
 * path segment, never a param — do not put `jobId` in the query.
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

/** A job's home page in JobTread. */
export const jtJobUrl = (jobId: string) => `${APP}/jobs/${encodeURIComponent(jobId)}`;

/**
 * JobTread's time page, narrowed to whichever of these are known.
 *
 * Every argument is optional and each narrows independently: a `jobId` gives
 * that job's own time page instead of the org's, no `userId` gives the whole
 * crew's day, no dates give one person's whole history. Passing the same day as
 * `from` and `to` is the single-day case; `entryId` is the case after that — a
 * link on ONE entry, which JobTread opens rather than merely filters to. Pair
 * `entryId` with its `userId`, the way the owner's own address does: the entry
 * list is still the person's.
 */
export function jtTimeUrl(
  opts: {
    /** The job whose time page to open. Omitted → the org-wide `/time`. */
    jobId?: string | null;
    userId?: string | null;
    from?: string | null;
    to?: string | null;
    entryId?: string | null;
  } = {},
): string {
  const p = new URLSearchParams();
  const userId = String(opts.userId ?? "").trim();
  const entryId = String(opts.entryId ?? "").trim();
  const from = day(opts.from);
  const to = day(opts.to);
  if (userId) p.set("userId", userId);
  if (from) p.set("startDate", from);
  // A range needs both ends; a lone `from` reads as "that day".
  if (to || from) p.set("endDate", to || from);
  if (entryId) p.set("timeEntryId", entryId);
  const jobId = String(opts.jobId ?? "").trim();
  const base = jobId ? `${jtJobUrl(jobId)}/time` : `${APP}/time`;
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/**
 * The TO-DO list, opened on one to-do when a task id is given — `?taskId=` is
 * what selects it there (owner-supplied address, 2026-09-08).
 *
 * NOT per-job, unlike the time page above: a to-do links to
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
