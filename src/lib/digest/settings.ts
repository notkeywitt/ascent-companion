/**
 * THE Daily Digest settings file. One place, every knob.
 *
 * ── FOR THE OFFICE ──────────────────────────────────────────────────────────
 * Everything you would ever want to change about the morning digest is in this
 * file: which vendors to ignore, the monthly billing cutoff day, which
 * calendars to read, how stale an email has to be before it's chased, and how
 * big a cost/invoice gap has to be before it's worth mentioning. Editing a
 * number here and redeploying changes the digest. You should never have to open
 * a check's code to change a threshold — if you find yourself wanting to, the
 * setting is missing and belongs here.
 *
 * Turning a check OFF is `enabled: false` on its block. The check keeps
 * existing, stops running, and stops appearing.
 *
 * ── FOR THE NEXT DEVELOPER ──────────────────────────────────────────────────
 * A new check adds: a config block here (typed), one line in `registry.ts`, and
 * its own file under `checks/`. Nothing else changes — not the aggregator, not
 * the cron route, not the UI.
 *
 * Every value here is a DEFAULT, not a fact about production. Nothing in this
 * file reaches JobTread, Gmail, Calendar or the Sheet by itself.
 */

/* -------------------------------------------------------------- categories */

/**
 * The digest's categories, in display order. DATA, not a union type — the UI
 * renders whatever categories the stored results carry, looking the label up
 * here and falling back to a title-cased id for one it's never heard of. So
 * adding a "Safety" category is one entry here plus a check that names it.
 */
export interface DigestCategory {
  id: string;
  label: string;
  /** One line under the category header, when it has items. */
  blurb?: string;
}

export const DIGEST_CATEGORIES: DigestCategory[] = [
  { id: "calendar", label: "Calendar", blurb: "What's on the shared calendars and the JobTread schedule." },
  { id: "todo", label: "To-Do", blurb: "Open JobTread to-dos, and appointments/action items found in email." },
  { id: "followup", label: "Follow-ups", blurb: "Conversations waiting on us." },
  // Off by default (2026-08-31) — billing has its own screen (Tracking Sheets /
  // /unbilled), so the digest no longer duplicates it. The checks are OFF, not
  // deleted (see `enabled: false` below); this row stays registered so turning
  // one back on needs no UI change. A category with zero results never renders
  // (see src/lib/digest/grouping.ts), so this simply won't appear while empty.
  { id: "billing", label: "Billing", blurb: "Off for now — billing has its own screens." },
];

/* ----------------------------------------------------------- global config */

export interface DigestGlobalSettings {
  /**
   * The monthly billing cutoff day: bills arriving on or before this day of the
   * month belong to the PREVIOUS month, and a month's drafts should be reviewed
   * and approved/denied by this day of the following month.
   *
   * ⚠️ Currently the 10th, and this has changed before. It must stay in lockstep
   * with `deriveBillingPeriod` in src/lib/billing.ts AND `deriveBillingPeriod`
   * in the appscript repo's Config.js — those two decide where a bill is FILED;
   * this one only decides when the digest starts nagging about it. Changing the
   * rule means changing all three.
   */
  billingCutoffDay: number;
  /** Ceiling on one check's run before the aggregator gives up on it (ms). */
  checkTimeoutMs: number;
  /** Most items any single check may contribute, so one noisy check can't bury the rest. */
  maxItemsPerCheck: number;
}

export const DIGEST_GLOBAL: DigestGlobalSettings = {
  billingCutoffDay: 10,
  checkTimeoutMs: 60_000,
  maxItemsPerCheck: 50,
};

/* ---------------------------------------------------- per-check config types */

/** Check "uncaptured-bills" — invoice mail with no matching JobTread bill. */
export interface UncapturedBillsConfig {
  /** How far back to scan the inbox. */
  lookbackDays: number;
  /** Most candidate emails to pull from Gmail in one run. */
  maxEmails: number;
  /**
   * Vendors whose invoices intentionally never reach JobTread — a vendor billed
   * separately by another department, a personal-card subscription, and so on.
   * Matched case-insensitively as a substring against the sender's display name,
   * address and domain, so "sunset" catches every address at that vendor.
   */
  excludeVendors: string[];
  /** Days either side of the email's arrival to accept as "the same bill". */
  matchWindowDays: number;
  /**
   * How close two amounts must be to count as the same bill, as a fraction. The
   * email's amount (when the subject prints one) is the invoice TOTAL while a
   * JobTread bill's `cost` is pre-tax, so this has to absorb sales tax — 12%
   * covers Washington's rates with room to spare.
   */
  amountTolerance: number;
  /** Most JobTread vendor-bill lookups per run (one per distinct matched vendor). */
  maxVendorLookups: number;
  /**
   * Whether mail from a sender that matches NO JobTread vendor account is
   * flagged. True by default: a bill from a brand-new vendor is exactly the one
   * that gets missed. Set false if it proves noisy — the /email queue and the
   * stuck-vendor banner cover part of the same ground.
   */
  flagUnknownSenders: boolean;
}

