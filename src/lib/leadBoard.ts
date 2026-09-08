/**
 * The lead board's card shape + the pure date math behind it — shared by the
 * /leads page and the Leads panel on the home page, so both read a lead the
 * same way.
 *
 * Client-safe on purpose (same rule as lib/jobBoard.ts): the cards render in
 * the browser, so nothing here may import the Pave layer or the DB. The reads
 * that fill these live in /api/leads.
 *
 * ORDER BY LAST CONTACT is the whole point of the home panel. A lead with no
 * touch ever logged is ordered from the day it arrived, not treated as
 * infinitely fresh — that is what stops a brand-new lead nobody has called
 * from sitting quietly at the wrong end of the row.
 */

/** Today, as YYYY-MM-DD in UTC. Every date in this schema is a plain day. */
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Whole days between a date and today. Null if unparseable.
 *
 * The date part is taken FIRST, so a full ISO timestamp (JobTread's
 * `createdAt`) is compared midnight-to-midnight like a plain YYYY-MM-DD is —
 * otherwise an account created at 17:22Z reads a day younger than it is.
 */
export function daysSince(date: string): number | null {
  if (!date) return null;
  const then = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const now = Date.parse(`${today()}T00:00:00Z`);
  return Math.round((now - then) / 86_400_000);
}

