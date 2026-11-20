"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { JobParamPicker } from "@/components/JobPicker";
import { Banner, Button, EmptyState, Input, Loading, PageHeader, tableCls } from "@/components/ui";
import type { ClientBudgetReport as Report, ClientBudgetRow } from "@/lib/clientBudget";
import { money } from "@/lib/money";

interface Payload {
  jobName: string;
  customer: string;
  budgetBasis: "customerOrders" | "budgetLeaves";
  report: Report;
  deposit: { deposit: number; applied: number; left: number | null } | null;
}

const pct = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}%`);
const monthLabel = (ym: string) =>
  new Date(`${ym}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const today = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** One row's money cells, shared by code rows, division subtotals and the job total. */
function Cells({ r }: { r: Omit<ClientBudgetRow, "code" | "name"> }) {
  return (
    <>
      <td className={tableCls.tdNum}>{money(r.budget)}</td>
      <td className={tableCls.tdNum}>{money(r.billed)}</td>
      <td className={`${tableCls.tdNum} ${r.remaining < 0 ? "text-danger" : ""}`}>{money(r.remaining)}</td>
      <td className={tableCls.tdNum}>{pct(r.pctInvoiced)}</td>
      <td className={tableCls.tdNum}>{money(r.costToDate)}</td>
      <td className={`${tableCls.tdNum} ${r.costToComplete < 0 ? "text-danger" : ""}`}>
        {money(r.costToComplete)}
      </td>
    </>
  );
}

/**
 * CLIENT BUDGET REPORT — printed and sent with each invoice, in place of the
 * 11×17 tracking-sheet PDF. Read only. Landscape on letter or 11×17.
 */
export function ClientBudgetReport({ defaultYm }: { defaultYm: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const jobId = (search.get("jobId") ?? "").trim();
  const ym = /^\d{4}-\d{2}$/.test(search.get("month") ?? "") ? search.get("month")! : defaultYm;

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!jobId) return;
    let live = true;
    setData(null);
    setError("");
    fetch(`/api/client-budget?jobId=${encodeURIComponent(jobId)}&month=${ym}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (live) setData(j);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [jobId, ym]);

  const setMonth = (v: string) => {
    if (!/^\d{4}-\d{2}$/.test(v)) return;
    const p = new URLSearchParams(search.toString());
    p.set("month", v);
    router.replace(`${pathname}?${p}`);
  };

  const r = data?.report;
  return (
    <main className="w-full max-w-[1400px] px-4 pad:px-7 pb-24 pt-6 print:max-w-none print:p-0 print:text-[10px]">
      {/* Landscape fits the eight columns on letter and on 11×17. */}
      <style>{`@media print { @page { size: landscape; margin: 0.4in; } }`}</style>

      <div className="no-print">
        <PageHeader
          title="Client Budget Report"
          actions={
            <Button onClick={() => window.print()} disabled={!data}>
              Print
            </Button>
          }
        />
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="min-w-64 flex-1">
            <JobParamPicker includeAll={false} placeholder="Choose a job…" />
          </div>
          <Input type="month" value={ym} onChange={(e) => setMonth(e.target.value)} className="w-44" aria-label="Through month" />
        </div>
      </div>

      {!jobId && <EmptyState>Pick a job to build its report.</EmptyState>}
      {error && <Banner tone="error">{error}</Banner>}
      {jobId && !data && !error && <Loading label="Reading the job's budget and invoices…" />}

      {data && r && (
        <article>
          <header className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[var(--caption-tracking)] text-neutral-500">
                Ascent Building Co. · Client Budget Report
              </div>
              <h2 className="mt-1 text-xl font-semibold">{data.jobName || "Job"}</h2>
              {data.customer && <div className="text-sm">{data.customer}</div>}
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 text-sm">
              <dt className="text-neutral-500">Through</dt>
              <dd>{monthLabel(ym)}</dd>
              <dt className="text-neutral-500">Report date</dt>
              <dd>{today()}</dd>
            </dl>
          </header>

          {data.budgetBasis === "budgetLeaves" && (
            <p className="no-print mb-3 text-sm text-warn">
              This job has no approved customer order. The budget is the base estimate.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className={`${tableCls.root} print-table print:text-[10px]`}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Cost code</th>
                  <th className={tableCls.thNum}>Budget</th>
                  <th className={tableCls.thNum}>Billed to date</th>
                  <th className={tableCls.thNum}>Budget remaining</th>
                  <th className={tableCls.thNum}>% invoiced</th>
                  <th className={tableCls.thNum}>Cost to date</th>
                  <th className={tableCls.thNum}>Cost to complete</th>
                </tr>
              </thead>
              <tbody>
                {r.divisions.map((d) => (
                  <Fragment key={d.division}>
                    <tr className="break-inside-avoid">
                      <td colSpan={7} className={`${tableCls.td} pt-4 font-semibold`}>
                        {d.division} {d.name}
                      </td>
                    </tr>
                    {d.rows.map((row) => (
                      <tr key={row.code} className={`${tableCls.tr} break-inside-avoid`}>
                        <td className={tableCls.td}>
                          <span className="tabular-nums">{row.code}</span> {row.name}
                        </td>
                        <Cells r={row} />
                      </tr>
                    ))}
                    <tr className={`${tableCls.foot} break-inside-avoid`}>
                      <td className={tableCls.td}>{d.name || d.division} total</td>
                      <Cells r={d} />
                    </tr>
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-bold">
                  <td className={tableCls.td}>Job total</td>
                  <Cells r={r} />
                </tr>
              </tfoot>
            </table>
          </div>

          {data.deposit && (
            <dl className="mt-6 grid max-w-sm grid-cols-2 gap-x-6 gap-y-1 break-inside-avoid text-sm">
              <dt className="col-span-2 font-semibold">Deposit</dt>
              <dt className="text-neutral-500">Deposit received</dt>
              <dd className="text-right tabular-nums">{money(data.deposit.deposit)}</dd>
              <dt className="text-neutral-500">Applied to invoices</dt>
              <dd className="text-right tabular-nums">{money(data.deposit.applied)}</dd>
              <dt className="text-neutral-500">Deposit left</dt>
              <dd className="text-right tabular-nums">{money(data.deposit.left)}</dd>
            </dl>
          )}
        </article>
      )}
    </main>
  );
}
