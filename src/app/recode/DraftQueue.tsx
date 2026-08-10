"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import { driveMainWindowToDoc, money } from "@/components/BillingSummary";
import { Banner, CardSkeletonList, EmptyState, Toggle } from "@/components/ui";

/**
 * "Needs coding" — every draft vendor bill in JobTread, across every job and
 * every month.
 *
 * This is what the Coding Review page (/coding) was, and it is the one thing the
 * month roster next door cannot do: a draft that was filed to the wrong billing
 * period, or simply left behind three months ago, never appears in a
 * month-scoped list. Here it does, because this queue is scoped by STATUS
 * (draft) rather than by date — which is exactly how a forgotten bill gets
 * found.
 *
 * Reads the same /api/coding-queue endpoint as before; each row opens the bill's
 * detail page for coding (and, in the desktop side panel, drives the adjacent
 * JobTread window to the same document).
 */

interface Bill {
  id: string;
  name?: string;
  subject?: string;
  fromName?: string;
  number?: string;
  externalId?: string;
  status?: string;
  cost?: number; // pre-tax line subtotal
  nonRecoverableTax?: number; // recorded sales tax (document-level, "Tax")
  issueDate?: string;
  jobId?: string; // set only when listing across all jobs
  jobName?: string;
  saved?: boolean; // Save has been clicked on this bill in the Assistant
  reviewed?: boolean; // bill explicitly marked reviewed in the Assistant
}

/**
 * A bill's amount owed is JobTread's document `cost` = the sum of the line costs,
 * which IS JobTread's bill total. The fixed sales tax (`nonRecoverableTax`) is
 * carved OUT of that total for the subtotal, never added on top (confirmed live
 * 2026-07-30). Matches the bill page's total exactly.
 */
const billAmount = (b: Bill) => b.cost ?? 0;

const invoiceId = (b: Bill) => b.externalId || b.number || "";
// Sunset keeps "Vendor · Invoice ID" (their invoice # is how the office tells
// same-vendor bills apart); every other vendor shows just its name.
const billTitle = (b: Bill) => {
  const vendor = b.fromName || b.subject || "Vendor bill";
  const inv = invoiceId(b);
  const isSunset = /sunset/i.test(vendor);
  return isSunset && inv ? `${vendor} · ${inv}` : vendor;
};

export function DraftQueue() {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Default to showing everything, including already-reviewed bills.
  const [hideReviewed, setHideReviewed] = useState(false);
  // The current month is usually still filling in, so hide it by default —
  // a toggle brings it back into view.
  const [hideCurrentMonth, setHideCurrentMonth] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      setBills(null);
      try {
        const res = await fetch("/api/coding-queue");
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) setError(json.error ?? "Request failed");
        else setBills(json.bills ?? []);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Network error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // issueDate is yyyy-MM-dd; compare against the device-local current month.
  const now = new Date();
  const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const isCurrentMonth = (b: Bill) => (b.issueDate ?? "").startsWith(currentMonthPrefix);

  const reviewedCount = bills?.filter((b) => b.reviewed).length ?? 0;
  const currentMonthCount = bills?.filter(isCurrentMonth).length ?? 0;
  // What the list actually renders — reviewed bills and/or the current month
  // drop out unless shown.
  const visible = bills
    ? bills.filter((b) => (!hideReviewed || !b.reviewed) && (!hideCurrentMonth || !isCurrentMonth(b)))
    : null;
  const total = visible?.reduce((s, b) => s + billAmount(b), 0) ?? 0;

  return (
    <>
      {loading && <CardSkeletonList rows={4} />}

      {error && <Banner tone="error">{error}</Banner>}

      {bills && visible && (
        <>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-sm font-medium">
                  {visible.length} draft {visible.length === 1 ? "bill" : "bills"}
                </span>
                {hideReviewed && reviewedCount > 0 && (
                  <span className="text-xs text-neutral-400">· {reviewedCount} reviewed hidden</span>
                )}
                {hideCurrentMonth && currentMonthCount > 0 && (
                  <span className="text-xs text-neutral-400">
                    · {currentMonthCount} this month hidden
                  </span>
                )}
              </div>
              {(reviewedCount > 0 || currentMonthCount > 0) && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {reviewedCount > 0 && (
                    <Toggle
                      checked={!hideReviewed}
                      onChange={() => setHideReviewed((v) => !v)}
                      label="Show reviewed"
                    />
                  )}
                  {currentMonthCount > 0 && (
                    <Toggle
                      checked={!hideCurrentMonth}
                      onChange={() => setHideCurrentMonth((v) => !v)}
                      label="Show this month"
                    />
                  )}
                </div>
              )}
            </div>
            <span className="shrink-0 font-mono text-sm font-semibold">{money(total)}</span>
          </div>
          <ul className="space-y-2">
            {visible.map((b) => {
              // Each bill carries its own job — this list spans every job, and
              // the bill view needs it to load the right budget/CTC.
              const billJobId = (b.jobId ?? "").trim();
              return (
                <li key={b.id}>
                  <Link
                    href={`/bill/${b.id}?jobId=${encodeURIComponent(billJobId)}&from=drafts`}
                    onClick={() => driveMainWindowToDoc(billJobId, b.id)}
                    className="block rounded-xl border border-line bg-white p-3 transition hover:border-accent hover:shadow-sm dark:bg-ink-raised"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-medium">{billTitle(b)}</div>
                          <BillStatusBadge status={b.status} />
                          {b.reviewed ? (
                            <span
                              title="Marked reviewed in the Assistant"
                              className="inline-block shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                            >
                              ✓ Reviewed
                            </span>
                          ) : b.saved ? (
                            <span
                              title="Save has been clicked on this bill"
                              className="inline-block shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              ✓ Saved
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-neutral-500">
                          {b.jobName
                            ? b.jobName
                            : b.subject && b.subject !== billTitle(b)
                              ? b.subject
                              : b.id}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold">{money(billAmount(b))}</div>
                        <div className="text-xs text-neutral-500">{b.issueDate || ""}</div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li>
                <EmptyState>
                  {bills.length === 0
                    ? "No draft bills anywhere — nothing to code."
                    : hideReviewed && hideCurrentMonth
                      ? "Every draft bill here is either reviewed or from this month. Turn on “Show reviewed” or “Show this month” to see them."
                      : hideReviewed
                        ? "Every draft bill here is marked reviewed. Turn on “Show reviewed” to see them."
                        : "Every draft bill here is from this month. Turn on “Show this month” to see them."}
                </EmptyState>
              </li>
            )}
          </ul>
        </>
      )}
    </>
  );
}
