"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Card,
  Chip,
  EmptyState,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  Select,
  StatementBlock,
  btn,
} from "@/components/ui";
import { billingMonths, monthLabel } from "@/lib/billingMonths";
import type { TaxableLinesReport, UntaxedDoc } from "@/lib/taxableLines";

/**
 * A WORKLIST, not a report, and it is in TWO PARTS because the fix is.
 *
 * The flag lives on a cost item, and Create Invoice COPIES it from the bill's
 * line onto the invoice's own. From that moment they are separate records:
 *
 *   THE CLIENT INVOICE — the line that actually bills the client. Fixing it is
 *                        what makes this month come out right, so it leads.
 *   THE VENDOR BILL    — the source. Fixing it stops the next invoice pulled
 *                        from that bill inheriting the flag again.
 *
 * A PUSHED OR PAID BILL CANNOT BE EDITED, which is why the split matters rather
 * than being tidy: for those, the invoice is the only side the office can
 * reach. A locked bill says so on its row instead of sending someone at a
 * document that will not take the change.
 *
 * NOTHING HERE WRITES. Whether a cost is taxable is a tax decision, and a bulk
 * update across a month of live documents is the wrong shape for one.
 *
 * The one thing the page keeps is which documents you have already done — in
 * this browser only (`localStorage`), because it is a scratch mark on a
 * cleanup, not a fact about the document. JobTread stays the truth: reload the
 * month and anything actually fixed drops off the list on its own.
 */

const MONTH_COUNT = 18;
const DONE_KEY = "taxable-lines:done";

const money = (n: number) =>
  (n < 0 ? "-$" : "$") +
  Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Ticked-off bill ids. Never throws: a browser with site data blocked must
 *  still render the list. */
