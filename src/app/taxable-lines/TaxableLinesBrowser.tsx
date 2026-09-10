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
import type { TaxableLinesReport, UntaxedBill } from "@/lib/taxableLines";

/**
 * A WORKLIST, not a report. Every row exists so the office can open one bill,
 * tick the flag on the named lines and move to the next — so the bill's link is
 * the row, the lines are named under it, and the order is what each one costs
 * the client invoice.
 *
 * NOTHING HERE WRITES. Whether a cost is taxable is a tax decision, and a bulk
 * update across a month of live bills is the wrong shape for one.
 *
 * The one thing the page keeps is which bills you have already done — in this
 * browser only (`localStorage`), because it is a scratch mark on a cleanup, not
 * a fact about the bill. JobTread stays the truth: reload the month and a bill
 * you actually fixed drops off the list on its own.
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

  const open = data?.bills.filter((b) => !done.has(b.billId)) ?? [];
  const openTax = open.reduce((n, b) => n + b.taxAtStake, 0);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <PageHeader
        title="Taxable flags"
        description="Bill lines marked non-taxable, which take their cost out of the client invoice's tax base."
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
            label={`${monthLabel(data.ym)} — sales tax not being billed`}
            value={money(openTax)}
            sub={
              <>
                {plural(open.length, "bill")} · {money(open.reduce((n, b) => n + b.cost, 0))} of
                cost
                {done.size > 0 ? <> · {done.size} ticked off</> : null}
              </>
            }
            footnote={
              `Estimated at ${Math.round((data.markup - 1) * 100)}% P&O and ` +
              `${(data.taxRate * 100).toFixed(2)}% tax. Ascent's own jobs and sales-tax lines are ` +
              `left out — ${data.skipped.overheadLines} and ${data.skipped.salesTaxLines} lines ` +
              `this month. Nothing on this page writes to JobTread.`
            }
          />

          <Banner tone="info">
            Fix BOTH sides. Clearing the flag on a bill does not move an invoice already built from
            it — Create Invoice copies the flag, so the invoice line is its own record. Fix the bill
            so it never comes back, and the draft invoice so this month bills right.
          </Banner>

          {data.bills.length === 0 && (
            <EmptyState>No bill line in {monthLabel(data.ym)} is flagged non-taxable.</EmptyState>
          )}

          {data.bills.length > 0 && (
            <section className="space-y-2">
              <SectionHeading
                trailing={
                  <span className="text-xs tabular-nums text-neutral-500">
                    {plural(data.totals.lines, "line")}
                  </span>
                }
              >
                Bills to fix
              </SectionHeading>
              <p className="text-[11px] text-neutral-500">
                Biggest first — what each one costs the client invoice.
              </p>
              {data.bills.map((b) => (
                <BillRow
                  key={b.billId}
                  bill={b}
                  done={done.has(b.billId)}
                  onToggle={() => toggleDone(b.billId)}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </main>
  );
}

/** One bill: where it is, which lines to tick, and what it costs to leave. */
function BillRow({
  bill,
  done,
  onToggle,
}: {
  bill: UntaxedBill;
  done: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className={done ? "opacity-50" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{bill.vendor || "Unknown vendor"}</p>
          <MetaLine
            items={[
              `${bill.customerName || "—"} · ${bill.jobName}`,
              bill.issueDate,
              bill.status,
              bill.mixed ? null : (
                <Chip key="all" tone="neutral">
                  Every line
                </Chip>
              ),
            ]}
            className="mt-1"
          />
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold tabular-nums">{money(bill.taxAtStake)}</p>
          <p className="text-[11px] text-neutral-500">tax not billed</p>
        </div>
      </div>

      {/* The lines to tick, named exactly as JobTread names them. */}
      <ul className="mt-2.5 divide-y divide-line-soft border-t border-line-soft">
        {bill.lines.map((l) => (
          <li key={l.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[12px]">
            <span className="min-w-0 flex-1">
              {l.costCode ? (
                <span className="text-neutral-500">{l.costCode} · </span>
              ) : null}
              {l.name}
            </span>
            <span className="shrink-0 tabular-nums text-neutral-500">{money(l.cost)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <a className={btn("secondary", "sm")} href={bill.jtUrl} target="_blank" rel="noreferrer">
          Open the bill ↗
        </a>
        <a
          className={btn("ghost", "sm")}
          href={`https://app.jobtread.com/jobs/${encodeURIComponent(bill.jobId)}/documents`}
          target="_blank"
          rel="noreferrer"
        >
          The job&rsquo;s invoices ↗
        </a>
        <a className={btn("ghost", "sm")} href={`/bill/${encodeURIComponent(bill.billId)}`}>
          In the app
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
        {bill.untaxedCount} of {bill.lineCount || "?"} lines flagged
        {bill.mixed ? "" : " — the whole bill, so check it is not a real exemption"}.
      </p>
    </Card>
  );
}
