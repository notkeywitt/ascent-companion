"use client";

import { Fragment, useMemo } from "react";
import Link from "next/link";
import { JtLink } from "@/components/JtLink";
import { BillStatusBadge } from "@/components/BillStatusBadge";

/**
 * The client-facing billing summary for ONE job in ONE month: the breakdown
 * table, its CSI rollup, and the printable document built from the same data.
 *
 * WHY IT'S A COMPONENT AND NOT A PAGE. This is the artifact the office actually
 * hands to a client, and it now has three callers — the retired Invoicing page
 * (/stage, kept reachable by URL as a fallback), the all-jobs roster on Client
 * Invoicing, and the workbench's Summary mode. Three copies of `groupCsi` would
 * be three chances for the printed total to stop matching the screen, so the
 * arithmetic lives here once and every caller reads the SAME
 * `/api/stage?jobId=` payload into it.
 *
 * The residual row is the load-bearing part: document tax rides outside the
 * line costs, so a pure CSI sum is always short by the tax (plus anything
 * uncoded). "Uncoded / tax" absorbs the difference, which is what keeps the
 * grouped view's total equal to the ungrouped one.
 */

export interface Csi {
  code: string;
  name: string;
  amount: number;
}
export interface BillRef {
  id: string;
  label: string;
  cost: number;
  invoiced: boolean;
  status?: string;
  csi?: Csi[];
}
export interface TimeEntryRef {
  id: string;
  employee: string;
  hours: number;
  rate: number;
  cost: number;
  code?: string;
  codeName?: string;
}
export interface Line {
  key: string;
  label: string;
  cost: number;
  billIds: string[];
  isSunset: boolean;
  bills?: BillRef[];
  timeEntries?: TimeEntryRef[];
}
/** The full per-job breakdown (GET /api/stage?jobId=) — what a card's dropdown shows. */
export interface Detail {
  customer: { id: string; name: string } | null;
  job?: { id: string; name: string };
  lines: Line[];
  total: number;
}

export const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const hoursAtRate = (t: TimeEntryRef) =>
  `${t.hours.toFixed(2)} hrs @ ${money(t.rate)}/hr`;

/**
 * CSI cost-code label: "01 31 10 · Project Management". Collapses to a single
 * value when the code number and name are identical (e.g. "Office Admin").
 */
export const csiLabel = (code?: string, name?: string) =>
  name && code && name !== code ? `${code} · ${name}` : name || code || "";

/**
 * Drive the adjacent JobTread window (desktop side-panel host) to a document, so
 * clicking a bill opens both the assistant's bill view and the JobTread page.
 * No-op when unframed (mobile / standalone).
 */
