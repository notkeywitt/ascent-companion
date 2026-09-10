"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Banner, Card, MetaLine, Spinner, Toggle, btn } from "@/components/ui";
import { money, money0 } from "./BillCodingCard";

/**
 * Admin-only: the difference between this job's Google Tracking Sheet and what
 * JobTread already holds, per cost code — the same comparison
 * /historical-cost previews, folded into the budget panel so the gap can be
 * checked on the job you already have open.
 *
 * Read-only. Creating the bill that closes the gap stays on /historical-cost,
 * the one path that writes it (and the one that manages the single historical
 * bill per job), reached by the link below with this job pre-filled.
 *
 * Off by default and fetched only when switched on: Apps Script pages every
 * cost item and time entry on the job, so a preview can run tens of seconds.
 */

interface GapRow {
  csi: string;
  sheetTotal: number;
  alreadyInJt: number;
  gap: number;
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
}

export function SheetGap({
  jobId,
  url,
  className = "",
}: {
  jobId: string;
  url: string;
  className?: string;
}) {
  const [on, setOn] = useState(false);
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

  // Only the codes that disagree, biggest disagreement first — a code the sheet
  // and JobTread already match on is not what this panel is for. Rounded to
  // cents so a floating-point remainder does not render as a gap of "$0".
  const rows = (gap?.rows ?? [])
    .filter((r) => Math.round(r.gap * 100) !== 0)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

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

          {gap && (
            <Card pad={false} className="overflow-hidden">
              <div className="border-b border-line-soft px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold">Gap to bill</span>
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      Math.round(gap.gapSum * 100) === 0
                        ? "text-neutral-500 dark:text-neutral-400"
                        : ""
                    }`}
                  >
                    {money0(gap.gapSum)}
                  </span>
                </div>
                <MetaLine
                  items={[
                    `${money0(gap.sheetTotalSum)} on the sheet`,
                    `${money0(gap.alreadyInJtSum)} in JobTread`,
                    `through ${gap.endLabel}`,
                    gap.alreadyInJtTimeSum !== 0
                      ? `incl. ${money0(gap.alreadyInJtTimeSum)} labor`
                      : null,
                  ]}
                />
              </div>

              {gap.existingDocId && (
                <p className="border-b border-line-soft px-3 py-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                  A historical bill already exists on this job (JT doc {gap.existingDocId},
                  {" "}
                  {gap.existingStatus}). The numbers above are what is still missing.
                </p>
              )}

              {rows.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Every cost code matches the sheet.
                </p>
              ) : (
                <ul className="max-h-64 overflow-y-auto">
                  {rows.map((r) => (
                    <li
                      key={r.csi}
                      className="border-b border-line-soft px-3 py-2 last:border-b-0"
                      title={
                        `${r.csi}\n${money(r.sheetTotal)} on the sheet\n` +
                        `${money(r.alreadyInJt)} in JobTread\n${money(r.gap)} gap`
                      }
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          {r.csi}
                        </span>
                        <span
                          className={`shrink-0 text-xs font-semibold tabular-nums ${
                            r.gap < 0 ? "text-red-600 dark:text-red-400" : ""
                          }`}
                        >
                          {money0(r.gap)}
                        </span>
                      </div>
                      <MetaLine
                        items={[
                          `sheet ${money0(r.sheetTotal)}`,
                          `JobTread ${money0(r.alreadyInJt)}`,
                        ]}
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
