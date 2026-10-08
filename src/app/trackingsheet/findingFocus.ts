/**
 * A labor finding, carried to the job's board in the URL.
 *
 * "Check all Jobs" lives on the all-jobs view; the labor list it points at is
 * on the job's board, which is a different screen. So the link says what to
 * show: `focus=labor`, the person (`emp`) and/or cost code (`code`) to narrow
 * the list to, and the entries to tick (`entries`). The board reads it once,
 * after the month loads, and drops it from the URL.
 *
 * Entry ids stop at MAX_IDS: past that the URL gets long for no gain, and the
 * person/code filter alone still lands on the right rows.
 */
import type { FindingTarget } from "@/lib/invoiceReview/types";

export type LaborFocus = Extract<FindingTarget, { kind: "labor" }>;

const MAX_IDS = 60;

export function laborFocusHref(jobId: string, ym: string, t: LaborFocus): string {
  const q = new URLSearchParams({ jobId, ym, focus: "labor" });
  if (t.employee) q.set("emp", t.employee);
  if (t.code) q.set("code", t.code);
  if (t.entryIds.length && t.entryIds.length <= MAX_IDS) q.set("entries", t.entryIds.join(","));
  return `/trackingsheet?${q.toString()}`;
}

/** The focus a board URL carries, or null when it carries none. */
export function readLaborFocus(params: { get: (k: string) => string | null }): LaborFocus | null {
  if (params.get("focus") !== "labor") return null;
  const employee = params.get("emp") || undefined;
  const code = params.get("code") || undefined;
  const entryIds = (params.get("entries") ?? "").split(",").filter(Boolean);
  return { kind: "labor", employee, code, entryIds };
}

/** The URL's query with the focus taken out — what the board replaces it with. */
export function withoutFocus(query: string): string {
  const q = new URLSearchParams(query);
  for (const k of ["focus", "emp", "code", "entries"]) q.delete(k);
  return q.toString();
}
