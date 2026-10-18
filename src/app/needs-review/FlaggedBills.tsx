"use client";

import { useEffect, useState } from "react";
import { money } from "@/components/BillingSummary";
import { Banner, EmptyState, ListCard, ListRow, Loading } from "@/components/ui";

/**
 * Bill Corrections — bills flagged "Needs review" for a fix the app cannot make
 * (a paid, invoiced or QuickBooks-pushed bill). A section of Checks
 * (/invoice-review?section=flagged) since 2026-10-18; /needs-review redirects
 * there. The flag is set and cleared on the bill itself.
 */

interface FlaggedBill {
  docId: string;
  note: string;
  flaggedAt: string;
  flaggedBy: string;
  vendor: string;
  amount: number | null;
  jobId: string;
  jobName: string;
  customer: string;
}

const shortDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export function FlaggedBills() {
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
    <section>
      <h2 className="text-lg font-bold tracking-tight">Flagged bills</h2>
      <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
        Bills that need a fix in JobTread or QuickBooks. Open one to read the note or clear the flag. Any month.
      </p>
      {error && <Banner tone="error">{error}</Banner>}
      {!error && bills === null && <Loading label="Loading flagged bills…" />}
      {bills !== null && bills.length === 0 && !error && <EmptyState>No bills are flagged for review.</EmptyState>}
      {bills !== null && bills.length > 0 && (
        <ListCard>
          {bills.map((b) => (
            <ListRow
              key={b.docId}
              wrap
              href={`/bill/${b.docId}${b.jobId ? `?jobId=${encodeURIComponent(b.jobId)}` : ""}`}
              label={`${b.vendor || "Bill"}${b.amount == null ? "" : ` · ${money(b.amount)}`}`}
              desc={[
                [b.customer, b.jobName].filter(Boolean).join(" — "),
                b.note ? `⚑ ${b.note}` : "",
                [b.flaggedBy ? `flagged by ${b.flaggedBy}` : "flagged", shortDate(b.flaggedAt)].filter(Boolean).join(" · "),
              ]
                .filter(Boolean)
                .join(" — ")}
            />
          ))}
        </ListCard>
      )}
    </section>
  );
}
