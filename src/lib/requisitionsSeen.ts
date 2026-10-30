/**
 * "New" requisitions — the ones the office has not opened yet.
 *
 * ReqIDs are `REQ-yyyyMMdd-HHmmss` (Requisitions.js), so they sort by time as
 * plain strings. The newest ReqID this device has shown on /requisitions is the
 * line: anything after it is new. Kept in localStorage, so it is PER DEVICE —
 * the office email is the cross-device signal. No mark yet counts every open
 * request as new; one visit clears it.
 */

const KEY = "requisitions.seenReqId";

type Row = Record<string, string>;

function seen(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/** Requests still at "Requested" that arrived after the last visit. */
export function countNewRequisitions(rows: Row[]): number {
  const line = seen();
  return rows.filter((r) => (!r.Status || r.Status === "Requested") && (r.ReqID ?? "") > line).length;
}

/** Record the newest request in `rows` as seen. Never moves the line back. */
export function markRequisitionsSeen(rows: Row[]): void {
  const newest = rows.reduce((m, r) => ((r.ReqID ?? "") > m ? r.ReqID : m), seen());
  try {
    localStorage.setItem(KEY, newest);
  } catch {
    /* storage blocked — the mark just stays */
  }
}
