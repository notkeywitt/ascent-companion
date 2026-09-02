/**
 * QuickBooks-format labor CSV — the REVERSE of /labor-import.
 *
 * /labor-import reads the monthly QuickBooks Time labor export (columns
 * `username`, `fname`, `lname`, `local_date`, `local_start_time`,
 * `local_end_time`, `hours`, `jobcode_1`, `jobcode_2`, `service item`, `notes`,
 * `approved_status`) and turns it into a JobTread time-entry import. This turns a
 * job's JobTread time entries back into that same shape, so a month of labor can
 * be handed to QuickBooks (or round-tripped straight back through /labor-import).
 *
 * The columns and their meanings match `buildEntries` in
 * `src/app/labor-import/page.tsx` exactly — that parser is the definition of "the
 * format QB creates" as this system consumes it, so the two stay a matched pair.
 *
 * TIMEZONE. A JobTread timestamp is a true UTC instant; QuickBooks' export is the
 * org's Pacific wall clock. `orgParts` (lib/orgTime) does that read the same way
 * every other browser surface here does, so a 9 AM entry exports as 9 AM, not the
 * 4 PM a raw ISO slice would give. This is deliberately the mirror image of what
 * JobTread's importer expects (a zoneless org-local stamp) — don't "unify" them.
 */

import { orgParts } from "@/lib/orgTime";

/** The minimum a time entry needs to become a QB labor row. A superset of this
 *  (the Labor Review `TimeEntry`) is accepted — only these fields are read. */
export interface QbLaborEntry {
  employee: string; // JobTread display name, e.g. "Cedar" or "Ty O'Steen"
  startedAt: string | null; // UTC instant ISO
  endedAt?: string | null; // UTC instant ISO, null/absent on a still-running entry
  hours: number;
  code: string; // cost-code number, e.g. "01 31 20"
  codeName: string; // cost-code name, e.g. "Project Management"
  notes: string;
  isApproved: boolean;
}

/** The job the entries belong to — its customer + name are QB's two job columns. */
export interface QbLaborJob {
  name: string; // → jobcode_2 (the specific JOB)
  customer: string; // → jobcode_1 (the CUSTOMER)
}

/** Header row, named to match the QuickBooks Time export /labor-import reads. */
export const QB_LABOR_HEADERS = [
  "username",
  "fname",
  "lname",
  "local_date",
  "local_start_time",
  "local_end_time",
  "hours",
  "jobcode_1",
  "jobcode_2",
  "service item",
  "notes",
  "approved_status",
] as const;

/** Quote a field only when it carries a comma, quote or newline (RFC-4180). */
function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "HH:MM" → "HH:MM:SS"; "" stays "" (a running entry has no end). */
const withSeconds = (hhmm: string) => (hhmm ? `${hhmm}:00` : "");

/** Split a JobTread display name into QB's first/last: first token vs. the rest.
 *  "Cedar" → { fname: "Cedar", lname: "" }; "Ty O'Steen" → { "Ty", "O'Steen" }. */
function splitName(full: string): { fname: string; lname: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fname: "", lname: "" };
  return { fname: parts[0], lname: parts.slice(1).join(" ") };
}

/** The `service item` value: cost-code number + name, mirroring how QB labels a
 *  CSI service item (which /labor-import then matches the code back out of). */
function serviceItem(e: QbLaborEntry): string {
  return [e.code, e.codeName].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
}

/** One QB row from one time entry. */
function rowOf(e: QbLaborEntry, job: QbLaborJob): string[] {
  const start = orgParts(e.startedAt);
  const end = orgParts(e.endedAt);
  const { fname, lname } = splitName(e.employee);
  return [
    e.employee, // username — the display name is the best identifier JobTread carries
    fname,
    lname,
    start.date,
    withSeconds(start.time),
    withSeconds(end.time),
    Number.isFinite(e.hours) ? e.hours.toFixed(2) : "0.00",
    job.customer,
    job.name,
    serviceItem(e),
    e.notes ?? "",
    e.isApproved ? "Approved" : "Not Approved",
  ];
}

/**
 * Build the QuickBooks-format labor CSV for a job's month of time entries.
 * Rows come out oldest-first (how a QB export reads), CRLF-terminated.
 */
export function buildQbLaborCsv(entries: QbLaborEntry[], job: QbLaborJob): string {
  const sorted = [...entries].sort((a, b) =>
    String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")),
  );
  const lines = [QB_LABOR_HEADERS.join(",")];
  for (const e of sorted) lines.push(rowOf(e, job).map(csvField).join(","));
  return lines.join("\r\n");
}