function readDone(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function TaxableLinesBrowser() {
  const [ym, setYm] = useState("");
  const [data, setData] = useState<TaxableLinesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());

  const months = useMemo(() => billingMonths(MONTH_COUNT), []);

  useEffect(() => setDone(readDone()), []);

  const load = useCallback(async (period: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        period ? `/api/taxable-lines?ym=${encodeURIComponent(period)}` : "/api/taxable-lines",
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body as TaxableLinesReport);
      setYm((body as TaxableLinesReport).ym);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Could not read the month.");
    } finally {
      setLoading(false);
    }
  }, []);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load("");
  }, [load]);

  const toggleDone = (billId: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) next.delete(billId);
      else next.add(billId);
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify([...next]));
      } catch {
        /* a scratch mark that will not persist is still worth showing */
      }
      return next;
    });
  };

  const openOf = (docs: UntaxedDoc[]) => docs.filter((d) => !done.has(d.docId));
  const openInvoices = openOf(data?.invoices ?? []);
  const openBills = openOf(data?.bills ?? []);
  const sum = (docs: UntaxedDoc[]) => docs.reduce((n, d) => n + d.taxAtStake, 0);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <PageHeader
        title="Taxable flags"
        description="Lines marked non-taxable, which take their cost out of the client invoice's tax base."
        actions={
          <div className="w-44 max-w-[50vw]">
            <Select
              aria-label="Billing month"
              value={ym}
              onChange={(e) => {
                setYm(e.target.value);
                void load(e.target.value);
              }}
              disabled={loading}
            >
              {ym && !months.some((m) => m.value === ym) && (
                <option value={ym}>{monthLabel(ym)}</option>
              )}
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading && <Loading label="Reading the month from JobTread…" />}

      {!loading && data && (
        <div className="space-y-5">
          <StatementBlock
            label={`${monthLabel(data.ym)} — sales tax the client is not charged`}
            value={money(sum(openInvoices))}
            sub={
              <>
                on {plural(openInvoices.length, "client invoice")} · {money(sum(openBills))} more
                waiting on {plural(openBills.length, "bill")}
                {done.size > 0 ? <> · {done.size} ticked off</> : null}
              </>
            }
            footnote={
              `The invoice figure is exact — it is the line's own price at ` +
              `${(data.taxRate * 100).toFixed(2)}%. A bill has no price, so its figure adds ` +
              `${Math.round((data.markup - 1) * 100)}% P&O and is an estimate. Ascent's own jobs ` +
              `and sales-tax lines are left out — ${data.skipped.overheadLines} and ` +
              `${data.skipped.salesTaxLines} lines this month. Nothing on this page writes to ` +
              `JobTread.`
            }
          />

          {data.invoices.length === 0 && data.bills.length === 0 && (
            <EmptyState>
              No line in {monthLabel(data.ym)} is flagged non-taxable.
            </EmptyState>
          )}

          {data.invoices.length > 0 && (
            <section className="space-y-2">
              <SectionHeading
                trailing={
                  <span className="text-xs tabular-nums text-neutral-500">
                    {money(sum(openInvoices))}
                  </span>
                }
              >
                On client invoices — fix these first
              </SectionHeading>
              <p className="text-[11px] text-neutral-500">
                This is the line that bills the client. Fixing it is what makes the month come out
                right, and it is the only side you can reach when the bill behind it is already
                pushed or paid.
              </p>
              {data.invoices.map((d) => (
                <DocRow
                  key={d.docId}
                  doc={d}
                  done={done.has(d.docId)}
                  onToggle={() => toggleDone(d.docId)}
                />
              ))}
            </section>
          )}

          {data.bills.length > 0 && (
            <section className="space-y-2">
              <SectionHeading
                trailing={
                  <span className="text-xs tabular-nums text-neutral-500">
                    {money(sum(openBills))}
                  </span>
                }
              >
                On vendor bills — so it does not come back
              </SectionHeading>
              <p className="text-[11px] text-neutral-500">
                The source. Clearing the flag here does not move an invoice already built from the
                bill, but it stops the next one inheriting it. A bill with money against it cannot
                be edited — fix its invoice above instead.
              </p>
              {data.bills.map((d) => (
                <DocRow
                  key={d.docId}
                  doc={d}
                  done={done.has(d.docId)}
                  onToggle={() => toggleDone(d.docId)}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </main>
  );
}

/** One document: where it is, which lines to tick, and what it costs to leave. */
function DocRow({
  doc,
  done,
  onToggle,
}: {
  doc: UntaxedDoc;
  done: boolean;
  onToggle: () => void;
}) {
  const isInvoice = doc.kind === "invoice";
  const title = isInvoice
    ? `Invoice${doc.docNumber ? ` #${doc.docNumber}` : ""}`
    : doc.vendor || "Unknown vendor";

  return (
    <Card className={done ? "opacity-50" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <MetaLine
            items={[
              `${doc.customerName || "—"} · ${doc.jobName}`,
              doc.issueDate || (isInvoice ? "not issued" : ""),
              doc.status,
              // The reason the two lists are separate: this one cannot be
              // edited, so the invoice is the only side that can be fixed.
              doc.locked ? (
                <Chip key="locked" tone="warning">
                  Paid — fix the invoice
                </Chip>
              ) : null,
              doc.mixed ? null : (
                <Chip key="all" tone="neutral">
                  Every line
                </Chip>
              ),
            ]}
            className="mt-1"
          />
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums">{money(doc.taxAtStake)}</p>
          <p className="text-[11px] text-neutral-500">
            {doc.estimated ? "tax, estimated" : "tax not billed"}
          </p>
        </div>
      </div>

      {/* The lines to tick, named exactly as JobTread names them. */}
      <ul className="mt-2.5 divide-y divide-line-soft border-t border-line-soft">
        {doc.lines.map((l) => (
          <li key={l.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[12px]">
            <span className="min-w-0 flex-1">
              {l.costCode ? <span className="text-neutral-500">{l.costCode} · </span> : null}
              {l.name}
            </span>
            <span className="shrink-0 tabular-nums text-neutral-500">
              {money(l.price || l.cost)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <a className={btn("secondary", "sm")} href={doc.jtUrl} target="_blank" rel="noreferrer">
          Open the {isInvoice ? "invoice" : "bill"} ↗
        </a>
        {!isInvoice && (
          <a className={btn("ghost", "sm")} href={`/bill/${encodeURIComponent(doc.docId)}`}>
            In the app
          </a>
        )}
        <a
          className={btn("ghost", "sm")}
          href={`https://app.jobtread.com/jobs/${encodeURIComponent(doc.jobId)}/documents`}
          target="_blank"
          rel="noreferrer"
        >
          The job&rsquo;s documents ↗
        </a>
        <button
          type="button"
          onClick={onToggle}
          className="ml-auto text-[11.5px] text-neutral-500 underline dark:text-neutral-400"
        >
          {done ? "Not done" : "Mark done"}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-neutral-500">
        {doc.untaxedCount} of {doc.lineCount || "?"} lines flagged
        {doc.mixed ? "" : " — the whole document, so check it is not a real exemption"}.
      </p>
    </Card>
  );
}
