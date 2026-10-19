/**
 * WHEN THE INVOICE REVIEW RUNS ON ITS OWN — the office's monthly timeline, as code.
 *
 * The office's calendar for billing month M (costs incurred in M):
 *
 *   1st–10th of M+1   bills for M still arrive (all but Sunset, which closes
 *                     with its month-end statement). The cutoff is the 10th.
 *   11th              M is closed. The first full review runs that night.
 *   12th–14th         the office fixes what it found; the review re-runs each
 *                     night, so each morning shows what is left.
 *   15th              send day. One last run before the invoices go out.
 *
 * Plus a few EARLY runs during the 1st–10th. They cannot judge the invoices
 * (most are not built yet), but the mailbox and duplicate checks are already
 * right, and a vendor invoice that never reached JobTread is cheaper to chase
 * on the 5th than on the 14th.
 *
 * WHO CALLS THIS. Nothing has its own timer. Vercel Hobby caps the project at
 * two cron jobs and the digest owns both (vercel.json; see the warning in
 * /api/invoice-review/run). So the DIGEST's scheduler call asks this function
 * "is today a review day?" and, if it is, starts the review as a separate
 * request with its own 300-second budget. Both digest firings ask; the review
 * route files at most one scheduled run per day, so the second firing only
 * retries a night run that failed.
 *
 * Pure: no I/O, so the calendar is unit-tested rather than trusted.
 */
import { companyDateParts } from "@/lib/billing";

export interface ReviewScheduleSettings {
  /** Off switch for the whole automation. The page and the button still work. */
  enabled: boolean;
  /** Days of M+1, before the cutoff, that get an early run. */
  earlyDays: number[];
  /** The day the invoices go out. Runs continue daily from the cutoff to here. */
  sendDay: number;
}

export type ReviewPhase = "early" | "cutoff" | "daily" | "send-day";

export interface ScheduledReview {
  /** The billing month to review, "YYYY-MM". */
  ym: string;
  year: number;
  month: number;
  phase: ReviewPhase;
  /** Today in the company timezone, "YYYY-MM-DD" — the once-a-day key. */
  today: string;
  /** Send day for this billing month, "YYYY-MM-DD". */
  sendDate: string;
  /** Whole days from today to send day; 0 on send day. */
  daysToSend: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The billing month being invoiced this calendar month, and where today falls
 * in its timeline. Returned for every day from the 1st to send day, so the
 * digest can show the countdown; `due` says whether a run is scheduled today.
 */
export function reviewWindow(
  now: Date,
  cfg: ReviewScheduleSettings,
  cutoffDay: number,
): (ScheduledReview & { due: boolean }) | null {
  const { year, month, day } = companyDateParts(now);
  if (day > cfg.sendDay) return null;
  const target = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  let phase: ReviewPhase;
  let due = true;
  if (day <= cutoffDay) {
    phase = "early";
    due = cfg.earlyDays.includes(day);
  } else if (day === cutoffDay + 1) {
    phase = "cutoff";
  } else if (day < cfg.sendDay) {
    phase = "daily";
  } else {
    phase = "send-day";
  }
  return {
    ym: `${target.year}-${pad(target.month)}`,
    year: target.year,
    month: target.month,
    phase,
    today: `${year}-${pad(month)}-${pad(day)}`,
    sendDate: `${year}-${pad(month)}-${pad(cfg.sendDay)}`,
    daysToSend: cfg.sendDay - day,
    due: cfg.enabled && due,
  };
}

/** The run due today, or null. What the digest's scheduler call acts on. */
export function scheduledReview(
  now: Date,
  cfg: ReviewScheduleSettings,
  cutoffDay: number,
): ScheduledReview | null {
  const w = reviewWindow(now, cfg, cutoffDay);
  if (!w?.due) return null;
  return {
    ym: w.ym,
    year: w.year,
    month: w.month,
    phase: w.phase,
    today: w.today,
    sendDate: w.sendDate,
    daysToSend: w.daysToSend,
  };
}
