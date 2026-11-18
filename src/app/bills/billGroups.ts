/**
 * How the Bills list orders and groups its rows. Pure, so it is tested
 * (billGroups.test.ts) apart from the page.
 *
 * Sunset bills always form ONE group of their own, whatever the grouping:
 * there are many of them, they are paid off one monthly statement, and mixed
 * into the other bills they bury them.
 *
 * Each sort has a natural direction (date and amount: newest / biggest first;
 * name and job: A to Z). `reverse` flips the rows AND the order of the groups.
 */

import { isAscentJob } from "@/lib/ascentJobs";

export type BillSort = "date" | "name" | "amount" | "job";
export type BillGroupBy = "none" | "job" | "vendor" | "date" | "month" | "code";

export interface ListBill {
  id: string;
  jobName?: string;
  fromName?: string;
  issueDate?: string;
  cost?: number;
  /** Marked reviewed in the coding card. */
  reviewed?: boolean;
}

export interface BillGroup<T> {
  key: string;
  title: string;
  bills: T[];
}

export const isSunset = (b: ListBill) => /sunset/i.test(b.fromName ?? "");

const SUNSET = "Sunset";
const byName = (a: ListBill, b: ListBill) => (a.fromName ?? "").localeCompare(b.fromName ?? "");
const byJob = (a: ListBill, b: ListBill) => (a.jobName ?? "").localeCompare(b.jobName ?? "");
const byDateDesc = (a: ListBill, b: ListBill) => (b.issueDate ?? "").localeCompare(a.issueDate ?? "");
const byCostDesc = (a: ListBill, b: ListBill) => (b.cost ?? 0) - (a.cost ?? 0);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10-19" gives "October 2026". */
const monthTitle = (d?: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(d ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : "No date";
};
/** "2026-10-19" gives "Oct 19, 2026". */
const dayTitle = (d?: string) => {
  const dt = new Date((d ?? "") + "T00:00:00");
  return d && !Number.isNaN(dt.getTime())
    ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "No date";
};

export function groupBills<T extends ListBill>(
  bills: T[],
  sort: BillSort,
  groupBy: BillGroupBy,
  reverse = false,
): BillGroup<T>[] {
  const natural =
    sort === "name"
      ? (a: T, b: T) => byName(a, b) || byDateDesc(a, b)
      : sort === "job"
        ? (a: T, b: T) => byJob(a, b) || byDateDesc(a, b)
        : sort === "amount"
          ? (a: T, b: T) => byCostDesc(a, b) || byDateDesc(a, b)
          : (a: T, b: T) => byDateDesc(a, b) || byName(a, b);
  const cmp = reverse ? (a: T, b: T) => natural(b, a) : natural;

  const fallback = groupBy === "job" ? "No job" : groupBy === "vendor" ? "Unknown vendor" : "No date";
  const titleOf = (b: T) =>
    isSunset(b)
      ? SUNSET
      : groupBy === "job"
        ? b.jobName || fallback
        : groupBy === "vendor"
          ? b.fromName || fallback
          : groupBy === "month"
            ? monthTitle(b.issueDate)
            : groupBy === "date"
              ? dayTitle(b.issueDate)
              : groupBy === "code"
                ? b.reviewed
                  ? "Reviewed"
                  : "To code"
                : "To code";
  // A date group sorts by the date itself, not its words ("Oct 5" vs "Oct 19").
  const keyOf = (b: T) =>
    groupBy === "month" ? (b.issueDate ?? "").slice(0, 7) : groupBy === "date" ? b.issueDate ?? "" : "";

  const groups = new Map<string, T[]>();
  const keys = new Map<string, string>();
  for (const b of [...bills].sort(cmp)) {
    const t = titleOf(b);
    groups.set(t, [...(groups.get(t) ?? []), b]);
    if (!keys.has(t)) keys.set(t, keyOf(b));
  }
  // Groups: dates newest first, "To code" before "Reviewed", the rest A to Z.
  // Ascent jobs, the catch-all, then Sunset, sit at the foot. Reverse flips all but the foot.
  // Ascent's own jobs sit just above the catch-all, below the client jobs.
  const rank = (t: string) =>
    t === SUNSET ? 3 : t === fallback ? 2 : groupBy === "job" && isAscentJob(t) ? 1 : 0;
  const dated = groupBy === "month" || groupBy === "date";
  const order = (a: string, b: string) =>
    dated
      ? (keys.get(b) ?? "").localeCompare(keys.get(a) ?? "")
      : groupBy === "code"
        ? -a.localeCompare(b)
        : a.localeCompare(b);
  return [...groups.keys()]
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 && reverse ? order(b, a) : order(a, b)))
    .map((title) => ({ key: title, title, bills: groups.get(title)! }));
}
