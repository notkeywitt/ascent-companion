/**
 * Check "reconciliation-flags" (Billing) — parent/child integrity problems the
 * Expenditure sheet's own scanner already found.
 *
 * THIS CHECK DOES NOT COMPUTE ANYTHING. `scanExpenditureReconciliation` (in the
 * appscript repo, Sheets_AppSheet.js) compares every Expenditure header against
 * the sum of its child line items and writes the verdict into the sheet's
 * "Reconciliation Flags" column: NO_LINE_ITEMS, AMOUNT_MISMATCH,
 * PROJECT_MISMATCH, MONTH_MISMATCH (joined with " | " when a row has several).
 * The digest READS that column. Re-deriving the same judgment here would give
 * the office two answers that can disagree, and the sheet's is the one the rest
 * of the system already acts on.
 *
 * If this check reports "no flags at all, ever", the likely cause is that the
 * scan hasn't been run recently, not that the books are perfect — the summary
 * says how many rows were examined so an empty result is provably different
 * from a scan that never ran.
 */
import { callAppsScript } from "@/lib/appsScript";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { ReconciliationFlagsConfig } from "../settings";

interface FlagRow {
  expId?: string;
  flags?: string[];
  amount?: number;
  vendor?: string;
  project?: string;
  jtDocId?: string;
  period?: string;
}
interface FlagsResponse {
  ok?: boolean;
  error?: string;
  scanned?: number;
  flaggedCount?: number;
  counts?: Record<string, number>;
  totals?: Record<string, number>;
  truncated?: boolean;
  rows?: FlagRow[];
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "AMOUNT_MISMATCH" → "Amount mismatch". */
export function humanizeFlag(flag: string): string {
  const words = String(flag ?? "").toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (!words.length) return flag;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? " " + words.slice(1).join(" ") : "");
}

export const reconciliationFlagsCheck = defineCheck<ReconciliationFlagsConfig>({
  id: "reconciliation-flags",
  title: "Reconciliation Flags",
  category: "billing",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as ReconciliationFlagsConfig,

  async run({ config, log }): Promise<CheckResult> {
    const r = await callAppsScript<FlagsResponse>({
      action: "digestReconciliationFlags",
      limit: config.maxRows,
    });
    if (r.error) return checkError(`Couldn't read the Expenditure sheet: ${r.error}`);
    if (r.data?.ok === false) return checkError(r.data.error || "Reconciliation read failed.");

    const scanned = r.data?.scanned ?? 0;
    const ignore = new Set(config.ignoreFlags.map((f) => f.toUpperCase()));
    const counts = Object.entries(r.data?.counts ?? {}).filter(([f]) => !ignore.has(f.toUpperCase()));
    const totals = r.data?.totals ?? {};
    log(`${scanned} Expenditure row(s) examined; ${r.data?.flaggedCount ?? 0} carry a flag`);
    if (ignore.size) log(`ignoring flag type(s): ${[...ignore].join(", ")}`);

    if (counts.length === 0) {
      return allClear(`No reconciliation flags across ${scanned} Expenditure rows.`);
    }

    // One item per flag type carrying its count and dollar impact, then the
    // biggest individual rows under it — "group by flag type with counts; list
    // the top few by dollar impact".
    const rows = (r.data?.rows ?? []).filter((row) =>
      (row.flags ?? []).some((f) => !ignore.has(f.toUpperCase())),
    );
    const items: DigestItem[] = [];
    let flagged = 0;
    for (const [flag, count] of counts.sort((a, b) => (totals[b[0]] ?? 0) - (totals[a[0]] ?? 0))) {
      flagged += count;
      const label = humanizeFlag(flag);
      items.push({
        title: `${label} — ${count} row${count === 1 ? "" : "s"}`,
        detail: `${money(totals[flag] ?? 0)} of billed value on rows flagged ${flag}.`,
        amount: totals[flag] ?? 0,
        group: label,
      });
      const mine = rows
        .filter((row) => (row.flags ?? []).includes(flag))
        .slice(0, config.listPerFlag);
      for (const row of mine) {
        items.push({
          title: `${row.expId ?? "(no ExpID)"} · ${row.vendor || "unknown vendor"} · ${money(Math.abs(row.amount ?? 0))}`,
          detail:
            `${(row.flags ?? []).map(humanizeFlag).join(", ")}. ` +
            `Project: ${row.project || "unassigned"}.` +
            (row.period ? ` Billing period ${row.period}.` : ""),
          sourceLink: row.jtDocId ? `/bill/${row.jtDocId}` : undefined,
          sourceLabel: row.jtDocId ? "Open bill" : undefined,
          amount: Math.abs(row.amount ?? 0),
          group: label,
        });
      }
    }

    if (r.data?.truncated) log(`row list truncated at ${config.maxRows}; counts still cover every flagged row`);
    return {
      status: "warning",
      items,
      summary: `${flagged} Expenditure row${flagged === 1 ? "" : "s"} flagged across ${counts.length} problem type${counts.length === 1 ? "" : "s"}.`,
    };
  },
});