/** "2026-09-08" → "Sep 8, 2026". "—" for nothing. */
export function fmtDate(date: string): string {
  if (!date) return "—";
  const t = Date.parse(date.length <= 10 ? `${date}T00:00:00Z` : date);
  if (Number.isNaN(t)) return date;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/* ------------------------------------------------------------------ shapes */

/** The tracking row the Companion keeps for a lead (see db/schema.ts `leads`). */
export interface LeadTracking {
  stage: string;
  nextAction: string;
  nextActionDate: string;
  lastContactDate: string;
  estValue: string;
  /** What the job actually is, in our words. Blank until someone writes it. */
  projectScope: string;
  notes: string;
  updatedAt: string;
}

/** The parts of a lead (as /api/leads returns it) that a board card reads. */
export interface LeadLike {
  id: string;
  name: string;
  address: string;
  createdAt: string;
  local: boolean;
  tracking: LeadTracking;
  /** The intake answers, when the lead came from the website form. */
  inquiry: { projectDetails: string; address: string } | null;
}

/** One lead, reduced to the five lines the home panel shows. */
export interface LeadCard {
  id: string;
  name: string;
  address: string;
  /** The last logged touch, or "" when there has never been one. */
  lastContactDate: string;
  /** Days since that touch — or since the lead arrived, when there is none. */
  quietDays: number | null;
  /** True when `quietDays` is measured from arrival rather than a real touch. */
  neverContacted: boolean;
  projectScope: string;
  nextAction: string;
  nextActionDate: string;
  stage: string;
  local: boolean;
}

/**
 * The project scope, in the order we trust it: what someone wrote in the scope
 * field, then what the lead themself typed into the website form. Our working
 * `notes` are NOT a fallback — those are what we think, not what the job is.
 */
export function leadScope(lead: LeadLike): string {
  return (lead.tracking.projectScope || lead.inquiry?.projectDetails || "").trim();
}

/** The lead's address, falling back to the one they gave the website form. */
export function leadAddress(lead: LeadLike): string {
  return (lead.address || lead.inquiry?.address || "").trim();
}

/**
 * The date the ordering is measured from: the last touch, or the day the lead
 * arrived when nothing has been logged.
 */
export function contactAnchor(lead: LeadLike): string {
  return (lead.tracking.lastContactDate || lead.createdAt || "").slice(0, 10);
}

export function toLeadCard(lead: LeadLike): LeadCard {
  const neverContacted = !lead.tracking.lastContactDate;
  return {
    id: lead.id,
    name: lead.name,
    address: leadAddress(lead),
    lastContactDate: lead.tracking.lastContactDate,
    quietDays: daysSince(contactAnchor(lead)),
    neverContacted,
    projectScope: leadScope(lead),
    nextAction: lead.tracking.nextAction,
    nextActionDate: lead.tracking.nextActionDate,
    stage: lead.tracking.stage,
    local: lead.local,
  };
}

/* ------------------------------------------------------- quiet thresholds */

/**
 * When a quiet lead starts showing amber, and when it goes red. ONE definition
 * for the whole app: the home panel's card colour, the /leads card chips, that
 * page's "Gone quiet" filter and its headline count all read these, so the
 * board cannot say a lead is quiet while the panel paints it calm.
 *
 * Org-wide and DB-backed (`lead_settings`, one row) rather than per device —
 * a threshold the office and the owner disagree about is not a threshold.
 * These are the values a database with no row yet falls back to.
 */
export interface LeadQuietThresholds {
  /** Days of silence before a lead reads amber. */
  warnDays: number;
  /** Days of silence before it reads red. */
  alertDays: number;
}

export const LEAD_QUIET_DEFAULTS: LeadQuietThresholds = { warnDays: 7, alertDays: 14 };

/** The widest either threshold may be set to. A year of silence is not a lead. */
export const LEAD_QUIET_MAX = 365;

/**
 * Force any input into a usable pair. The route and the form both run this, so
 * a hand-typed 0, a blank field, a swapped pair or a string out of JSON can
 * never reach the colour maths.
 *
 * `alertDays` is pushed to at least `warnDays + 1`, not rejected: a saved pair
 * where red starts before amber would paint amber on a band that no longer
 * exists, and silently widening the red band is the reading the office meant.
 */
export function normalizeThresholds(raw: Partial<Record<keyof LeadQuietThresholds, unknown>>): LeadQuietThresholds {
  const whole = (v: unknown, fallback: number): number => {
    // A BLANK field is absent, not zero. Number("") is 0, which is finite, so
    // without this an empty input would clamp to 1 day and silently make every
    // lead amber instead of leaving the threshold alone.
    if (v === null || v === undefined) return fallback;
    if (typeof v === "string" && v.trim() === "") return fallback;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(LEAD_QUIET_MAX, Math.max(1, n));
  };
  const warnDays = whole(raw.warnDays, LEAD_QUIET_DEFAULTS.warnDays);
  const alertDays = Math.min(
    LEAD_QUIET_MAX,
    Math.max(warnDays + 1, whole(raw.alertDays, LEAD_QUIET_DEFAULTS.alertDays)),
  );
  return { warnDays, alertDays };
}

/** Which band a lead's silence falls in. `null` days = no dates to judge. */
export type QuietBand = "unknown" | "ok" | "warn" | "alert";

export function quietBand(days: number | null, t: LeadQuietThresholds): QuietBand {
  if (days === null) return "unknown";
  if (days >= t.alertDays) return "alert";
  if (days >= t.warnDays) return "warn";
  return "ok";
}

/* ------------------------------------------------------------------ order */

/**
 * Which end of the contact timeline comes first. "quiet" (furthest away) is the
 * default: the panel exists so a lead cannot go silent unnoticed.
 */
export type LeadOrder = "quiet" | "recent";

export const LEAD_ORDERS: { id: LeadOrder; label: string }[] = [
  { id: "quiet", label: "Longest ago" },
  { id: "recent", label: "Most recent" },
];

/** Sort by last contact. A card with no anchor date at all goes last, either way. */
export function sortLeadCards(cards: LeadCard[], order: LeadOrder): LeadCard[] {
  const days = (c: LeadCard) => c.quietDays;
  return [...cards].sort((a, b) => {
    const da = days(a);
    const db = days(b);
    if (da === null || db === null) {
      if (da === db) return a.name.localeCompare(b.name);
      return da === null ? 1 : -1;
    }
    // Furthest away = the most days quiet. Most recent = the fewest.
    return (order === "quiet" ? db - da : da - db) || a.name.localeCompare(b.name);
  });
}

/** The card's one line about contact: the date, and how long ago that was. */
export function contactLine(c: LeadCard): string {
  const ago =
    c.quietDays === null ? "" : ` · ${c.quietDays} day${c.quietDays === 1 ? "" : "s"} ago`;
  if (!c.lastContactDate) {
    return c.quietDays === null
      ? "No contact logged"
      : `No contact logged · ${c.quietDays} day${c.quietDays === 1 ? "" : "s"} since it arrived`;
  }
  return `${fmtDate(c.lastContactDate)}${ago}`;
}
