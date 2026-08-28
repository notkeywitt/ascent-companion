"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { JtLink } from "@/components/JtLink";
import { money } from "@/components/BillingSummary";
import { Banner, Card, Chip, EmptyState, Label, Loading, SectionLabel, Toggle, inputCls } from "@/components/ui";
import { monthOptions } from "./Roster";

/**
 * Tracking Sheets with NO job selected — every vendor bill issued in the
 * selected month, across ALL jobs, as one flat list (newest first). It replaces
 * the per-job roster here: the office asked to see the month's bills themselves,
 * not a list of jobs to drill into.
 *
 * There's no single job, so there's no budget to code against — the budget rail
 * is shown greyed out, a placeholder for what appears once a job is picked. The
 * list is READ-ONLY for the same reason: recoding needs a job's budget as its
 * set of legal drop targets. Tapping a bill opens its own detail page, where it
 * can be coded against its own job. One org-wide query serves the whole list
 * (see /api/trackingsheet/all-bills) — it does not fan out a fetch per job.
 */

interface AllBill {
  id: string;
  vendor: string;
  cost: number;
  issueDate: string;
  createdAt: string;
  status: string;
  invoiced: boolean;
  jobId: string;
  jobName: string;
  customerName: string;
}

const jobLabel = (b: AllBill) =>
  [b.customerName, b.jobName].filter(Boolean).join(" — ") || "no job";

/** Sunset Builders Supply, matched the same way the job board does (`/sunset/i`
 *  on the vendor name) — its high invoice count is noise, so it folds into its
 *  own collapsible pane here too. */
const isSunsetVendor = (vendor: string) => /sunset/i.test(vendor);

/** "2026-08-14" or "2026-08-14T09:…Z" → "Aug 14". Takes the date part only, as
 *  plain Y-M-D — no timezone shift. */
const shortDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso || "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function AllBills({ ym, setYm }: { ym: string; setYm: (ym: string) => void }) {
  const [bills, setBills] = useState<AllBill[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Same two filters the roster carries, so switching between the two views
  // doesn't change what "this month" means.
  const [uninvoicedOnly, setUninvoicedOnly] = useState(true);
  const [includeDrafts, setIncludeDrafts] = useState(true);
  // Sunset folds into its own collapsible pane, collapsed by default — same as
  // the per-job board.
  const [sunsetOpen, setSunsetOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const [y, m] = ym.split("-");
    setLoading(true);
    setError("");
    fetch(
      `/api/trackingsheet/all-bills?year=${y}&month=${Number(m)}` +
        `&includeDrafts=${includeDrafts ? "1" : "0"}` +
        (uninvoicedOnly ? "" : "&includeInvoiced=1"),
    )
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error) setError(j.error);
        else setBills((j.bills ?? []) as AllBill[]);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [ym, uninvoicedOnly, includeDrafts]);

  const total = useMemo(() => (bills ?? []).reduce((s, b) => s + b.cost, 0), [bills]);
  const monthLabel = monthOptions().find((o) => o.ym === ym)?.label ?? ym;

  // The list split in two, same as the job board: everything else in the main
  // list, Sunset in its own collapsible pane at the bottom.
  const nonSunsetBills = useMemo(
    () => (bills ?? []).filter((b) => !isSunsetVendor(b.vendor)),
    [bills],
  );
  const sunsetBills = useMemo(
    () => (bills ?? []).filter((b) => isSunsetVendor(b.vendor)),
    [bills],
  );
  const sunsetTotal = useMemo(() => sunsetBills.reduce((s, b) => s + b.cost, 0), [sunsetBills]);

  // One bill's card — shared by the main list and the Sunset pane.
  const renderBillCard = (b: AllBill) => (
    <li key={b.id}>
      <Card pad={false} className="flex items-stretch overflow-hidden">
        {/* Status as a 3px edge stripe, same as the job board:
            amber = draft, blue = already invoiced. */}
        <span
          aria-hidden
          className={`w-[3px] shrink-0 ${
            b.invoiced
              ? "bg-sky-500"
              : b.status === "draft"
                ? "bg-amber-500"
                : "bg-transparent"
          }`}
        />
        <Link
          href={`/bill/${b.id}?jobId=${encodeURIComponent(b.jobId)}`}
          className="min-w-0 flex-1 p-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-semibold">{b.vendor}</span>
            <span className="shrink-0 text-base font-semibold tabular-nums">
              {money(b.cost)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
            {jobLabel(b)}
            {b.createdAt ? ` · added ${shortDate(b.createdAt)}` : ""}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1.5 empty:mt-0">
            {b.status === "draft" && <Chip tone="neutral">draft</Chip>}
            {b.invoiced && (
              <Chip tone="info" title="Already on a customer invoice — read-only">
                invoiced
              </Chip>
            )}
          </span>
        </Link>
        <span className="flex shrink-0 items-start border-l border-line-soft">
          <JtLink
            href={`https://app.jobtread.com/jobs/${b.jobId}/documents/${b.id}`}
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-xs font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
          >
            JT ↗
          </JtLink>
        </span>
      </Card>
    </li>
  );

  return (
    <>
      <div className="mb-3">
        <Label htmlFor="allbills-month">Billing month</Label>
        <select
          id="allbills-month"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          className={inputCls}
        >
          {monthOptions().map((o) => (
            <option key={o.ym} value={o.ym}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-3">
        <Toggle checked={uninvoicedOnly} onChange={setUninvoicedOnly} label="Uninvoiced only" />
        <Toggle checked={includeDrafts} onChange={setIncludeDrafts} label="Include draft bills" />
      </div>

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading && <Loading label="Loading this month’s bills…" />}

      {!loading && !error && (
        // Mirrors the job workbench's layout: budget rail on the left, bills on
        // the right — but with no job, the rail is greyed out.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* ─────────── LEFT: greyed budget rail ─────────── */}
          <section className="min-w-0 lg:col-span-1">
            <Card className="opacity-60">
              <SectionLabel className="mb-1">Budget</SectionLabel>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Pick a job to load its budget rail — spend vs. budget per cost code.
                With no job selected there’s no single budget to show.
              </p>
            </Card>
          </section>

          {/* ─────────── RIGHT: every bill this month ─────────── */}
          <section className="min-w-0 lg:col-span-2">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <SectionLabel>
                {`${(bills ?? []).length} bill${(bills ?? []).length === 1 ? "" : "s"}`} ·{" "}
                {money(total)}
              </SectionLabel>
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                {monthLabel} · all jobs
              </span>
            </div>

            {(bills ?? []).length === 0 ? (
              <EmptyState>No bills issued in {monthLabel}.</EmptyState>
            ) : (
              <>
                {nonSunsetBills.length > 0 && (
                  <ul className="space-y-2">{nonSunsetBills.map(renderBillCard)}</ul>
                )}

                {/* Sunset folded into its own collapsible pane, same treatment
                    as the per-job board: pushed to the bottom, collapsed by
                    default, with a count and total. */}
                {sunsetBills.length > 0 && (
                  <Card pad={false} className="mt-2 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSunsetOpen((v) => !v)}
                      aria-expanded={sunsetOpen}
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5 lg:py-2"
                    >
                      <span className="min-w-0 truncate text-sm font-semibold">
                        <span
                          aria-hidden
                          className={`mr-1.5 inline-block text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${
                            sunsetOpen ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                        Sunset ({sunsetBills.length} bill{sunsetBills.length === 1 ? "" : "s"})
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {money(sunsetTotal)}
                      </span>
                    </button>
                    {sunsetOpen && (
                      <ul className="space-y-2 border-t border-line-soft bg-neutral-50 p-2 dark:bg-ink-raised/50">
                        {sunsetBills.map(renderBillCard)}
                      </ul>
                    )}
                  </Card>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
