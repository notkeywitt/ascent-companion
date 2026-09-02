/**
 * QuickBooks-Time-format labor rows — the REVERSE of /labor-import.
 *
 * /labor-import reads the monthly QuickBooks Time labor export and turns it into
 * a JobTread time-entry import. This turns JobTread's time entries back into
 * that same 23-column shape, so a month of labor can be handed to QuickBooks (or
 * round-tripped straight back through /labor-import).
 *
 * THE SHAPE IS COPIED FROM THE REAL FILES, not invented: the monthly sheets in
 * the Drive "Labor" folder ("July '26 Labor" and its siblings) are what the
 * office has always filed, and the Labor Report writes over that same shape so
 * the two are indistinguishable. `buildEntries` in `src/app/labor-import/page.tsx`
 * reads 12 of these 23 columns by header NAME, so the wider row still imports.
 *
 * COLUMNS JOBTREAD CANNOT FILL come out blank, never guessed:
 * `payroll_id`, `group`, `jobcode_3`, `billable`, `class`, `location`,
 * `has_flags` and `flag_types` are QuickBooks Time's own bookkeeping — a device
 * name, a QB payroll id, a worker-set billable flag — and JobTread records no
 * equivalent. `number` is the constant 0 the real exports carry.
 *
 * TIMEZONE. A JobTread timestamp is a true UTC instant; QuickBooks' export is
 * the org's Pacific wall clock. `orgParts` (lib/orgTime) does that read the same
 * way every other browser surface here does, so a 9 AM entry exports as 9 AM,
 * not the 4 PM a raw ISO slice would give. The `tz` column reports the offset
 * that read used (-7 in summer, -8 in winter), so the row states its own zone.
 *
 * `local_start_time` / `local_end_time` are FULL datetimes ("2026-07-28
 * 14:35:00"), matching the filed exports — /labor-import's `toIso` splits on the
 * space and needs the date half.
 */

import { ORG_TZ, orgParts } from "@/lib/orgTime";

/** The minimum a time entry needs to become a QB labor row. A superset of this
 *  (the org-wide `OrgMonthTimeEntry`) is accepted — only these fields are read. */
export interface QbLaborEntry {
  employee: string; // JobTread display name, e.g. "Cedar" or "Ty O'Steen"
  username?: string; // JobTread email address; falls back to the display name
  startedAt: string | null; // UTC instant ISO
  endedAt?: string | null; // UTC instant ISO, null/absent on a still-running entry
  hours: number;
  code: string; // cost-code number, e.g. "01 31 20"
  codeName: string; // cost-code name, e.g. "Project Management"
  notes: string;
  isApproved: boolean;
  customer?: string; // → jobcode_1 (the CUSTOMER)
  jobName?: string; // → jobcode_2 (the specific JOB)
}

/** Header row, matching the QuickBooks Time export the Labor folder already holds. */
export const QB_LABOR_HEADERS = [
  "username",
  "payroll_id",
  "fname",
  "lname",
  "number",
  "group",
  "local_date",
  "local_day",
  "local_start_time",
  "local_end_time",
  "tz",
  "hours",
  "jobcode_1",
  "jobcode_2",
  "jobcode_3",
  "billable",
  "class",
  "service item",
  "location",
  "notes",
  "approved_status",
  "has_flags",
  "flag_types",
] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The Drive file name for one month's report: 2026, 7 → "July '26 Labor".
 *
 * Copied from the sheets already filed in the Labor folder, not invented. It is
 * also the report's IDENTITY — Apps Script finds the month's existing sheet by
 * this exact name and overwrites it — so changing the format orphans every
 * report filed before the change and starts a second series beside it.
 */
export function laborReportTitle(year: number, month: number): string {
  return `${MONTHS[month - 1]} '${String(year).slice(-2)} Labor`;
}

/** Quote a field only when it carries a comma, quote or newline (RFC-4180). */
function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "HH:MM" → "HH:MM:SS"; "" stays "" (a running entry has no end). */
const withSeconds = (hhmm: string) => (hhmm ? `${hhmm}:00` : "");

/** "2026-07-28 14:35:00" from an instant; "" when there isn't one. */
function localStamp(iso: string | null | undefined): string {
  const p = orgParts(iso);
  return p.date && p.time ? `${p.date} ${withSeconds(p.time)}` : "";
}

/** The org's UTC offset in whole hours at an instant: -7 in PDT, -8 in PST. */
function orgOffsetHours(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const name = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TZ, timeZoneName: "longOffset" })
    .formatToParts(new Date(t))
    .find((x) => x.type === "timeZoneName")?.value;
  const m = /GMT([+-]\d{1,2})/.exec(name ?? "");
  return m ? String(Number(m[1])) : "";
}

/** "Tue" — the org-local weekday, the `local_day` column. */
function orgWeekday(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: ORG_TZ, weekday: "short" }).format(new Date(t));
}

/** Split a JobTread display name into QB's first/last: first token vs. the rest.
 *  "Cedar" → { fname: "Cedar", lname: "" }; "Ty O'Steen" → { "Ty", "O'Steen" }. */
function splitName(full: string): { fname: string; lname: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fname: "", lname: "" };
  return { fname: parts[0], lname: parts.slice(1).join(" ") };
}

/** One QB row from one time entry, in QB_LABOR_HEADERS order. */
function rowOf(e: QbLaborEntry): string[] {
  const { fname, lname } = splitName(e.employee);
  const start = orgParts(e.startedAt);
  return [
    (e.username ?? "").trim() || e.employee, // username
    "", // payroll_id — QuickBooks' own id, not in JobTread
    fname,
    lname,
    "0", // number — the constant the filed exports carry
    "", // group — a QuickBooks Time crew, not in JobTread
    start.date, // local_date
    orgWeekday(e.startedAt), // local_day
    localStamp(e.startedAt), // local_start_time
    localStamp(e.endedAt), // local_end_time
    orgOffsetHours(e.startedAt), // tz
    Number.isFinite(e.hours) ? e.hours.toFixed(2) : "0.00",
    (e.customer ?? "").trim(), // jobcode_1 — the CUSTOMER
    (e.jobName ?? "").trim(), // jobcode_2 — the specific JOB
    "", // jobcode_3 — a QB activity level JobTread has no field for
    "", // billable — worker-set in QuickBooks Time, not in JobTread
    "", // class
    (e.code ?? "").trim(), // service item — the cost-code number
    "", // location — the device the entry was made on, not in JobTread
    e.notes ?? "",
    e.isApproved ? "approved" : "unapproved",
    "", // has_flags
    "", // flag_types
  ];
}

/**
 * Header + one row per time entry, ready to write into a sheet.
 * Rows come out oldest-first within each employee, the way the filed exports read.
 */
export function buildQbLaborRows(entries: QbLaborEntry[]): string[][] {
  const sorted = [...entries].sort(
    (a, b) =>
      (a.employee ?? "").localeCompare(b.employee ?? "") ||
      String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")),
  );
  return [[...QB_LABOR_HEADERS], ...sorted.map(rowOf)];
}

/** The same rows as one CRLF-terminated CSV. */
export function buildQbLaborCsv(entries: QbLaborEntry[]): string {
  return buildQbLaborRows(entries)
    .map((r) => r.map(csvField).join(","))
    .join("\r\n");
}
