/**
 * THE CHECK CONTRACT — the shape every invoice-review check implements, and the
 * shape the registry and the runner read.
 *
 * This file is the reason the review is extensible. A check knows how to answer
 * one question about one month; it knows nothing about how it is scheduled,
 * stored, suppressed, summarized or drawn. So adding "is this cost-plus job
 * billing its markup?" is a new file under `checks/`, a config block in
 * `settings.ts`, and one line in `registry.ts` — the runner, the route, the
 * history and the page are untouched.
 *
 * ── THREE SCOPES, BECAUSE THE QUESTIONS HAVE THREE SHAPES ───────────────────
 * A check declares the unit it reasons about, and the runner hands it exactly
 * that and nothing more:
 *
 *   "month"    once per review. For questions that belong to the PERIOD rather
 *              than to any one job — "did every vendor invoice that arrived get
 *              captured?" is about the mailbox, not about whichever job the
 *              invoice eventually landed on.
 *   "job"      once per job. Backup coverage, uninvoiced cost, draft bills.
 *   "invoice"  once per client invoice. The arithmetic, the issue date.
 *
 * The scopes are separate types rather than one context with optional fields,
 * so a month-scoped check cannot read a `job` that was never meaningful for it.
 *
 * Pure types. No DB, Node or React imports, so a check, the runner and the
 * client renderer can all import this.
 */
import type {
  Finding,
  FindingKind,
  InvoiceEvidence,
  JobEvidence,
  MonthEvidence,
} from "./types";

/** What a check is handed. `config` is its own slice of `settings.ts`, already
 *  typed; `global` is the settings every check shares. */
interface BaseContext<C> {
  config: C;
  global: InvoiceReviewGlobalSettings;
  month: MonthEvidence;
}

export type MonthContext<C> = BaseContext<C>;
export interface JobContext<C> extends BaseContext<C> {
  job: JobEvidence;
}
export interface InvoiceContext<C> extends BaseContext<C> {
  job: JobEvidence;
  invoice: InvoiceEvidence;
}

/** Everything every check declares, whatever its scope. */
interface CheckMeta {
  /** Stable id. Keys this check's settings block and, later, its precision
   *  tally — renaming one silently detaches both, so don't. */
  id: string;
  /** What the office sees this check called. */
  title: string;
  /** One line: what going wrong looks like. Shown wherever checks are listed. */
  description: string;
  /**
   * Every `FindingKind` this check can emit. Documentation with teeth: the
   * registry asserts that no two checks claim the same kind, because a kind is
   * half of a finding's suppression identity and two checks emitting one would
   * make a ruling silence findings the office never saw.
   */
  kinds: FindingKind[];
}

export interface MonthCheck<C = unknown> extends CheckMeta {
  scope: "month";
  run(ctx: MonthContext<C>): Finding[];
}
export interface JobCheck<C = unknown> extends CheckMeta {
  scope: "job";
  run(ctx: JobContext<C>): Finding[];
}
export interface InvoiceCheck<C = unknown> extends CheckMeta {
  scope: "invoice";
  run(ctx: InvoiceContext<C>): Finding[];
}

export type AnyCheck = MonthCheck<never> | JobCheck<never> | InvoiceCheck<never>;

/**
 * Settings shared by every check.
 *
 * `tolerance` is the one number the whole review agrees on: below it, a
 * difference is floating-point drift rather than a mistake. It lives here
 * rather than in each check because two checks disagreeing about what "equal"
 * means is how a review starts contradicting itself.
 */
export interface InvoiceReviewGlobalSettings {
  /** A cent. Money arithmetic drifts below this; a real error never hides under it. */
  tolerance: number;
}

/** Identity helpers, so a check declaration reads as data and still type-checks
 *  its own config at the definition site (the digest's `defineCheck` trick). */
export function defineMonthCheck<C>(c: MonthCheck<C>): MonthCheck<C> {
  return c;
}
export function defineJobCheck<C>(c: JobCheck<C>): JobCheck<C> {
  return c;
}
export function defineInvoiceCheck<C>(c: InvoiceCheck<C>): InvoiceCheck<C> {
  return c;
}
