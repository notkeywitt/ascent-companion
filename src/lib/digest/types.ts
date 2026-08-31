/**
 * The Daily Digest's contract — the shape EVERY check implements, and the shape
 * the aggregator, the store, and the UI all read.
 *
 * This file is the reason the digest is extensible. A check knows how to answer
 * one question; it knows nothing about how it is scheduled, stored, summarized,
 * or drawn. So adding "are any tools checked out to a job that closed?" is a new
 * file under `checks/`, a config block in `settings.ts`, and one line in
 * `registry.ts` — the aggregator, the cron route, and the UI are untouched.
 *
 * Pure types + one helper. No DB, Node, or React imports, so a check, the server
 * runner, and the client renderer can all import it.
 */
import type { PaveConfig } from "@/lib/jobtread";
import type { DigestGlobalSettings } from "./settings";

/** How a check came out. `error` means the check could not answer, not "bad news". */
export type CheckStatus = "ok" | "warning" | "error";

/**
 * One flagged thing. Every field but `title` is optional so a check reports only
 * what it actually knows — a calendar event has a date and no amount, a budget
 * gap has an amount and no link.
 */
export interface DigestItem {
  /** The one line shown collapsed. Keep it scannable — a name, not a sentence. */
  title: string;
  /** The expanded explanation. Shown when the item is opened. */
  detail?: string;
  /** Where this came from: a Gmail thread, a JobTread document, a page here. */
  sourceLink?: string;
  /** Label for that link ("Open in JobTread", "Gmail thread"). Defaults to "Open source". */
  sourceLabel?: string;
  /** Dollars, when the item has a dollar value. Drives "top by impact" ordering. */
  amount?: number;
  /** YYYY-MM-DD, or an ISO timestamp. Displayed, and used to sort dated lists. */
  date?: string;
  /** Free-form grouping key within one check (a calendar day, a flag type). */
  group?: string;
}

/** What a check's `run` resolves to. */
export interface CheckResult {
  status: CheckStatus;
  items: DigestItem[];
  /** One line of plain English: "2 uncaptured bills found", "All clear". */
  summary: string;
}

/**
 * What the aggregator hands each check. Everything a check needs to do its job
 * and nothing that would let it change anything.
 *
 * `pave` is null when JT_GRANT_KEY isn't configured — a check that needs
 * JobTread should report `status: "error"` rather than throwing, so the rest of
 * the digest still renders.
 */
export interface CheckContext<C = unknown> {
  /** This check's slice of `settings.ts`, already typed. */
  config: C;
  /** The digest-wide settings (billing cutoff day, caps) — also from `settings.ts`. */
  settings: DigestGlobalSettings;
  /** When the run started. Every check reads "now" from here so one run is consistent. */
  now: Date;
  /** `now` as YYYY-MM-DD in the company timezone — the digest's own date key. */
  today: string;
  /** Server-side JobTread config, or null when no grant key is set. */
  pave: PaveConfig | null;
  /** Append a line to the run log (which lands in the stored digest, for debugging). */
  log: (message: string) => void;
}

/**
 * A check. `id` is stable and is the key everything else uses — the settings
 * block, the stored result, the UI's expand state. Renaming one loses its
 * history, so don't.
 *
 * `category` is a plain string, NOT a union, so a new category is data. The UI
 * renders whatever categories come back, in the order `DIGEST_CATEGORIES`
 * declares (unknown ones sort last under a title-cased label) — which is what
 * keeps "add a Safety category next spring" from being a UI refactor.
 */
export interface DigestCheck<C = unknown> {
  id: string;
  title: string;
  category: string;
  enabled: boolean;
  config: C;
  run: (ctx: CheckContext<C>) => Promise<CheckResult>;
}

/**
 * One check's stored outcome — its result plus how the run went. This is what
 * the DB holds and the UI reads, so it carries the check's own metadata: a
 * check deleted from the registry still renders correctly out of an old digest.
 */
export interface StoredCheckResult {
  id: string;
  title: string;
  category: string;
  status: CheckStatus;
  summary: string;
  items: DigestItem[];
  /** How long `run` took, in ms. */
  durationMs: number;
  /** Set only when status is "error" — the short reason, safe to show a human. */
  error?: string;
}

/** A whole day's digest, as stored and as served to the browser. */
export interface DigestPayload {
  /** YYYY-MM-DD in the company timezone. The digest's identity. */
  date: string;
  /** ISO timestamp of the run that produced this. */
  generatedAt: string;
  /** ok = every check answered; partial = at least one errored; error = all did. */
  status: "ok" | "partial" | "error";
  /** The Gemini paragraph (or a locally-built fallback — see `summarySource`). */
  summary: string;
  summarySource: "gemini" | "fallback";
  results: StoredCheckResult[];
  durationMs: number;
  /** Per-check run log: which ran, when, and how they came out. */
  log: string[];
}

/**
 * Declare a check with its config type inferred from `settings.ts`.
 *
 * Only reason this exists: it makes `ctx.config` typed inside `run` without
 * every check file repeating the generic parameter. Use it in place of a bare
 * object literal.
 */
export function defineCheck<C>(def: DigestCheck<C>): DigestCheck<C> {
  return def;
}

/** Convenience for the common "nothing to report" result. */
export function allClear(summary: string): CheckResult {
  return { status: "ok", items: [], summary };
}

/** Convenience for a check that couldn't answer. Never throws out of a check. */
export function checkError(summary: string): CheckResult {
  return { status: "error", items: [], summary };
}
