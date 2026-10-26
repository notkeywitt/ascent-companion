/**
 * The pay-period TIME ENTRIES email — every employee's JobTread time for one
 * half month, as the CSV JobTread's own time page exports, sent to the
 * bookkeeper and the owners. Modelled on "Oct 1-15 Time Entries", sent
 * 2026-10-16: the CSV here reproduces that attachment byte for byte when it is
 * written in the same time zone (checked against the sent file).
 *
 * Pure: the route (`/api/employee-time/email`) reads the entries
 * (getTimeEntriesForExport), and Apps Script (`draftTimeEntriesEmail`) saves the
 * Gmail draft. The office reads and sends the draft by hand.
 */
import { JT_ORG_TZ, jtIsoToOrgLocal, orgLocalToJtIso, type ExportTimeEntry } from "./jobtread";
import { SIGNATURE_HTML, SIGNATURE_TEXT } from "./emailSignature";

/** The same three addresses, in the same order, as the email it replaces. */
export const TIME_ENTRIES_EMAIL_TO = [
  "casey@ascentbuildingco.com",
  "ty@ascentbuildingco.com",
  "booksbysara@hotmail.com",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** One half of a month: "a" is the 1st–15th, "b" the 16th–end. */
export interface PayPeriod {
  /** "2026-10-a" — one Gmail draft per key. */
  key: string;
  ym: string;
  half: "a" | "b";
  /** Inclusive org-local calendar days. */
  start: string;
  end: string;
  /** The UTC instants that bound it, for the JobTread read: [since, until). */
  sinceIso: string;
  untilIso: string;
  startDay: number;
  endDay: number;
  monthName: string;
}

/** "2026-10" + "b" → the 16th–31st of October, with its JobTread bounds. Null if malformed. */
export function payPeriod(ym: string, half: "a" | "b"): PayPeriod | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m || (half !== "a" && half !== "b")) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDay = half === "a" ? 1 : 16;
  const endDay = half === "a" ? 15 : last;
  const day = (d: number) => `${ym}-${String(d).padStart(2, "0")}`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return {
    key: `${ym}-${half}`,
    ym,
    half,
    start: day(startDay),
    end: day(endDay),
    // Midnight org time on the first day, to midnight after the last.
    sinceIso: orgLocalToJtIso(`${day(startDay)}T00:00`),
    untilIso: orgLocalToJtIso(half === "a" ? `${day(16)}T00:00` : `${next}T00:00`),
    startDay,
    endDay,
    monthName: MONTHS[month - 1],
  };
}

const HEADER = [
  // JobTread quotes this one header, and only this one. A file that opens with
  // a bare "ID" is read by Excel as a SYLK file and refused.
  '"ID"',
  "User",
  "User Email",
  "Type",
  "Start",
  "End",
  "Hours (HH:MM)",
  "Hours (Decimal)",
  "Approved",
  "Customer",
  "Location",
  "Location: Country",
  "Location: State",
  "Job",
  "Item",
  "Item Group",
  "Code",
  "Notes",
  "Comments",
].join(",");

/** Quote a field only when it needs it, as JobTread does. */
function cell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** An instant → "2026-10-15 18:47" on the wall clock in `tz`. Seconds are dropped, not rounded. */
function stamp(iso: string | null, tz: string): string {
  if (!iso) return "";
  return jtIsoToOrgLocal(iso, tz).slice(0, 16).replace("T", " ");
}

/**
 * JobTread's time-entries CSV: a UTF-8 byte-order mark, the header above, one
 * row per entry, LF line ends and a final LF. Rows run newest start first; two
 * entries that start at the same instant run in employee-name order — JobTread's
 * own order, worked out from the sent file. Hours come from JobTread's
 * `minutes` (a break is already taken out), not from the start→end span.
 *
 * `tz` is the wall clock the Start and End columns are written in. JobTread's
 * export uses the downloading browser's zone; this uses the org's zone, which
 * is what the office means by a day.
 */
export function timeEntriesCsv(entries: ExportTimeEntry[], tz: string = JT_ORG_TZ): string {
  const rows = [...entries]
    .sort((a, b) => {
      const t = Date.parse(b.startedAt) - Date.parse(a.startedAt);
      if (t !== 0) return t;
      return a.userName < b.userName ? -1 : a.userName > b.userName ? 1 : 0;
    })
    .map((e) =>
      [
        e.id,
        e.userName,
        e.userEmail,
        e.type,
        stamp(e.startedAt, tz),
        stamp(e.endedAt, tz),
        `${Math.floor(e.minutes / 60)}:${String(e.minutes % 60).padStart(2, "0")}`,
        String(e.minutes / 60),
        String(e.isApproved),
        e.customer,
        e.location,
        e.locationCountry,
        e.locationState,
        e.jobName,
        e.itemName,
        e.itemGroup,
        [e.codeNumber, e.codeName].filter(Boolean).join(" "),
        e.notes,
        e.comments.join("\n"),
      ]
        .map(cell)
        .join(","),
    );
  return "﻿" + [HEADER, ...rows].join("\n") + "\n";
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The email around the CSV, in the words of the one it replaces:
 * "Oct 1-15 Time Entries" / "Our time cards for the first half of October are
 * attached, thanks!". `today` is the org-local YYYY-MM-DD the file is made —
 * JobTread names its download for that day, so the attachment does too.
 */
export function composeTimeEntriesEmail(
  period: PayPeriod,
  today: string,
): { subject: string; html: string; text: string; fileName: string } {
  const which = period.half === "a" ? "first" : "second";
  const subject = `${period.monthName.slice(0, 3)} ${period.startDay}-${period.endDay} Time Entries`;
  const line = `Our time cards for the ${which} half of ${period.monthName} are attached, thanks!`;
  const html =
    `<div dir="auto">Hi Sara, </div><div dir="auto"><br></div>` +
    `<div dir="auto">${esc(line)}<br clear="all"><br clear="all">` +
    `<div dir="auto">${SIGNATURE_HTML}</div></div>`;
  const text = `Hi Sara,\n\n${line}\n\n${SIGNATURE_TEXT}`;
  return { subject, html, text, fileName: `time-entries-${today}.csv` };
}