/** Check "draft-bills-past-cutoff" — drafts left over from a closed billing month. */
export interface DraftBillsPastCutoffConfig {
  /** Ignore a leftover draft under this many dollars (still counted in the summary). */
  minAmount: number;
  /** How many months back to look before treating a draft as abandoned, not overdue. */
  maxMonthsBack: number;
}

/** Check "reconciliation-flags" — the Expenditure sheet's own scan output. */
export interface ReconciliationFlagsConfig {
  /** Rows to pull from the sheet (they arrive biggest-dollar first). */
  maxRows: number;
  /** Flag types to ignore entirely, e.g. ["MONTH_MISMATCH"]. */
  ignoreFlags: string[];
  /** How many individual rows to list per flag type. Counts always cover all of them. */
  listPerFlag: number;
}

/** Check "cost-vs-invoice" — jobs whose spend has outrun what the client was billed. */
export interface CostVsInvoiceConfig {
  /** Dollars of unbilled approved cost before a job is worth mentioning. */
  gapThreshold: number;
  /**
   * Jobs where a gap is KNOWN and accepted — e.g. jobs that were nearly complete
   * when JobTread adoption began and were never reconciled historically. Data,
   * not code: add the JobTread job id (preferred — names change) or a
   * case-insensitive name fragment.
   */
  excludeJobIds: string[];
  excludeJobNames: string[];
  /** Most jobs to price in one run (open jobs, in JobTread's own order). */
  maxJobs: number;
  /** Concurrent JobTread rollup queries. Keep modest — it's one API. */
  concurrency: number;
}

/** Check "jobtread-todos" — open JobTread to-dos, overdue or due soon. */
export interface JobTreadTodosConfig {
  /** How many days ahead counts as "due soon" (today = 0). Overdue always shows. */
  dueWithinDays: number;
  /** Most items to list. */
  maxItems: number;
  /**
   * Show a to-do with no due date at all. Off by default — an undated to-do
   * can't be "overdue" or "due soon", so including it would turn this into a
   * full backlog dump rather than a morning glance.
   */
  includeUndated: boolean;
  /**
   * Limit to people whose JobTread display name contains one of these
   * (case-insensitive), e.g. ["ty", "casey"]. Empty = every assignee, which is
   * the default — a to-do assigned to someone not listed here is still real
   * work the office should see.
   */
  watchMembers: string[];
}

/**
 * Check "jobtread-schedule" — JobTread's own schedule (the `isToDo=false` half
 * of the same `task` object `jobtread-todos` reads): dated job work like a
 * site visit, an inspection, or an install date, today or soon.
 */
export interface JobTreadScheduleConfig {
  /** Days ahead to show, counting today. Mirrors CalendarEventsConfig.days so
   *  the two date-based checks stay in step. */
  daysAhead: number;
  /** Most items to list. */
  maxItems: number;
  /**
   * Limit to people whose JobTread display name contains one of these
   * (case-insensitive), e.g. ["ty", "casey"]. Empty = everyone, the default.
   */
  watchMembers: string[];
}

/**
 * Check "email-signals" — appointments and action items mentioned in recent
 * inbox email, found by ONE Gemini pass over truncated message bodies.
 *
 * ⚠️ This is the one check that sends email BODY TEXT (truncated) to Gemini —
 * every other check reads sender/subject/date only. See the comment on
 * `extractEmailSignalsWithGemini` in src/lib/gemini.ts for exactly what is and
 * isn't sent, and why it can't be done any other way.
 */
export interface EmailSignalsConfig {
  /** How far back to read inbox mail. Kept short — this check is for what's
   *  fresh, not a backlog sweep, and every day of lookback costs more tokens. */
  lookbackDays: number;
  /** Most emails to read in one run (also the most that reach Gemini). */
  maxEmails: number;
  /** Per-email body truncation BEFORE it reaches Gemini, in characters. */
  maxBodyChars: number;
}

/** Check "calendar-events" — what's on the shared calendars. */
export interface CalendarEventsConfig {
  /** Days ahead to show, counting today. 1 = today only. */
  days: number;
  /**
   * Which calendars to read. Ids are exact; names are matched case-insensitively
   * as substrings against the calendars the script's Google account subscribes
   * to. Shared, operational calendars only.
   *
   * ⚠️ A person's own calendar is NOT included, on purpose, and
   * `includePrimary` stays false: the digest is an office report and must not
   * publish somebody's personal appointments. If you ever do want a named
   * individual's calendar, add its id here deliberately — access stays
   * READ-ONLY either way (the script holds calendar.readonly and cannot create,
   * edit or delete an event on anyone's calendar).
   */
  calendarIds: string[];
  calendarNames: string[];
  includePrimary: boolean;
}

