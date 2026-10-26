/**
 * How the Bills list orders and groups its rows. Pure, so it is tested
 * (billGroups.test.ts) apart from the page.
 *
 * Sunset bills always form ONE group of their own, whatever the grouping:
 * there are many of them, they are paid off one monthly statement, and mixed
 * into the other bills they bury them.
 */

export type BillSort = "date" | "name";
export type BillGroupBy = "none" | "job" | "vendor";

export interface ListBill {
  id: string;
  jobName?: string;
  fromName?: string;
  issueDate?: string;
}

export interface BillGroup<T> {
  key: string;
  title: string;
  bills: T[];
}

export const isSunset = (b: ListBill) => /sunset/i.test(b.fromName ?? "");

const SUNSET = "Sunset";
const byName = (a: ListBill, b: ListBill) => (a.fromName ?? "").localeCompare(b.fromName ?? "");
const byDateDesc = (a: ListBill, b: ListBill) => (b.issueDate ?? "").localeCompare(a.issueDate ?? "");

export function groupBills<T extends ListBill>(
  bills: T[],
  sort: BillSort,
  groupBy: BillGroupBy,
): BillGroup<T>[] {
  const cmp =
    sort === "name"
      ? (a: T, b: T) => byName(a, b) || byDateDesc(a, b)
      : (a: T, b: T) => byDateDesc(a, b) || byName(a, b);
  const fallback = groupBy === "job" ? "No job" : "Unknown vendor";
  const titleOf = (b: T) =>
    isSunset(b)
      ? SUNSET
      : groupBy === "job"
        ? b.jobName || fallback
        : groupBy === "vendor"
          ? b.fromName || fallback
          : "To code";

  const groups = new Map<string, T[]>();
  for (const b of [...bills].sort(cmp)) {
    const t = titleOf(b);
    groups.set(t, [...(groups.get(t) ?? []), b]);
  }
  // A→Z, with the catch-all and then Sunset at the foot.
  const rank = (t: string) => (t === SUNSET ? 2 : t === fallback ? 1 : 0);
  return [...groups.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((title) => ({ key: title, title, bills: groups.get(title)! }));
}
