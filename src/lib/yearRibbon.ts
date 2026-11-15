/**
 * The year ribbon's shape and its pure math. Client-safe: no Pave import.
 *
 * The ribbon draws one calendar year, January to December. Each job carries two
 * weekly series: crew hours per work day (above the centre line) and vendor
 * bill cost (below it). JobTread groups both by ISO week server-side
 * (`getYearRibbonRows` in jobtread/yearRibbon.ts); this module turns those rows
 * into series and places a week on the year.
 */

/** Weeks are indexed 1..53 by ISO week number; index 0 is unused. */
export const RIBBON_WEEKS = 54;
/** Colours the ribbon has. Jobs past this many fold into "Other". */
export const RIBBON_MAX_JOBS = 6;
const WORK_DAYS = 5;
/**
 * Weeks one week's bills spread over: itself and the three before it. Bills
 * carry a month-end issue date, so a month's spend lands in one week; spread
 * back, it sits beside the crew hours that earned it (owner, 2026-11-15).
 */
export const BILL_SPREAD_WEEKS = 4;

export interface RibbonRow {
  week: number;
  jobId: string;
  value: number;
}

export interface RibbonJob {
  id: string;
  name: string;
  /** Crew hours per work day, by ISO week. */
  hours: number[];
  /** Vendor bill cost in dollars, by ISO week. */
  bills: number[];
}

export interface YearRibbon {
  year: number;
  /** Largest first. The last one may be the "Other" rollup (id ""). */
  jobs: RibbonJob[];
}

const empty = () => new Array<number>(RIBBON_WEEKS).fill(0);
const total = (a: number[]) => a.reduce((s, v) => s + v, 0);

/**
 * Day of the year (0 = Jan 1) on which an ISO week's Monday falls. Negative for
 * a week 1 that starts in December. ISO week 1 is the week holding Jan 4.
 */
export function isoWeekStartDay(year: number, week: number): number {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayOffset = (jan4.getUTCDay() + 6) % 7; // days from that Monday to Jan 4
  return 3 - mondayOffset + (week - 1) * 7;
}

/** Days in the year: 365 or 366. */
export const daysInYear = (year: number) => (new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365);

/** Where a week's middle sits on the year, 0..1 (clamped). */
export function weekPosition(year: number, week: number): number {
  return Math.max(0, Math.min(1, (isoWeekStartDay(year, week) + 3.5) / daysInYear(year)));
}

/**
 * Each week's value shared evenly over itself and the `n - 1` weeks before it.
 * The total is kept: what would fall before week 1 stays in week 1.
 */
export function spreadBack(values: number[], n = BILL_SPREAD_WEEKS): number[] {
  const out = new Array<number>(values.length).fill(0);
  values.forEach((v, w) => {
    if (w < 1 || !v) return;
    for (let k = 0; k < n; k++) out[Math.max(1, w - k)] += v / n;
  });
  return out;
}

/**
 * Every job's two series, unsorted. A negative week total (a credit) draws as 0.
 * Bills are spread back over the month that earned them (`spreadBack`).
 */
export function buildRibbonJobs(
  minuteRows: RibbonRow[],
  billRows: RibbonRow[],
  nameOf: (jobId: string) => string,
): RibbonJob[] {
  const jobs = new Map<string, RibbonJob>();
  const job = (id: string) => {
    let j = jobs.get(id);
    if (!j) jobs.set(id, (j = { id, name: nameOf(id), hours: empty(), bills: empty() }));
    return j;
  };
  const ok = (r: RibbonRow) => r.jobId && r.week >= 1 && r.week < RIBBON_WEEKS && Number.isFinite(r.value);
  for (const r of minuteRows) if (ok(r)) job(r.jobId).hours[r.week] += r.value / 60 / WORK_DAYS;
  for (const r of billRows) if (ok(r)) job(r.jobId).bills[r.week] += r.value;
  for (const j of jobs.values()) j.bills = spreadBack(j.bills.map((v) => Math.max(0, v)));
  return [...jobs.values()];
}

/**
 * The jobs the Home ribbon draws: the largest by share of the year's hours plus
 * share of the year's bills, and the rest summed into one "Other" job.
 */
export function topRibbonJobs(all: RibbonJob[], max = RIBBON_MAX_JOBS): RibbonJob[] {
  const allHours = total(all.map((j) => total(j.hours))) || 1;
  const allBills = total(all.map((j) => total(j.bills))) || 1;
  const weight = (j: RibbonJob) => total(j.hours) / allHours + total(j.bills) / allBills;
  const sorted = all.filter((j) => weight(j) > 0).sort((a, b) => weight(b) - weight(a));
  if (sorted.length <= max) return sorted;
  const other: RibbonJob = { id: "", name: "Other", hours: empty(), bills: empty() };
  for (const j of sorted.slice(max)) {
    j.hours.forEach((v, w) => (other.hours[w] += v));
    j.bills.forEach((v, w) => (other.bills[w] += v));
  }
  return [...sorted.slice(0, max), other];
}
