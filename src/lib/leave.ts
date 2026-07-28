/**
 * PTO / sick-time accrual engine — PURE functions only (no DB, no fetch, no
 * Node/React imports), so the math is trivially testable and safe to import
 * anywhere. DB reads/writes and the JobTread time-entry fetch live in the API
 * routes; this module just answers "given these worked hours and this policy,
 * how much is earned?"
 *
 * Pay periods are bi-monthly, matching /employee-time: the 1st–15th ("A") and
 * the 16th–end-of-month ("B"). A period id is "YYYY-MM-A" / "YYYY-MM-B".
 *
 * All dates here are ORG-LOCAL calendar strings "YYYY-MM-DD" (America/Los_Angeles).
 * The caller converts JobTread UTC instants to org-local with jtIsoToOrgLocal()
 * before handing entries in — this module never touches timezones.
 */

export type LeaveType = "sick" | "pto";

/** A tenure step: once an employee passes `afterMonths` of service, their rate
 *  becomes `hoursPerHourWorked`. Empty tiers list ⇒ the policy's flat rate. */
export interface TenureTier {
  afterMonths: number;
  hoursPerHourWorked: number;
}

export interface AccrualPolicy {
  leaveType: LeaveType;
  hoursPerHourWorked: number; // flat rate, e.g. 1 hr per 30 worked = 0.0333
  annualCap: number; // max hrs accrued per calendar year; 0 = no cap
  carryoverCap: number; // max hrs carried into next year; 0 = no cap
  waitingDays: number; // days after hire before leave may be USED
  tenureTiers: TenureTier[]; // empty ⇒ flat rate
}

/** One worked-time record, pre-localized and pre-summed by the caller.
 *  `isLeave` marks PTO/sick entries so they don't themselves earn accrual. */
export interface WorkedBucketEntry {
  localDate: string; // "YYYY-MM-DD" org-local
  hours: number;
  isLeave?: boolean;
}

// ── Rounding ────────────────────────────────────────────────────────────────
/** Round to 2 decimals — hours are shown/stored to the hundredth. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Pay periods ───────────────────────────────────────────────────────────────
const PERIOD_RE = /^(\d{4})-(\d{2})-([AB])$/;

/** Days in a given month. `month` is 1-based. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Org-local date "YYYY-MM-DD" → the pay-period id it falls in. */
export function periodIdForDate(localDate: string): string {
  const m = localDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Bad local date: ${localDate}`);
  const half = Number(m[3]) <= 15 ? "A" : "B";
  return `${m[1]}-${m[2]}-${half}`;
}

/** Inclusive calendar bounds of a period, as "YYYY-MM-DD" strings. */
export function periodBounds(periodId: string): { start: string; end: string } {
  const m = periodId.match(PERIOD_RE);
  if (!m) throw new Error(`Bad period id: ${periodId}`);
  const [, yyyy, mm, half] = m;
  if (half === "A") return { start: `${yyyy}-${mm}-01`, end: `${yyyy}-${mm}-15` };
  const last = String(daysInMonth(Number(yyyy), Number(mm))).padStart(2, "0");
  return { start: `${yyyy}-${mm}-16`, end: `${yyyy}-${mm}-${last}` };
}

/** The period immediately after `periodId`. */
export function nextPeriodId(periodId: string): string {
  const m = periodId.match(PERIOD_RE);
  if (!m) throw new Error(`Bad period id: ${periodId}`);
  const [, yyyy, mm, half] = m;
  if (half === "A") return `${yyyy}-${mm}-B`;
  let y = Number(yyyy);
  let mo = Number(mm) + 1;
  if (mo > 12) {
    mo = 1;
    y += 1;
  }
  return `${y}-${String(mo).padStart(2, "0")}-A`;
}

/** Ordered, inclusive list of period ids from `fromId` through `toId`.
 *  Returns [] if `fromId` is after `toId`. Bounded to avoid runaway loops. */
export function periodsBetween(fromId: string, toId: string): string[] {
  if (!PERIOD_RE.test(fromId) || !PERIOD_RE.test(toId)) {
    throw new Error(`Bad period id in range: ${fromId}..${toId}`);
  }
  if (fromId > toId) return [];
  const out: string[] = [];
  let cur = fromId;
  for (let guard = 0; guard < 10000; guard++) {
    out.push(cur);
    if (cur === toId) break;
    cur = nextPeriodId(cur);
  }
  return out;
}

// ── Worked hours ──────────────────────────────────────────────────────────────
/** Sum non-leave worked hours whose local date lands inside the given period. */
export function workedHoursInPeriod(entries: WorkedBucketEntry[], periodId: string): number {
  const { start, end } = periodBounds(periodId);
  let total = 0;
  for (const e of entries) {
    if (e.isLeave) continue;
    if (e.localDate >= start && e.localDate <= end) total += e.hours;
  }
  return round2(total);
}

// ── Tenure ────────────────────────────────────────────────────────────────────
/** Whole months of service from `hireDate` to `asOf` (both "YYYY-MM-DD"). */
export function tenureMonths(hireDate: string, asOf: string): number {
  const h = hireDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const a = asOf.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!h || !a) return 0;
  let months = (Number(a[1]) - Number(h[1])) * 12 + (Number(a[2]) - Number(h[2]));
  if (Number(a[3]) < Number(h[3])) months -= 1; // day-of-month not yet reached
  return Math.max(0, months);
}

/** The accrual rate in effect for an employee as of `asOf`. With no tenure
 *  tiers configured this is the flat rate; otherwise the highest tier whose
 *  `afterMonths` threshold the employee has passed (falling back to the flat
 *  rate below the first tier). A blank `hireDate` disables tiering. */
export function resolveAccrualRate(
  policy: AccrualPolicy,
  hireDate: string,
  asOf: string,
): number {
  if (!policy.tenureTiers.length || !hireDate) return policy.hoursPerHourWorked;
  const months = tenureMonths(hireDate, asOf);
  const eligible = policy.tenureTiers
    .filter((t) => months >= t.afterMonths)
    .sort((a, b) => a.afterMonths - b.afterMonths);
  return eligible.length ? eligible[eligible.length - 1].hoursPerHourWorked : policy.hoursPerHourWorked;
}

// ── Accrual ───────────────────────────────────────────────────────────────────
/** Hours earned for one period: rate × worked hours, clamped so the calendar
 *  year's total never exceeds `annualCap` (0 = uncapped). Never negative. */
export function accrualForPeriod(args: {
  rate: number;
  workedHours: number;
  accruedThisYear: number;
  annualCap: number;
}): number {
  const raw = Math.max(0, args.rate * args.workedHours);
  if (args.annualCap > 0) {
    const room = Math.max(0, args.annualCap - args.accruedThisYear);
    return round2(Math.min(raw, room));
  }
  return round2(raw);
}
