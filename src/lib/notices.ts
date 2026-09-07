/**
 * Notices — the shared rules for WHO sees an in-app notice and WHEN.
 *
 * PURE module — no DB, Node, or React imports — so the same three questions get
 * one answer everywhere: the reader feed (`/api/notices`), the authoring route
 * (`/api/admin/notices`) and the authoring panel
 * (`src/components/NoticesAdmin.tsx`) all decide targeting, the schedule window
 * and the wording of both from here. Duplicating the match rule in the route and
 * the panel is how a notice ends up listed as "Live" on the authoring page while
 * nobody's phone shows it.
 *
 * THE AUDIENCE MODEL — a notice targets any mix of GROUPS (roles) and PEOPLE
 * (login emails), held as two comma-separated columns:
 *   - `audienceRoles`  e.g. "office,field"
 *   - `audienceEmails` e.g. "sam@ascentbuildingco.com,jo@…"
 * Both empty means EVERYONE. The two lists are OR'd, so a notice aimed at the
 * field role plus one office person reaches both.
 *
 * The older single-target columns (`audienceType` "role"/"user" +
 * `audienceValue`) are still read here, so rows written before multi-targeting
 * keep working with no data migration. Nothing writes that shape any more — the
 * routes only ever write "all" or "targeted" — but the matcher folds a legacy
 * value into the right list rather than trusting the column pair alone.
 */

import { ROLES, type Role } from "@/lib/views";

/** How a notice reaches the reader. */
export type NoticeDisplay = "banner" | "popup";
export const NOTICE_DISPLAYS: NoticeDisplay[] = ["banner", "popup"];

export type NoticeTone = "info" | "warning" | "success";
export const NOTICE_TONES: NoticeTone[] = ["info", "warning", "success"];

/** The audience columns of a notice row. */
export interface NoticeAudience {
  /** "all" | "targeted" — plus the legacy "role" | "user". */
  audienceType: string;
  /** Legacy single role name or email. "" on every row written today. */
  audienceValue: string;
  /** Comma-separated role names. */
  audienceRoles: string;
  /** Comma-separated lower-cased login emails. */
  audienceEmails: string;
}

/** The schedule columns of a notice row. ISO strings; "" means open-ended. */
export interface NoticeSchedule {
  active: boolean;
  startsAt: string;
  endsAt: string;
}

/** Who is reading, resolved server-side from the session — never from a request body. */
export interface NoticeReader {
  email: string;
  role: string;
}

/** Split a stored comma-separated column into trimmed, de-duplicated entries. */
export function parseList(value: string | null | undefined): string[] {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

/** The storage form of a list column. */
export function joinList(values: string[]): string {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].join(",");
}

/** Keep only real role names (drops a renamed or mistyped role). */
export function cleanRoles(values: unknown): Role[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter((v): v is Role => typeof v === "string" && ROLES.includes(v as Role)),
    ),
  ];
}

/** Lower-case, de-duplicate, and keep only things shaped like an email. */
export function cleanEmails(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v.includes("@")),
    ),
  ];
}

/** The roles a notice targets, legacy single-role rows included. */
export function noticeRoles(a: NoticeAudience): string[] {
  const list = parseList(a.audienceRoles);
  if (a.audienceType === "role" && a.audienceValue) list.push(a.audienceValue.trim());
  return [...new Set(list.filter(Boolean))];
}

/** The people a notice targets, legacy single-user rows included. */
export function noticeEmails(a: NoticeAudience): string[] {
  const list = parseList(a.audienceEmails).map((e) => e.toLowerCase());
  if (a.audienceType === "user" && a.audienceValue) {
    list.push(a.audienceValue.trim().toLowerCase());
  }
  return [...new Set(list.filter(Boolean))];
}

/**
 * True when the notice is aimed at the whole company.
 *
 * A legacy row is NEVER read as everyone: "role"/"user" with an empty value is a
 * broken row, and reading it as "all" would broadcast a notice that was meant
 * for one person.
 */
export function isEveryone(a: NoticeAudience): boolean {
  if (a.audienceType === "all") return true;
  if (a.audienceType === "role" || a.audienceType === "user") return false;
  return noticeRoles(a).length === 0 && noticeEmails(a).length === 0;
}

/** Does this notice target this reader? Groups and people are OR'd. */
export function audienceMatches(a: NoticeAudience, reader: NoticeReader): boolean {
  if (isEveryone(a)) return true;
  const email = reader.email.trim().toLowerCase();
  if (email && noticeEmails(a).includes(email)) return true;
  return !!reader.role && noticeRoles(a).includes(reader.role);
}

/** Milliseconds for an ISO stamp, or null for "" / an unparseable value. */
function at(iso: string | null | undefined): number | null {
  const s = String(iso ?? "").trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Where a notice sits in its own schedule:
 *   off       — switched off by hand; the window is irrelevant
 *   scheduled — the start time has not arrived
 *   ended     — the end time has passed
 *   live      — showing now
 */
export type NoticeStatus = "off" | "scheduled" | "ended" | "live";

export function noticeStatus(s: NoticeSchedule, now: number = Date.now()): NoticeStatus {
  if (!s.active) return "off";
  const ends = at(s.endsAt);
  if (ends !== null && now >= ends) return "ended";
  const starts = at(s.startsAt);
  if (starts !== null && now < starts) return "scheduled";
  return "live";
}

/** Should the reader feed carry this notice right now? */
export function isLive(s: NoticeSchedule, now: number = Date.now()): boolean {
  return noticeStatus(s, now) === "live";
}

/**
 * A window with an end before its start can never show, so the authoring route
 * rejects it rather than storing a notice that silently does nothing.
 */
export function windowIsOrdered(startsAt: string, endsAt: string): boolean {
  const a = at(startsAt);
  const b = at(endsAt);
  return a === null || b === null || b > a;
}

export const ROLE_PLURAL: Record<Role, string> = {
  admin: "Admins",
  office: "Office",
  lead: "Leads",
  field: "Field",
};

/** One line naming the audience — "Everyone", "Office, Field · 2 people". */
export function audienceLabel(a: NoticeAudience): string {
  if (isEveryone(a)) return "Everyone";
  const roles = noticeRoles(a).map((r) => ROLE_PLURAL[r as Role] ?? r);
  const people = noticeEmails(a).length;
  const parts: string[] = [];
  if (roles.length) parts.push(roles.join(", "));
  if (people) parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  return parts.length ? parts.join(" · ") : "No one";
}
