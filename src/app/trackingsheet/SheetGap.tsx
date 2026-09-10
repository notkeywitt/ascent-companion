"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banner, Card, MetaLine, Spinner, Toggle, btn } from "@/components/ui";
import { money, money0 } from "./BillCodingCard";

/**
 * Admin-only: what this job's Google Tracking Sheet says, against what
 * JobTread holds — per cost code, on the job you already have open. The same
 * comparison /historical-cost previews, folded into the budget panel.
 *
 * TWO comparisons, because the sheet carries two kinds of figure:
 *
 *   Spend     the sheet's TOTAL PREVIOUSLY INVOICED vs JobTread's Actual Cost
 *             through the same billing period.
 *   Estimate  the sheet's REVISED TOTAL (contract estimate + approved changes)
 *             vs the job's JobTread BUDGET — the same budget the rail below
 *             this panel measures headroom against, passed in rather than
 *             re-fetched.
 *
 * THE HISTORICAL BILL IS COUNTED HERE, AND IS NOT COUNTED IN `gap`.
 * /historical-cost subtracts the Historical Job Cost account out of the
 * JobTread side on purpose: its gap is what a FRESH catch-up bill would carry,
 * and self-excluding is what stops a re-run oscillating. JobTread's budget
 * screen shows that bill like any other, so a code already caught up read as a
 * full gap here and matched nothing on screen. This panel shows `net` — the
 * gap with the historical bill added back — and keeps `gap` as the secondary
 * figure, since that is what the create page would write.
 *
 * Read-only. Creating the bill stays on /historical-cost, the one path that
 * writes it, reached by the link below with this job pre-filled.
 *
 * Off by default and fetched only when switched on: Apps Script pages every
 * cost item and time entry on the job, so a preview can run tens of seconds.
 */

interface GapRow {
  csi: string;
  sheetTotal: number;
  alreadyInJt: number;
  gap: number;
  /** Added 2026-09-09 — absent until the Apps Script side is deployed. */
  historical?: number;
  net?: number;
  sheetEstimate?: number;
}

interface GapReport {
  jobLabel: string;
  trackingSheetName: string;
  tab: string;
  previousColLetter: string;
  endLabel: string;
  rows: GapRow[];
  sheetTotalSum: number;
  alreadyInJtSum: number;
  alreadyInJtTimeSum: number;
  gapSum: number;
  existingDocId: string | null;
  existingStatus: string | null;
  historicalSum?: number;
  netSum?: number;
  sheetEstimateSum?: number;
  /** "" when the sheet has no REVISED TOTAL column; absent pre-deploy. */
  estimateColLetter?: string;
}

/** One line of the comparison, whichever mode is showing. */
interface Line {
  csi: string;
  sheet: number;
  jt: number;
  diff: number;
}

type Mode = "spend" | "estimate";

/** The historical-bill amount, gap and net, tolerant of a pre-deploy payload. */
const historicalOf = (r: GapRow) => r.historical ?? 0;
const netOf = (r: GapRow) => r.net ?? r.gap;