export function driveMainWindowToDoc(jobId: string, docId: string) {
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

/**
 * Roll a job's bills + time up into one row per CSI cost code (code asc). A
 * residual bucket absorbs document tax (rides outside line costs) plus any
 * uncoded amount so the CSI-grouped total always equals the panel total.
 */
export function groupCsi(lines: Line[], total: number): Csi[] {
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
}

/**
 * Build the self-contained billing-summary document printed for one job. Opened
 * in a NEW top-level tab (window.print() is blocked inside the JobTread side
 * panel's iframe), then that tab prints itself.
 */
export function printJob(detail: Detail, monthLabel: string, groupByCsi: boolean) {
  const esc = (s: string) =>
    String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const logoUrl = typeof window !== "undefined" ? `${window.location.origin}/icon-512.png` : "";
  const { customer, job, lines, total } = detail;

  const csiSubs = (csi?: Csi[]) =>
    (csi ?? [])
      .map(
        (c) =>
          `<tr class="sub2"><td>${esc(csiLabel(c.code, c.name))}</td><td class="num">${money(c.amount)}</td></tr>`,
      )
      .join("");

  const rowsHtml = groupByCsi
    ? groupCsi(lines, total)
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
<title>${esc(
    // The browser's "Save as PDF" names the file after the tab title, so this
    // IS the saved filename: "Customer - Job" (either half alone if the other
    // is missing, month label as the last resort).
    [customer?.name, job?.name].filter(Boolean).join(" - ") || monthLabel,
  )}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #000; margin: 0.6in; }
  .head { display: flex; align-items: center; gap: 12px; }
  .logo { width: 48px; height: 48px; border-radius: 8px; flex: none; }
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
  <div class="head">
    ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="Ascent Building Co." />` : ""}
    <div>
      <div class="brand">Ascent Building Co.</div>
      <div class="doc-title">Billing Summary — ${esc(monthLabel)}</div>
    </div>
  </div>
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
}

/**
 * The per-job breakdown table. `from` is the back-context stamped on each bill
 * link so the bill page's back arrow returns to whichever surface opened it.
 */
export function Breakdown({
  detail,
  groupByCsi,
  from = "stage",
}: {
  detail: Detail;
  groupByCsi: boolean;
  from?: string;
}) {
  const jobId = detail.job?.id ?? "";
  const csiGrouped = useMemo(
    () => (groupByCsi ? groupCsi(detail.lines, detail.total) : null),
    [detail, groupByCsi],
  );

  const jt = (id: string) => `https://app.jobtread.com/jobs/${jobId}/documents/${id}`;

  // A bill's label → assistant bill view (+ drive JT window), then an explicit
  // JT ↗ link. Bills already on a customer invoice get an "invoiced" tag.
  const billLinks = (id: string, text: string, invoiced?: boolean, status?: string) => (
    <>
      <Link
        href={`/bill/${id}?jobId=${encodeURIComponent(jobId)}&from=${encodeURIComponent(from)}`}
        onClick={() => driveMainWindowToDoc(jobId, id)}
        className="text-accent hover:underline dark:text-accent-soft"
      >
        {text}
      </Link>
      <BillStatusBadge status={status} className="ml-2" />
      {invoiced && (
        <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
          invoiced
        </span>
      )}
      <JtLink href={jt(id)} className="ml-2 text-xs text-neutral-400 hover:text-accent">
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

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white dark:bg-ink-raised">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-white/5">
          <tr>
            <th className="px-3 py-2 font-medium">{groupByCsi ? "CSI Code" : "Bill"}</th>
            <th className="px-3 py-2 text-right font-medium">{groupByCsi ? "Amount" : "Cost"}</th>
          </tr>
        </thead>
        <tbody>
          {groupByCsi
            ? (csiGrouped ?? []).map((c) => (
                <tr key={c.code || "residual"} className="border-t border-line-soft">
                  <td className="px-3 py-2">{csiLabel(c.code, c.name)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(c.amount)}</td>
                </tr>
              ))
            : detail.lines.map((l) => {
                // Sunset: keep the grouped total, then itemize each bill below.
                if (l.isSunset && l.bills && l.bills.length) {
                  return (
                    <Fragment key={l.key}>
                      <tr className="border-t border-line-soft">
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

                // Single vendor bill → link the line to its assistant view, then
                // itemize its CSI cost codes beneath it.
                if (l.bills && l.bills.length === 1) {
                  return (
                    <Fragment key={l.key}>
                      <tr className="border-t border-line-soft">
                        <td className="px-3 py-2">
                          {billLinks(l.bills[0].id, l.label, l.bills[0].invoiced, l.bills[0].status)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{money(l.cost)}</td>
                      </tr>
                      {csiRows(l.bills[0].csi, l.bills[0].id, "pl-9")}
                    </Fragment>
                  );
                }

                // Time & labor — itemize each entry (employee + CSI code, with
                // hours/rate detail and the entry's own amount).
                if (l.timeEntries && l.timeEntries.length) {
                  return (
                    <Fragment key={l.key}>
                      <tr className="border-t border-line-soft">
                        <td className="px-3 py-2 font-medium">{l.label}</td>
                        <td className="px-3 py-2 text-right font-mono">{money(l.cost)}</td>
                      </tr>
                      {l.timeEntries.map((t) => (
                        <tr
                          key={t.id}
                          className="border-t border-neutral-50 dark:border-neutral-900/60"
                        >
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
                  <tr key={l.key} className="border-t border-line-soft">
                    <td className="px-3 py-2">{l.label}</td>
                    <td className="px-3 py-2 text-right font-mono">{money(l.cost)}</td>
                  </tr>
                );
              })}
          <tr className="border-t border-line font-semibold dark:border-neutral-700">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right font-mono">{money(detail.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
