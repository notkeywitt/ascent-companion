/**
 * Labels and sums for the bills and estimates on a schedule task. Pure and
 * client-safe (the Schedule page, src/app/schedule/TaskDocuments.tsx).
 */
import type { TaskDocument } from "@/lib/jobtread/taskDocuments";

export const DOC_TYPE_LABEL: Record<TaskDocument["type"], string> = {
  vendorBill: "Bill",
  customerOrder: "Estimate",
  vendorOrder: "Vendor order",
  bidRequest: "Bid request",
};

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export interface DocTotals {
  bills: number;
  estimates: number;
  count: number;
}

/** What the task costs so far (bills) and what it was priced at (estimates). */
export function docTotals(docs: TaskDocument[]): DocTotals {
  let bills = 0;
  let estimates = 0;
  for (const d of docs) {
    if (d.type === "vendorBill") bills += d.amount;
    else if (d.type === "customerOrder") estimates += d.amount;
  }
  return { bills: Math.round(bills * 100) / 100, estimates: Math.round(estimates * 100) / 100, count: docs.length };
}

/** The words a person types to find a document in the attach list. */
export function docMatches(d: TaskDocument, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [d.name, d.accountName, d.number === null ? "" : String(d.number), DOC_TYPE_LABEL[d.type], d.status, ...d.costCodes]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/** "Wood Siding" lines of a row: the cost codes, or a plain "no cost code". */
export const codesLine = (d: Pick<TaskDocument, "costCodes">) =>
  d.costCodes.length ? d.costCodes.join(", ") : "No cost code";
