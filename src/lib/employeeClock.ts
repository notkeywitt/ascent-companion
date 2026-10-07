import { getOpenTimeEntries, getUserTimeEntries, jtIsoToOrgLocal, type OpenTimeEntry } from "@/lib/jobtread";
import { getPaveConfig } from "@/lib/config";

/**
 * The running clock, shaped the way /employee-time reads it.
 *
 * Shared by the clock route (GET /api/employee-time/clock) and by the page's
 * server shell, which now reads the clock while it renders instead of making
 * the phone ask for it afterwards. One definition, so the two can never drift.
 */
export interface OpenClock {
  entryId: string;
  startedAt: string; // org-LOCAL wall clock — what the client sends at clock-in
  jobId: string;
  jobLabel: string;
  costItemId: string;
  costCode: string;
  costItemName: string;
  payType: string;
  employee: string;
}

/**
 * How far back a still-open entry counts as a resumable running clock. Wide
 * enough for the real case (forgot to clock out Friday, back Monday), bounded so
 * a long-abandoned entry from weeks ago cannot hijack the page.
 */
export const RESUME_WINDOW_DAYS = 7;

function toOpenClock(e: OpenTimeEntry, employeeName: string): OpenClock {
  return {
    entryId: e.id,
    // JobTread stores a real UTC instant; the client works in org-local
    // wall clock (that's what it sends at clock-in and what the elapsed
    // timer and the Time Entries log expect).
    startedAt: jtIsoToOrgLocal(e.startedAt),
    jobId: e.jobId,
    jobLabel: e.jobLabel,
    costItemId: e.costItemId,
    costCode: e.costCode,
    costItemName: e.costItemName,
    payType: e.payType,
    employee: employeeName,
  };
}

/** The newest open (never clocked out) entry for a user, plus how many exist. */
export async function readOpenClock(
  userId: string,
  employeeName: string,
): Promise<{ openEntry: OpenClock | null; openCount: number }> {
  const since = new Date(Date.now() - RESUME_WINDOW_DAYS * 86_400_000).toISOString();
  const open = await getOpenTimeEntries(getPaveConfig(), userId, { sinceIso: since });
  const e = open[0]; // newest-first
  return { openCount: open.length, openEntry: e ? toOpenClock(e, employeeName) : null };
}

/* ── ONE RUNNING CLOCK PER PERSON ──────────────────────────────────────────
   JobTread enforces this itself, and silently: creating an OPEN entry closes
   the person's running one at that same instant. Its event log shows the close
   under our own grant, a few milliseconds before the create.

   So a clock-in from a screen that missed the running clock (a page left open
   since before the clock-in, or a JobTread read that failed at load) cut the
   real shift short and opened an overlapping one. On 2026-10-05 that turned a
   crew member's 9-hour day into 13h38m across three entries; it happened six
   times between 2026-09-08 and 2026-10-05.

   The clock-in therefore checks first, at ANY age. The resume window above
   does not apply here: a clock forgotten three weeks ago would be closed now,
   as a three-week entry. */

/** Every running entry for a user, newest first, at any age. */
export async function readRunningClocks(userId: string, employeeName: string): Promise<OpenClock[]> {
  const open = await getOpenTimeEntries(getPaveConfig(), userId);
  return open.map((e) => toOpenClock(e, employeeName));
}

/**
 * The running clock a new clock-in would close, or null when it is safe.
 *
 * `justClosed` holds the entries this device clocked out a moment ago. The
 * clock-out is detached, so JobTread can still show one running for a few
 * seconds. Letting JobTread close it is harmless: the clock-out's own update
 * then writes the real end time over JobTread's.
 */
export function blockingClock(running: OpenClock[], justClosed: readonly string[]): OpenClock | null {
  return running.find((c) => !justClosed.includes(c.entryId)) ?? null;
}

/**
 * What this person logged time to LAST — the job, cost code and pay type of
 * their most recent entry.
 *
 * It is the page's default selection, so a crew member who works the same job
 * all week taps Clock in and nothing else. JobTread holds it (not the phone), so
 * it follows the person to a new phone or to the office computer. The phone's
 * own last pick still wins when it has one; this is the cross-device fallback.
 *
 * Bounded to one page inside a 60-day window: we want one row, not a history.
 */
export interface LastUsed {
  jobId: string;
  costItemId: string;
  costCode: string;
  payType: string;
}

export async function readLastUsed(userId: string): Promise<LastUsed | null> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const rows = await getUserTimeEntries(getPaveConfig(), userId, {
    sinceIso: since,
    sortDesc: true,
    maxPages: 1,
  });
  const e = rows[0];
  if (!e || !e.jobId) return null;
  return { jobId: e.jobId, costItemId: e.costItemId, costCode: e.costCode, payType: e.payType };
}

