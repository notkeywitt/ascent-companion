"use client";

import type { Dispatch, SetStateAction } from "react";
import { Banner, Button, Loading, Toggle, btn } from "@/components/ui";
import { JtLink } from "@/components/JtLink";
import { money } from "./BillCodingCard";
import type { Recon } from "@/components/InvoiceReconcile";
import { Breakdown, printJob, type Detail } from "@/components/BillingSummary";
import { issueDateFor, monthLabel } from "@/lib/billingMonths";

/**
 * The Tracking Sheets board's Summary view: the client-facing billing
 * summary for the month, by cost code or by CSI division, with its reconcile
 * against the JobTread invoice.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * markup is the board's, unchanged.
 */
export function BillingSummaryView({
  c,
  jobId,
  mode,
  recon,
  setSummaryByCsi,
  summary,
  summaryByCsi,
  summaryError,
  summaryLoading,
  ym,
}: {
  c: (key: string, vars?: Record<string, string | number>) => string;
  jobId: string;
  mode: "bill" | "code" | "summary";
  recon: Recon | null;
  setSummaryByCsi: Dispatch<SetStateAction<boolean>>;
  summary: Detail | null;
  summaryByCsi: boolean;
  summaryError: string;
  summaryLoading: boolean;
  ym: string;
}) {
  return (
    <>
            {/* ---- the client-facing billing summary ----
                What this job bills for the month, in the shape the customer
                sees it: every bill (Sunset grouped, time itemized) or the CSI
                rollup, plus the printable document and the link into JobTread's
                invoice builder. It is the LAST step of the workflow this page
                owns — code the month on the left, then check and print what it
                adds up to here — which is why it's a mode of this page rather
                than the separate screen it used to be. */}
            {mode === "summary" && (
              <>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Toggle
                    checked={summaryByCsi}
                    onChange={setSummaryByCsi}
                    label={c("recode.toggle.groupByCsi")}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!summary}
                    onClick={() => summary && printJob(summary, monthLabel(ym), summaryByCsi)}
                  >
                    Print / Save PDF
                  </Button>
                </div>

                {summaryLoading && !summary && <Loading label={c("recode.loading.summary")} />}
                {summaryError && (
                  <Banner tone="error" className="mb-2">
                    {summaryError}
                  </Banner>
                )}
                {summary && (
                  <>
                    <Breakdown detail={summary} groupByCsi={summaryByCsi} from="recode" />
                    {/* The month's invoice may already exist — recon knows, and
                        prompting to "create" one then invites a duplicate. Link
                        to what's there instead, and keep the create CTA for the
                        case it's actually for. */}
                    {recon && recon.invoices.length > 0 ? (
                      <>
                        {recon.invoices.map((iv) => (
                          <JtLink
                            key={iv.id}
                            href={`https://app.jobtread.com/jobs/${jobId}/documents/${iv.id}`}
                            className={btn("secondary", "md", "mt-3 w-full")}
                          >
                            Open invoice #{iv.number || iv.id}
                            {iv.status === "draft" ? " (draft)" : ""} ↗
                          </JtLink>
                        ))}
                        <p className="mt-2 text-xs text-neutral-500">
                          {recon.invoices.length === 1 ? "An invoice" : "Invoices"} for{" "}
                          {monthLabel(ym)} already{" "}
                          {recon.invoices.length === 1 ? "exists" : "exist"}
                          {recon.remaining - recon.onDraftInvoiceCost > 0.01 ? (
                            <>
                              , but {money(recon.remaining - recon.onDraftInvoiceCost)} is on no
                              invoice at all — add it to the existing invoice rather than raising a
                              second one.
                            </>
                          ) : recon.draftBillCount > 0 ? (
                            <>
                              , but {money(recon.draftBillsCost)} in {recon.draftBillCount} draft
                              bill{recon.draftBillCount === 1 ? "" : "s"} can&apos;t go on it until
                              approved in JobTread.
                            </>
                          ) : (
                            <>. Everything for the month is on it.</>
                          )}
                        </p>
                      </>
                    ) : (
                      /* No BUTTON here. The month has exactly one
                         create-invoice action and it lives in the closing row
                         below, gated on every bill being approved and nothing
                         being staged — a second primary CTA at this spot fired
                         under neither gate and pointed at the same URL. What is
                         left is the instruction, which the closing row's button
                         does not carry. */
                      <p className="mt-3 text-xs text-neutral-500">
                        No invoice for {monthLabel(ym)} yet. Approve the month&apos;s draft bills
                        below, then <b>Create Invoice in JobTread</b> — its builder pulls exactly
                        these uninvoiced bills (and any uninvoiced time). Date it {issueDateFor(ym)}
                        , review &amp; send.
                      </p>
                    )}
                  </>
                )}
              </>
            )}

    </>
  );
}
