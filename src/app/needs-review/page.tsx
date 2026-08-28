"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money } from "@/components/BillingSummary";
import { Banner, Card, EmptyState, Loading, PageHeader, SectionLabel } from "@/components/ui";

/**
 * The Needs Review queue — every bill flagged for a billing correction the app
 * can't make itself (a paid / invoiced / QuickBooks-pushed bill that needs work
 * in JobTread or QuickBooks directly). Read from /api/bill-review, which joins
 * the flag + note to the local bill-search index for the vendor / amount / job,
 * so this lists without a JobTread fan-out. Flagging happens on each bill's own
 * detail page; this is where the office finds them again later.
 */

interface FlaggedBill {
  docId: string;
  note: string;
  flaggedAt: string;
  flaggedBy: string;
  vendor: string;
  amount: number | null;
  status: string;
  issueDate: string;
  jobId: string;
  jobName: string;
  customer: string;
}

const jobLabel = (b: FlaggedBill) =>
  [b.customer, b.jobName].filter(Boolean).join(" — ");

const shortDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export default function NeedsReviewPage() {
  const [bills, setBills] = useState<FlaggedBill[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/bill-review")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.error) setError(j.error);
        else setBills((j.bills ?? []) as FlaggedBill[]);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Needs Review"
        description="Bills flagged for a correction that can't be made in the app — a paid, invoiced, or QuickBooks-pushed bill that needs work in JobTread or QuickBooks. Open one to see the note or clear the flag."
        className="!mb-4"
      />

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {!error && bills === null && <Loading label="Loading flagged bills…" />}

      {bills !== null && bills.length === 0 && !error && (
        <EmptyState>No bills are flagged for review.</EmptyState>
      )}

      {bills !== null && bills.length > 0 && (
        <>
          <SectionLabel className="mb-2">
            {bills.length} bill{bills.length === 1 ? "" : "s"} flagged
          </SectionLabel>
          <ul className="space-y-2">
            {bills.map((b) => (
              <li key={b.docId}>
                <Card pad={false} className="overflow-hidden">
                  <Link
                    href={`/bill/${b.docId}${b.jobId ? `?jobId=${encodeURIComponent(b.jobId)}` : ""}`}
                    className="block p-3 transition hover:bg-accent/5 dark:hover:bg-white/5"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {b.vendor || "Bill"}
                      </span>
                      <span className="shrink-0 text-base font-semibold tabular-nums">
                        {b.amount == null ? "" : money(b.amount)}
                      </span>
                    </div>
                    {jobLabel(b) && (
                      <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                        {jobLabel(b)}
                      </div>
                    )}
                    {b.note && (
                      <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        ⚑ {b.note}
                      </div>
                    )}
                    <div className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
                      {b.flaggedBy ? `Flagged by ${b.flaggedBy}` : "Flagged"}
                      {shortDate(b.flaggedAt) ? ` · ${shortDate(b.flaggedAt)}` : ""}
                    </div>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
