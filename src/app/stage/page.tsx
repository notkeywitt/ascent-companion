"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { JtLink } from "@/components/JtLink";
import { BillStatusBadge } from "@/components/BillStatusBadge";

interface Csi {
  code: string;
  name: string;
  amount: number;
}
interface BillRef {
  id: string;
  label: string;
  cost: number;
  invoiced: boolean;
  status?: string;
  csi?: Csi[];
}
interface TimeEntryRef {
  id: string;
  employee: string;
  hours: number;
  rate: number;
  cost: number;
  code?: string;
  codeName?: string;
}
interface Line {
  key: string;
  label: string;
  cost: number;
  billIds: string[];
  isSunset: boolean;
  bills?: BillRef[];
  timeEntries?: TimeEntryRef[];
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const hoursAtRate = (t: TimeEntryRef) => `${t.hours.toFixed(2)} hrs @ ${money(t.rate)}/hr`;

// CSI cost-code label: "01 31 10 · Project Management". Collapses to a single
// value when the code number and name are identical (e.g. "Office Admin").
const csiLabel = (code?: string, name?: string) =>
  name && code && name !== code ? `${code} · ${name}` : name || code || "";

// Drive the adjacent JobTread window (desktop side-panel host) to a document —
// same dual-navigation the Billing tab uses so clicking a bill opens both the
// companion bill view and the JobTread page. No-op when unframed (mobile).
function driveMainWindowToDoc(jobId: string, docId: string) {
  try {
    if (typeof window !== "undefined" && window.top !== window.self && jobId) {
      window.parent.postMessage(
        {
          type: "ascentOpenJtDoc",
          href: `https://app.jobtread.com/jobs/${jobId}/documents/${docId}`,
        },
        "*",
      );
    }
  } catch {
    /* cross-origin / unframed — ignore */
  }
}

function monthOptions() {
  const opts: { ym: string; label: string; lastDay: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const last = new Date(y, m, 0).getDate();
    opts.push({
      ym: `${y}-${String(m).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      lastDay: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
    });
  }
  return opts;
}

function Stage() {
  const search = useSearchParams();
  const jobId = (search.get("jobId") ?? "").trim();
  const [ym, setYm] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [job, setJob] = useState<{ id: string; name: string } | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Filter toggles. Defaults reproduce the original behavior: uninvoiced only,
  // restricted to the selected billing month.
  const [uninvoicedOnly, setUninvoicedOnly] = useState(true);
  const [filterByMonth, setFilterByMonth] = useState(true);
  // View mode: false = group by vendor/labor (default), true = roll everything up
  // by CSI cost code. Pure client-side transform of the already-loaded lines —
  // no reload. Drives both the panel table and the print/PDF.
  const [groupByCsi, setGroupByCsi] = useState(false);

  const opt = monthOptions().find((o) => o.ym === ym);

  // Aggregate every bill's CSI cost items and every time entry into one row per
  // cost code (amount desc). A residual bucket absorbs the difference between the
  // authoritative grand total and the sum of coded amounts (document tax, which
  // rides in nonRecoverableTax outside line costs, plus any uncoded line/time) so
  // the CSI-grouped total always matches the panel total.
  const csiGrouped = useMemo<Csi[] | null>(() => {
    if (!lines) return null;
    const map = new Map<string, { name: string; amount: number }>();
    let coded = 0;
    const add = (code: string, name: string, amount: number) => {
      if (!code) return;
      const prev = map.get(code);
      map.set(code, { name: name || prev?.name || "", amount: (prev?.amount ?? 0) + amount });
      coded += amount;
    };
    for (const l of lines) {
      for (const b of l.bills ?? []) for (const c of b.csi ?? []) add(c.code, c.name, c.amount);
      for (const t of l.timeEntries ?? []) add(t.code ?? "", t.codeName ?? "", t.cost);
    }
    const rows = Array.from(map.entries())
      .map(([code, v]) => ({ code, name: v.name, amount: v.amount }))
      // Sort by CSI code ascending (numeric-aware so "06 10 10" < "26 00 00").
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }));
    const residual = total - coded;
    if (Math.abs(residual) > 0.005) rows.push({ code: "", name: "Uncoded / tax", amount: residual });
    return rows;
  }, [lines, total]);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    setLines(null);
    try {
      const [y, m] = ym.split("-").map(Number);
      const params = new URLSearchParams({ jobId });
      if (filterByMonth) {
        params.set("year", String(y));
        params.set("month", String(m));
      }
      if (!uninvoicedOnly) params.set("includeInvoiced", "1");
      const res = await fetch(`/api/stage?${params.toString()}`);
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "Failed");
      else {
        setLines(j.lines ?? []);
        setTotal(j.total ?? 0);
        setCustomer(j.customer ?? null);
        setJob(j.job ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [jobId, ym, uninvoicedOnly, filterByMonth]);

  useEffect(() => {
    load();
  }, [load]);

  // Print by opening a self-contained document in a NEW top-level tab, then
  // printing that. The companion is iframed by the JobTread Chrome side panel,
  // and window.print() is silently blocked inside that sandbox — so we escape
  // the frame with window.open("_blank") (same trick JtLink uses for links).
  // Falls back to in-page window.print() only if the popup is blocked.
  const printSummary = useCallback(() => {
    if (!lines || lines.length === 0) return;
    const esc = (s: string) =>
      String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
    const monthLabel = opt?.label ?? ym;

    // CSI breakdown rows (deepest indent) under a bill.
    const csiSubs = (csi?: Csi[]) =>
      (csi ?? [])
        .map(
          (c) =>
            `<tr class="sub2"><td>${esc(csiLabel(c.code, c.name))}</td><td class="num">${money(c.amount)}</td></tr>`,
        )
        .join("");

    // CSI-grouped mode: one flat row per cost code (matches the panel view).
    const rowsHtml = groupByCsi
      ? (csiGrouped ?? [])
          .map(
            (c) =>
              `<tr><td>${esc(csiLabel(c.code, c.name))}</td><td class="num">${money(c.amount)}</td></tr>`,
          )
          .join("")
      : lines
      .map((l) => {
        if (l.isSunset && l.bills && l.bills.length) {
          const group = `<tr class="grp"><td>${esc(l.label)}</td><td class="num">${money(l.cost)}</td></tr>`;
          const subs = l.bills
            .map(
              (b) =>
                `<tr class="sub"><td>${esc(b.label)}</td><td class="num">${money(b.cost)}</td></tr>` +
                csiSubs(b.csi),
            )
            .join("");
          return group + subs;
        }
        if (l.timeEntries && l.timeEntries.length) {
          const group = `<tr class="grp"><td>${esc(l.label)}</td><td class="num">${money(l.cost)}</td></tr>`;
          const subs = l.timeEntries
            .map((t) => {
              const code = t.code ? ` — ${esc(csiLabel(t.code, t.codeName))}` : "";
              return `<tr class="sub"><td>${esc(t.employee)}${code}<div class="dim">${esc(hoursAtRate(t))}</div></td><td class="num">${money(t.cost)}</td></tr>`;
            })
            .join("");
          return group + subs;
        }
        // Single vendor bill (or a bare line): show the line, then its CSI breakdown.
        const csi = l.bills && l.bills.length === 1 ? l.bills[0].csi : undefined;
        return (
          `<tr><td>${esc(l.label)}</td><td class="num">${money(l.cost)}</td></tr>` + csiSubs(csi)
        );
      })
      .join("");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Billing Summary — ${esc(monthLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #000; margin: 0.6in; }
  .brand { font-size: 20px; font-weight: 700; }
  .doc-title { font-size: 16px; font-weight: 600; margin-top: 2px; }
  .meta { font-size: 13px; margin-top: 10px; line-height: 1.5; }
  .meta b { display: inline-block; min-width: 78px; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ccc; text-align: left; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #555; border-bottom: 1px solid #000; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.sub td { padding-left: 24px; color: #444; border-bottom: 1px solid #eee; }
  tr.sub2 td { padding-left: 44px; color: #666; font-size: 12px; border-bottom: 1px solid #f2f2f2; }
  tr.sub .dim { color: #888; font-size: 11px; margin-top: 1px; }
  tr.grp td { font-weight: 600; }
  tr.total td { font-weight: 700; border-top: 2px solid #000; border-bottom: none; font-size: 14px; }
  @page { margin: 0.6in; }
</style>
</head>
<body onload="window.focus(); window.print();">
  <div class="brand">Ascent Building Co.</div>
  <div class="doc-title">Billing Summary — ${esc(monthLabel)}</div>
  <div class="meta">
    ${customer?.name ? `<div><b>Customer</b> ${esc(customer.name)}</div>` : ""}
    ${job?.name ? `<div><b>Job</b> ${esc(job.name)}</div>` : ""}
  </div>
  <table>
    <thead><tr><th>${groupByCsi ? "CSI Code" : "Bill"}</th><th class="num">${groupByCsi ? "Amount" : "Cost"}</th></tr></thead>
    <tbody>
      ${rowsHtml}
      <tr class="total"><td>Total</td><td class="num">${money(total)}</td></tr>
    </tbody>
  </table>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) {
      window.print(); // popup blocked — best effort (works only when unframed)
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }, [lines, total, customer, job, opt, ym, groupByCsi, csiGrouped]);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <div className="mb-3 no-print">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Invoice date (billing month)
        </label>
        <select
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          disabled={!filterByMonth}
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-2 text-sm disabled:opacity-40 dark:border-neutral-700"
        >
          {monthOptions().map((o) => (
            <option key={o.ym} value={o.ym}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 no-print">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={uninvoicedOnly}
            onChange={(e) => setUninvoicedOnly(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Uninvoiced only
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filterByMonth}
            onChange={(e) => setFilterByMonth(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Filter by billing month
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={groupByCsi}
            onChange={(e) => setGroupByCsi(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Group by CSI code
        </label>
      </div>

      {!jobId && (
        <p className="mb-3 text-sm text-neutral-500 no-print">Pick a job above to stage its invoice.</p>
      )}
      {customer && (
        <p className="mb-3 text-sm text-neutral-500 no-print">Customer: {customer.name}</p>
      )}
      {loading && <p className="text-sm text-neutral-500 no-print">Loading…</p>}
      {error && (
        <div className="no-print rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {lines && lines.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No uninvoiced bills — every approved bill on this job is already on a customer invoice.
        </div>
      )}

      {lines && lines.length > 0 && (
        <>
          {/* Screen-only toolbar. window.print() prints the letterhead + table
              below (everything tagged no-print is stripped by the print CSS),
              so the office can print or Save-as-PDF this billing summary. */}
          <div className="mb-3 flex justify-end no-print">
            <button
              onClick={printSummary}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:border-accent hover:text-accent dark:border-neutral-700 dark:text-neutral-300"
            >
              Print / Save PDF
            </button>
          </div>

          {/* Print-only letterhead — hidden on screen, shown when printing. */}
          <div className="mb-4 hidden print:block">
            <div className="text-lg font-bold">Ascent Building Co.</div>
            <div className="mt-1 text-base font-semibold">
              Billing Summary — {opt?.label ?? ym}
            </div>
            <div className="mt-2 text-sm">
              {customer?.name && (
                <div>
                  <span className="font-semibold">Customer:</span> {customer.name}
                </div>
              )}
              {job?.name && (
                <div>
                  <span className="font-semibold">Job:</span> {job.name}
                </div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm print-table">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">{groupByCsi ? "CSI Code" : "Bill"}</th>
                  <th className="px-3 py-2 text-right font-medium">
                    {groupByCsi ? "Amount" : "Cost"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupByCsi
                  ? (csiGrouped ?? []).map((c) => (
                      <tr
                        key={c.code || "residual"}
                        className="border-t border-neutral-100 dark:border-neutral-800"
                      >
                        <td className="px-3 py-2">{csiLabel(c.code, c.name)}</td>
                        <td className="px-3 py-2 text-right font-mono">{money(c.amount)}</td>
                      </tr>
                    ))
                  : lines.map((l) => {
                  const jt = (id: string) =>
                    `https://app.jobtread.com/jobs/${jobId}/documents/${id}`;
                  // A bill's label → companion bill view (+ drive JT window),
                  // followed by an explicit JT ↗ link (works standalone too).
                  // Bills already on a customer invoice get an "invoiced" tag
                  // (only visible when the Uninvoiced-only toggle is off).
                  const billLinks = (id: string, text: string, invoiced?: boolean, status?: string) => (
                    <>
                      <Link
                        href={`/bill/${id}?jobId=${encodeURIComponent(jobId)}`}
                        onClick={() => driveMainWindowToDoc(jobId, id)}
                        className="text-accent hover:underline"
                      >
                        {text}
                      </Link>
                      <BillStatusBadge status={status} className="ml-2" />
                      {invoiced && (
                        <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                          invoiced
                        </span>
                      )}
                      <JtLink
                        href={jt(id)}
                        className="ml-2 text-xs text-neutral-400 hover:text-accent"
                      >
                        JT ↗
                      </JtLink>
                    </>
                  );

                  // CSI cost-code breakdown rows beneath a bill (deepest indent).
                  const csiRows = (csi: Csi[] | undefined, keyPrefix: string, pad: string) =>
                    (csi ?? []).map((c) => (
                      <tr
                        key={`${keyPrefix}-${c.code}`}
                        className="border-t border-neutral-50 dark:border-neutral-900/60"
                      >
                        <td className={`py-1 pr-3 text-xs text-neutral-500 dark:text-neutral-400 ${pad}`}>
                          {csiLabel(c.code, c.name)}
                        </td>
                        <td className="px-3 py-1 text-right font-mono text-xs text-neutral-500 dark:text-neutral-400">
                          {money(c.amount)}
                        </td>
                      </tr>
                    ));

                  // Sunset: keep the grouped total, then itemize each bill below.
                  if (l.isSunset && l.bills && l.bills.length) {
                    return (
                      <Fragment key={l.key}>
                        <tr className="border-t border-neutral-100 dark:border-neutral-800">
                          <td className="px-3 py-2 font-medium">{l.label}</td>
                          <td className="px-3 py-2 text-right font-mono">{money(l.cost)}</td>
                        </tr>
                        {l.bills.map((bl) => (
                          <Fragment key={bl.id}>
                            <tr className="border-t border-neutral-50 dark:border-neutral-900/60">
                              <td className="px-3 py-1.5 pl-6">
                                {billLinks(bl.id, bl.label, bl.invoiced, bl.status)}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-neutral-600 dark:text-neutral-400">
                                {money(bl.cost)}
                              </td>
                            </tr>
                            {csiRows(bl.csi, bl.id, "pl-12")}
                          </Fragment>
                        ))}
                      </Fragment>
                    );
                  }

                  // Single vendor bill → link the line to its companion view,
                  // then itemize its CSI cost codes beneath it.
                  if (l.bills && l.bills.length === 1) {
                    return (
                      <Fragment key={l.key}>
                        <tr className="border-t border-neutral-100 dark:border-neutral-800">
                          <td className="px-3 py-2">
                            {billLinks(l.bills[0].id, l.label, l.bills[0].invoiced, l.bills[0].status)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{money(l.cost)}</td>
                        </tr>
                        {csiRows(l.bills[0].csi, l.bills[0].id, "pl-9")}
                      </Fragment>
                    );
                  }

                  // Time & labor — itemize each entry below the group total:
                  // employee + CSI cost code, with hours/rate detail and the
                  // entry's own amount.
                  if (l.timeEntries && l.timeEntries.length) {
                    return (
                      <Fragment key={l.key}>
                        <tr className="border-t border-neutral-100 dark:border-neutral-800">
                          <td className="px-3 py-2 font-medium">{l.label}</td>
                          <td className="px-3 py-2 text-right font-mono">{money(l.cost)}</td>
                        </tr>
                        {l.timeEntries.map((t) => (
                          <tr key={t.id} className="border-t border-neutral-50 dark:border-neutral-900/60">
                            <td className="px-3 py-1.5 pl-6">
                              <div>
                                {t.employee}
                                {t.code && (
                                  <span className="text-neutral-500 dark:text-neutral-400">
                                    {" — "}
                                    {csiLabel(t.code, t.codeName)}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                                {hoursAtRate(t)}
                              </div>
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-neutral-600 dark:text-neutral-400">
                              {money(t.cost)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  }

                  // Non-document line with no detail to itemize — no link target.
                  return (
                    <tr key={l.key} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="px-3 py-2">{l.label}</td>
                      <td className="px-3 py-2 text-right font-mono">{money(l.cost)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-neutral-200 font-semibold dark:border-neutral-700">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">{money(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <JtLink
            href={`https://app.jobtread.com/jobs/${jobId}/documents`}
            className="no-print mt-4 block w-full rounded-xl bg-accent px-4 py-3 text-center text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Create invoice in JobTread ↗
          </JtLink>
          <p className="mt-2 text-xs text-neutral-500 no-print">
            This is what to bill for {opt?.label ?? "the month"}. Tap to open this job in JobTread,
            then <b>New → Customer Invoice</b> — its builder pulls exactly these uninvoiced bills
            (and any uninvoiced time). Date it {opt?.lastDay}, review &amp; send.
          </p>
        </>
      )}
    </main>
  );
}

export default function StagePage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Stage />
    </Suspense>
  );
}
