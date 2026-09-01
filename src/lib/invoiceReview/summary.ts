/**
 * The locally-built summary — one line of plain English over a month's
 * findings, used whenever Claude didn't write one.
 *
 * Deliberately dull and countable. A review that lists real problems in flat
 * language is completely fine; a review that doesn't render because an API key
 * expired is not. Kept out of the checks so that "what the review FOUND" and
 * "how the review READS" stay separate concerns.
 */
import { money, type Finding, type MonthEvidence } from "./types";

export function fallbackSummary(month: MonthEvidence, findings: Finding[]): string {
  const live = findings.filter((f) => !f.suppressedBy);
  const errors = live.filter((f) => f.severity === "error");
  const warnings = live.filter((f) => f.severity === "warning");
  const invoices = month.jobs.reduce((s, j) => s + j.invoices.length, 0);
  const head =
    `${invoices} client invoice${invoices === 1 ? "" : "s"} across ` +
    `${month.jobs.length} job${month.jobs.length === 1 ? "" : "s"} for ${month.monthLabel}`;
  if (!live.length) return `${head}: nothing to flag.`;
  const at = live.reduce((s, f) => s + Math.abs(f.amount ?? 0), 0);
  const parts = [
    errors.length ? `${errors.length} to fix` : "",
    warnings.length ? `${warnings.length} to look at` : "",
  ].filter(Boolean);
  return `${head}: ${parts.join(", ")}, ${money(at)} in question.`;
}