export function SheetGap({
  jobId,
  url,
  budgetByCode,
  className = "",
}: {
  jobId: string;
  url: string;
  /** cost code → JobTread budget, from the rail this panel sits above. */
  budgetByCode: Map<string, number>;
  className?: string;
}) {
  const [on, setOn] = useState(false);
  const [mode, setMode] = useState<Mode>("spend");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [gap, setGap] = useState<GapReport | null>(null);

  // A different job (or sheet) describes another comparison — drop the old one
  // and make the switch re-fetch rather than show the last job's numbers.
  useEffect(() => {
    setGap(null);
    setError("");
    setOn(false);
  }, [jobId, url]);

  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/historical-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "preview", url, jtJobId: jobId }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
      setGap(b as GapReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The comparison failed.");
    } finally {
      setLoading(false);
    }
  }, [jobId, url]);

  const flip = (next: boolean) => {
    setOn(next);
    if (next && !gap && !loading) void run();
  };

  /** True once the Apps Script side reports the estimate column at all. */
  const hasEstimate = gap?.estimateColLetter !== undefined && gap.estimateColLetter !== "";

  const lines = useMemo<Line[]>(() => {
    const rows = gap?.rows ?? [];
    if (mode === "spend") {
      return rows.map((r) => ({
        csi: r.csi,
        sheet: r.sheetTotal,
        // What JobTread's own budget screen shows: its Actual Cost, historical
        // catch-up bill included.
        jt: r.alreadyInJt + historicalOf(r),
        diff: netOf(r),
      }));
    }
    // A code can be budgeted in JobTread and absent from the sheet, or the
    // reverse — the comparison is only honest over the union of both sides.
    const codes = new Set(rows.map((r) => r.csi));
    for (const code of budgetByCode.keys()) codes.add(code);
    const estimateOf = new Map(rows.map((r) => [r.csi, r.sheetEstimate ?? 0]));
    return [...codes].map((csi) => {
      const sheet = estimateOf.get(csi) ?? 0;
      const jt = budgetByCode.get(csi) ?? 0;
      return { csi, sheet, jt, diff: Math.round((sheet - jt) * 100) / 100 };
    });
  }, [gap, mode, budgetByCode]);

  // Only the codes that disagree, biggest disagreement first — a code the sheet
  // and JobTread already match on is not what this panel is for. Filtered at
  // the precision the row RENDERS at (whole dollars, money0), not at the cent:
  // the sheet sums month totals already rounded to cents while JobTread sums
  // raw, so a dozen codes carry a few cents of residue — and every one of them
  // listed as a row reading "$0".
  const shown = lines
    .filter((l) => Math.round(l.diff) !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const totals = shown.length === 0 && lines.length === 0
    ? null
    : lines.reduce(
        (acc, l) => ({ sheet: acc.sheet + l.sheet, jt: acc.jt + l.jt, diff: acc.diff + l.diff }),
        { sheet: 0, jt: 0, diff: 0 },
      );

  const seg = (m: Mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`min-h-8 rounded-md px-2 text-[11px] transition ${
        mode === m
          ? "bg-white font-semibold shadow-sm dark:bg-ink-raised"
          : "text-neutral-500 hover:text-accent dark:text-neutral-400"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className={`mb-2 ${className}`}>
      <Toggle
        checked={on}
        onChange={flip}
        label={
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Sheet vs JobTread{loading && <Spinner className="ml-1.5" />}
          </span>
        }
      />

      {on && (
        <div className="mt-2">
          {loading && !gap && (
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              Comparing the sheet to JobTread — this pages every cost item on the job, so it can
              take a minute.
            </p>
          )}

          {error && (
            <Banner tone="error" className="text-xs">
              {error}
            </Banner>
          )}

          {gap && totals && (
            <Card pad={false} className="overflow-hidden">
              <div className="border-b border-line-soft px-3 py-2">
                <div className="mb-1.5 inline-flex gap-0.5 rounded-lg bg-neutral-100 p-0.5 dark:bg-white/5">
                  {seg("spend", "Spend")}
                  {seg("estimate", "Estimate")}
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold">
                    {mode === "spend" ? "Difference" : "Estimate difference"}
                  </span>
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      Math.round(totals.diff * 100) === 0
                        ? "text-neutral-500 dark:text-neutral-400"
                        : ""
                    }`}
                  >
                    {money0(totals.diff)}
                  </span>
                </div>
                <MetaLine
                  items={
                    mode === "spend"
                      ? [
                          `${money0(totals.sheet)} on the sheet`,
                          `${money0(totals.jt)} in JobTread`,
                          `through ${gap.endLabel}`,
                          gap.alreadyInJtTimeSum !== 0
                            ? `incl. ${money0(gap.alreadyInJtTimeSum)} labor`
                            : null,
                        ]
                      : [
                          `${money0(totals.sheet)} on the sheet`,
                          `${money0(totals.jt)} budgeted in JobTread`,
                          gap.estimateColLetter
                            ? `sheet column ${gap.estimateColLetter}`
                            : null,
                        ]
                  }
                />
              </div>

              {/* The seed bill is the reason a code can read "gap $127,715" and
                  match JobTread exactly — say so, with both figures. */}
              {mode === "spend" && (gap.historicalSum ?? 0) !== 0 && (
                <p className="border-b border-line-soft px-3 py-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                  {money0(gap.historicalSum ?? 0)} of the JobTread figure is a Historical Job Cost
                  bill, counted above. A fresh catch-up bill would carry {money0(gap.gapSum)}
                  {gap.existingDocId
                    ? ` and would replace JT doc ${gap.existingDocId} (${gap.existingStatus}).`
                    : " — this tool did not create the existing one, so it would ADD a second."}
                </p>
              )}

              {mode === "estimate" && !hasEstimate && (
                <p className="border-b border-line-soft px-3 py-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                  {gap.estimateColLetter === undefined
                    ? "The Apps Script side has not been deployed with the estimate column yet."
                    : "This sheet has no REVISED TOTAL column, so it carries no estimate to compare."}
                </p>
              )}

              {shown.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Every cost code matches the sheet to the dollar.
                </p>
              ) : (
                <ul className="max-h-64 overflow-y-auto">
                  {shown.map((l) => (
                    <li
                      key={l.csi}
                      className="border-b border-line-soft px-3 py-2 last:border-b-0"
                      title={
                        `${l.csi}\n${money(l.sheet)} on the sheet\n` +
                        `${money(l.jt)} in JobTread\n${money(l.diff)} difference`
                      }
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          {l.csi}
                        </span>
                        <span
                          className={`shrink-0 text-xs font-semibold tabular-nums ${
                            l.diff < 0 ? "text-red-600 dark:text-red-400" : ""
                          }`}
                        >
                          {money0(l.diff)}
                        </span>
                      </div>
                      <MetaLine
                        items={[`sheet ${money0(l.sheet)}`, `JobTread ${money0(l.jt)}`]}
                      />
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center gap-2 px-3 py-2">
                <Link
                  href={`/historical-cost?job=${encodeURIComponent(jobId)}&url=${encodeURIComponent(url)}`}
                  className={btn("secondary", "sm")}
                >
                  Create the bill →
                </Link>
                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={loading}
                  className="text-[11px] text-neutral-500 transition hover:text-accent disabled:opacity-40 dark:text-neutral-400"
                >
                  {loading ? "Re-checking…" : "Re-check"}
                </button>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
