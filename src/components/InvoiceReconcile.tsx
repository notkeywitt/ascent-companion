"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { JtLink } from "@/components/JtLink";
import type { InvoiceRef } from "@/lib/jobtread";

/**
 * "Is this month actually invoiced?" — the reconciliation rectangle.
 *
 * Extracted from the Invoicing page so Client Invoicing (/recode) shows the SAME
 * figures from the SAME endpoint. Two copies of this arithmetic would be two
 * copies to keep in step, and the whole point of the number is that it agrees
 * with what JobTread will actually bill.
 *
 * `remaining` = uninvoiced bills + uninvoiced time, i.e. what's invoiceable now.
 * Draft bills are deliberately NOT in it (JobTread won't pull a draft onto an
 * invoice) and are called out separately, otherwise the preview total and the
 * invoiceable total look contradictory.
 *
 * `onData` lets a caller lift the figures out for its own header without
 * fetching them a second time.
 */

export interface Recon {
  invoices: InvoiceRef[];
  invoicedBillsCost: number;
  uninvoicedBillsCost: number;
  uninvoicedTimeCost: number;
  remaining: number;
  reconciled: boolean;
  draftBillsCost: number;
  draftBillCount: number;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The month's still-coding bills, spelled out — see the note above. */
export function DraftNote({ cost, count }: { cost: number; count: number }) {
  if (count < 1 || Math.abs(cost) < 0.01) return null;
  return (
    <div className="mt-1 opacity-80">
      {money(cost)} in {count} draft bill{count === 1 ? "" : "s"} is excluded — approve
      {count === 1 ? " it" : " them"} in JobTread to invoice {count === 1 ? "it" : "them"}.
    </div>
  );
}

export function InvoiceReconcile({
  jobId,
  ym,
  onData,
}: {
  jobId: string;
  ym: string;
  onData?: (r: Recon | null) => void;
}) {
  const [data, setData] = useState<Recon | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    onData?.(null);
    const [y, m] = ym.split("-").map(Number);
    (async () => {
      try {
        const res = await fetch(
          `/api/stage/invoices?jobId=${encodeURIComponent(jobId)}&year=${y}&month=${m}`,
        );
        const j = await res.json();
        if (!live) return;
        if (res.ok) {
          setData(j);
          onData?.(j);
        } else setError(j.error ?? "Failed");
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Network error");
      }
    })();
    return () => {
      live = false;
    };
    // onData is intentionally not a dep — callers pass an inline callback, and
    // depending on it would re-fetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, ym]);

  if (error) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
        Couldn&apos;t check JobTread for invoices: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Spinner /> Checking JobTread for the invoice…
      </div>
    );
  }

  const { invoices, remaining, reconciled, draftBillsCost, draftBillCount } = data;

  // No live (non-denied) invoice pulls this month's work yet.
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-neutral-50 px-2.5 py-2 text-xs text-neutral-600 dark:bg-white/5 dark:text-neutral-300">
        <span className="font-semibold">No invoice in JobTread yet.</span>
        {remaining > 0.01 ? ` ${money(remaining)} invoiceable now.` : ""} Create it in JobTread,
        then reopen to reconcile.
        <DraftNote cost={draftBillsCost} count={draftBillCount} />
      </div>
    );
  }

  return (
    <div
      className={
        "rounded-lg border px-2.5 py-2 text-xs " +
        (reconciled
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300")
      }
    >
      <div className="flex items-center justify-between gap-2 font-semibold">
        <span>
          {reconciled
            ? "✓ Reconciled — every finalized bill this month is on an invoice"
            : `⚠ ${money(remaining)} still uninvoiced`}
        </span>
        <span className="tabular-nums">
          {invoices.length} invoice{invoices.length === 1 ? "" : "s"} in JT
        </span>
      </div>
      {!reconciled && (
        <div className="mt-0.5 opacity-80">
          Some finalized bills or time for this month aren&apos;t on an invoice yet — extend or add
          an invoice to capture the rest.
        </div>
      )}
      <DraftNote cost={draftBillsCost} count={draftBillCount} />
      <ul className="mt-1.5 space-y-0.5 border-t border-current/20 pt-1.5">
        {invoices.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between gap-3 tabular-nums">
            <JtLink
              href={`https://app.jobtread.com/jobs/${jobId}/documents/${inv.id}`}
              className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
            >
              Invoice #{inv.number || "—"} ↗
            </JtLink>
            <span className="flex items-center gap-2">
              <span className="rounded bg-current/10 px-1 text-[10px] font-semibold uppercase tracking-wide">
                {inv.status}
              </span>
              {money(inv.total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