/** Check "email-followups" — inbound threads nobody answered. */
export interface EmailFollowUpsConfig {
  /** How far back to look at inbox threads. */
  lookbackDays: number;
  /** Business days since the last unanswered inbound message before flagging. */
  minBusinessDays: number;
  /**
   * Addresses that count as "us" — a reply from any of these means the thread is
   * answered. Empty falls back to the office + admin addresses the Apps Script
   * side already knows, plus anyone at the company domain.
   */
  officeAddresses: string[];
  /**
   * Extra automated senders to ignore, as case-insensitive substrings of the
   * address ("newsletter@", "billing.acme.com"). The obvious ones (no-reply,
   * notifications, mailer-daemon, the big bulk senders) are already filtered.
   */
  ignoreSenders: string[];
}

/* --------------------------------------------------------- per-check values */

/**
 * The per-check settings, keyed by check id. `registry.ts` hands each check its
 * own block; a check never reads this map directly, so a check can't quietly
 * depend on another one's configuration.
 */
export interface DigestCheckSettings<C> {
  enabled: boolean;
  config: C;
}

// Billing checks are OFF (2026-08-31) — billing has its own screens (Tracking
// Sheets, /unbilled), so the digest no longer duplicates it. Config values are
// left in place, not deleted, so turning one back on is `enabled: true` and
// nothing else.
export const DIGEST_SETTINGS = {
  "uncaptured-bills": {
    enabled: false,
    config: {
      lookbackDays: 14,
      maxEmails: 40,
      excludeVendors: [
        // Sunset Builders Supply has its own OCR-first ingestion path and is
        // already excluded upstream; named here too so the reason is written
        // down where the office reads it.
        "sunsetbuilderssupply.com",
      ],
      matchWindowDays: 21,
      amountTolerance: 0.12,
      maxVendorLookups: 25,
      flagUnknownSenders: true,
    },
  } satisfies DigestCheckSettings<UncapturedBillsConfig>,

  "draft-bills-past-cutoff": {
    enabled: false,
    config: {
      minAmount: 0,
      maxMonthsBack: 12,
    },
  } satisfies DigestCheckSettings<DraftBillsPastCutoffConfig>,

  "reconciliation-flags": {
    enabled: false,
    config: {
      maxRows: 100,
      ignoreFlags: [],
      listPerFlag: 5,
    },
  } satisfies DigestCheckSettings<ReconciliationFlagsConfig>,

  "cost-vs-invoice": {
    enabled: false,
    config: {
      gapThreshold: 5_000,
      excludeJobIds: [],
      excludeJobNames: [],
      maxJobs: 60,
      concurrency: 4,
    },
  } satisfies DigestCheckSettings<CostVsInvoiceConfig>,

  "calendar-events": {
    enabled: true,
    config: {
      days: 7,
      calendarIds: [],
      // Name fragments matched against the shared calendars the script account
      // subscribes to. "office" is the shared office calendar; "ty" and "casey"
      // are their calendars, already shared TO the office account (confirmed
      // 2026-08-31) — this is why they can ride the same read-only check as the
      // office calendar with no extra Google consent step. Replace with exact
      // ids once you know them (more durable than a name fragment); the check
      // lists every calendar it CAN see whenever none of these match, so the
      // first run tells you what to paste here.
      calendarNames: ["office", "ty", "casey", "time off"],
      includePrimary: false,
    },
  } satisfies DigestCheckSettings<CalendarEventsConfig>,

  "jobtread-todos": {
    enabled: true,
    config: {
      dueWithinDays: 7,
      maxItems: 40,
      includeUndated: false,
      watchMembers: [],
    },
  } satisfies DigestCheckSettings<JobTreadTodosConfig>,

  "jobtread-schedule": {
    enabled: true,
    config: {
      daysAhead: 7,
      maxItems: 40,
      watchMembers: [],
    },
  } satisfies DigestCheckSettings<JobTreadScheduleConfig>,

  "email-signals": {
    enabled: true,
    config: {
      lookbackDays: 3,
      maxEmails: 20,
      maxBodyChars: 1000,
    },
  } satisfies DigestCheckSettings<EmailSignalsConfig>,

  "email-followups": {
    enabled: true,
    config: {
      lookbackDays: 7,
      minBusinessDays: 2,
      officeAddresses: [],
      ignoreSenders: [],
    },
  } satisfies DigestCheckSettings<EmailFollowUpsConfig>,
} as const;

export type DigestSettingsMap = typeof DIGEST_SETTINGS;

/** Label for a category id — falls back to a title-cased id for an unknown one. */
export function categoryLabel(id: string): string {
  const found = DIGEST_CATEGORIES.find((c) => c.id === id);
  if (found) return found.label;
  return id
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Display order for a category id — unknown categories sort after known ones. */
export function categoryOrder(id: string): number {
  const i = DIGEST_CATEGORIES.findIndex((c) => c.id === id);
  return i < 0 ? DIGEST_CATEGORIES.length : i;
}
