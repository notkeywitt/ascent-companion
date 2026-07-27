"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { JtLink } from "@/components/JtLink";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import {
  Banner,
  Button,
  CardSkeletonList,
  EmptyState,
  Label,
  PageHeader,
  Spinner,
  Toggle,
  btn,
  inputCls,
} from "@/components/ui";

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
// The full per-job breakdown (GET /api/stage?jobId=) — what a card's dropdown shows.
interface Detail {
  customer: { id: string; name: string } | null;
  job?: { id: string; name: string };
  lines: Line[];
  total: number;
}
// One roster row (GET /api/stage/jobs) — the collapsed card, before detail loads.
interface JobRow {
  jobId: string;
  jobName: string;
  customerName: string;
  billTotal: number;
  billCount: number;
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const hoursAtRate = (t: TimeEntryRef) => `${t.hours.toFixed(2)} hrs @ ${money(t.rate)}/hr`;

// CSI cost-code label: "01 31 10 · Project Management". Collapses to a single
// value when the code number and name are identical (e.g. "Office Admin").
const csiLabel = (code?: string, name?: string) =>
  name && code && name !== code ? `${code} · ${name}` : name || code || "";

// How many per-job detail fetches run at once during the progressive fill —
// bounded so we don't hammer the JobTread API (each fetch is a few Pave calls).
const CONCURRENCY = 3;

// Drive the adjacent JobTread window (desktop side-panel host) to a document —
// same dual-navigation the Billing tab uses so clicking a bill opens both the
// assistant bill view and the JobTread page. No-op when unframed (mobile).
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

// Roll a job's bills + time up into one row per CSI cost code (code asc). A
// residual bucket absorbs document tax (rides outside line costs) plus any
// uncoded amount so the CSI-grouped total always equals the panel total.
function groupCsi(lines: Line[], total: number): Csi[] {
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

// Build the self-contained billing-summary document printed for one job. Opened
// in a NEW top-level tab (window.print() is blocked inside the JobTread side
// panel's iframe), then that tab prints itself.
function printJob(detail: Detail, monthLabel: string, groupByCsi: boolean) {
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
<title>Billing Summary — ${esc(job?.name ?? monthLabel)}</title>
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

// The per-job breakdown table — exactly what the old single-job Invoicing view
// showed, now rendered inside a card's dropdown.
function Breakdown({ detail, groupByCsi }: { detail: Detail; groupByCsi: boolean }) {
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
        href={`/bill/${id}?jobId=${encodeURIComponent(jobId)}&from=stage`}
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
      <tr key={`${keyPrefix}-${c.code}`} className="border-t border-neutral-50 dark:border-neutral-900/60">
        <td className={`py-1 pr-3 text-xs text-neutral-500 dark:text-neutral-400 ${pad}`}>
          {csiLabel(c.code, c.name)}
        </td>
        <td className="px-3 py-1 text-right font-mono text-xs text-neutral-500 dark:text-neutral-400">
          {money(c.amount)}
        </td>
      </tr>
    ));

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-700/60 dark:bg-ink-raised">
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
                <tr
                  key={c.code || "residual"}
                  className="border-t border-neutral-100 dark:border-neutral-800"
                >
                  <td className="px-3 py-2">{csiLabel(c.code, c.name)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(c.amount)}</td>
                </tr>
              ))
            : detail.lines.map((l) => {
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

                // Single vendor bill → link the line to its assistant view, then
                // itemize its CSI cost codes beneath it.
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

                // Time & labor — itemize each entry (employee + CSI code, with
                // hours/rate detail and the entry's own amount).
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
            <td className="px-3 py-2 text-right font-mono">{money(detail.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Stage() {
  const search = useSearchParams();
  // A job chosen in the global picker just auto-opens that card; the page still
  // lists every job for the month (the requested default all-invoices preview).
  const focusJobId = (search.get("jobId") ?? "").trim();

  const [ym, setYm] = useState(() => {
    const d = new Date();
    // 10th–10th billing window: through the 10th we're still closing out the
    // PREVIOUS month; from the 11th on, the current month. (Jul 10 → June,
    // Jul 11 → July.) Day ≤ 10 is always valid in the prior month, so stepping
    // the month back can't overflow.
    if (d.getDate() <= 10) d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [detailFailed, setDetailFailed] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState("");
  // Filter toggles (defaults reproduce the original behavior).
  const [uninvoicedOnly, setUninvoicedOnly] = useState(true);
  const [includeDrafts, setIncludeDrafts] = useState(true);
  const [groupByCsi, setGroupByCsi] = useState(false);
  const runRef = useRef(0);

  const opt = monthOptions().find((o) => o.ym === ym);
  const monthLabel = opt?.label ?? ym;

  // Fetch one job's full breakdown. `token` ties the result to a load run: a
  // month/toggle change bumps runRef, so a stale (or manually retried) fetch
  // whose token no longer matches drops its result instead of clobbering fresh
  // state. Shared by the progressive fill and the per-card Retry.
  const fetchDetail = useCallback(
    async (r: JobRow, token: number) => {
      setDetailFailed((f) => (f[r.jobId] ? { ...f, [r.jobId]: false } : f));
      try {
        const [y, m] = ym.split("-").map(Number);
        const params = new URLSearchParams({ jobId: r.jobId, year: String(y), month: String(m) });
        if (!uninvoicedOnly) params.set("includeInvoiced", "1");
        if (includeDrafts) params.set("includeDrafts", "1");
        const res = await fetch(`/api/stage?${params.toString()}`);
        const j = await res.json();
        if (token !== runRef.current) return;
        if (res.ok) {
          setDetails((d) => ({
            ...d,
            [r.jobId]: {
              customer: j.customer ?? null,
              job: j.job,
              lines: j.lines ?? [],
              total: j.total ?? 0,
            },
          }));
        } else {
          setDetailFailed((f) => ({ ...f, [r.jobId]: true }));
        }
      } catch {
        if (token === runRef.current) setDetailFailed((f) => ({ ...f, [r.jobId]: true }));
      }
    },
    [ym, uninvoicedOnly, includeDrafts],
  );

  // Progressively fetch every job's breakdown (bounded concurrency). Each card's
  // total is shown only once its detail lands, so the displayed figure is always
  // the authoritative total (bills + uninvoiced time) — never a provisional one.
  const fillDetails = useCallback(
    async (jobRows: JobRow[], token: number) => {
      setFilling(true);
      for (let i = 0; i < jobRows.length; i += CONCURRENCY) {
        if (token !== runRef.current) return;
        await Promise.all(jobRows.slice(i, i + CONCURRENCY).map((r) => fetchDetail(r, token)));
      }
      if (token === runRef.current) setFilling(false);
    },
    [fetchDetail],
  );

  const load = useCallback(async () => {
    const token = ++runRef.current;
    setLoading(true);
    setError("");
    setRows(null);
    setDetails({});
    setDetailFailed({});
    setFilling(false);
    try {
      const [y, m] = ym.split("-").map(Number);
      const params = new URLSearchParams({ year: String(y), month: String(m) });
      if (!uninvoicedOnly) params.set("includeInvoiced", "1");
      if (includeDrafts) params.set("includeDrafts", "1");
      const res = await fetch(`/api/stage/jobs?${params.toString()}`);
      const j = await res.json();
      if (token !== runRef.current) return;
      if (!res.ok) {
        setError(j.error ?? "Failed");
        setRows([]);
        return;
      }
      const jobRows: JobRow[] = j.jobs ?? [];
      setRows(jobRows);
      if (jobRows.length) fillDetails(jobRows, token);
    } catch (e) {
      if (token === runRef.current) setError(e instanceof Error ? e.message : "Network error");
    } finally {
      if (token === runRef.current) setLoading(false);
    }
  }, [ym, uninvoicedOnly, includeDrafts, fillDetails]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-open the globally-picked job's card once it's in the roster.
  useEffect(() => {
    if (focusJobId && rows?.some((r) => r.jobId === focusJobId)) {
      setOpenId((o) => (o[focusJobId] ? o : { ...o, [focusJobId]: true }));
    }
  }, [focusJobId, rows]);

  // Grand total = sum of the authoritative per-job totals. Only shown once every
  // card's detail is loaded (while filling, a spinner stands in), so it never
  // displays a partial sum.
  const grandTotal = useMemo(
    () => (rows ?? []).reduce((s, r) => s + (details[r.jobId]?.total ?? 0), 0),
    [rows, details],
  );

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Invoicing"
        description="Every client invoice to stage this month — one card per job. Open a card to see the bills, cost-code breakdown, and time behind its total, then create the invoice in JobTread."
        className="!mb-4"
      />

      <div className="mb-3">
        <Label>Billing month</Label>
        <select value={ym} onChange={(e) => setYm(e.target.value)} className={inputCls}>
          {monthOptions().map((o) => (
            <option key={o.ym} value={o.ym}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-3">
        <Toggle checked={uninvoicedOnly} onChange={setUninvoicedOnly} label="Uninvoiced only" />
        <Toggle checked={includeDrafts} onChange={setIncludeDrafts} label="Include draft bills" />
        <Toggle checked={groupByCsi} onChange={setGroupByCsi} label="Group by CSI code" />
      </div>

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {!loading && rows && rows.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-neutral-500">
            {rows.length} invoice{rows.length === 1 ? "" : "s"} · {monthLabel}
          </span>
          <span className="flex items-center gap-2 font-semibold tabular-nums">
            {filling ? (
              <>
                <Spinner /> Totaling…
              </>
            ) : (
              money(grandTotal)
            )}
          </span>
        </div>
      )}

      {loading && <CardSkeletonList rows={3} />}

      {!loading && rows && rows.length === 0 && !error && (
        <EmptyState>
          No client invoices to stage for {monthLabel} — every finalized bill is already invoiced.
        </EmptyState>
      )}

      <ul className="space-y-2">
        {(rows ?? []).map((r) => {
          const detail = details[r.jobId];
          const failed = !!detailFailed[r.jobId];
          const open = !!openId[r.jobId];
          const customerName = detail?.customer?.name ?? r.customerName;
          const lastDay = opt?.lastDay ?? "";
          return (
            <li
              key={r.jobId}
              className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700/60 dark:bg-ink-raised"
            >
              <button
                type="button"
                onClick={() => setOpenId((o) => ({ ...o, [r.jobId]: !o[r.jobId] }))}
                aria-expanded={open}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  {/* Title = customer, subtitle = job (falls back to job as the
                      title when a card has no customer). */}
                  <div className="truncate font-semibold">{customerName || r.jobName || r.jobId}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
                    <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
                    {customerName && r.jobName && <span className="truncate">{r.jobName}</span>}
                    {customerName && r.jobName && (
                      <span className="text-neutral-300 dark:text-neutral-600">·</span>
                    )}
                    <span className="whitespace-nowrap">
                      {r.billCount} bill{r.billCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {/* Total appears only once the authoritative detail lands, so it
                      always equals the old per-job view exactly (never a bills-only
                      placeholder). */}
                  <div className="flex h-7 items-center justify-end text-lg font-bold tabular-nums">
                    {detail ? money(detail.total) : failed ? "—" : <Spinner />}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-400">
                    to invoice
                  </div>
                </div>
              </button>

              {open && (
                <div className="mt-3">
                  {failed ? (
                    <Banner tone="warning" className="!py-2 text-xs">
                      Couldn&apos;t load this job&apos;s breakdown.{" "}
                      <button
                        className="font-semibold underline"
                        onClick={() => fetchDetail(r, runRef.current)}
                      >
                        Retry
                      </button>
                    </Banner>
                  ) : !detail ? (
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <Spinner /> Loading breakdown…
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 flex justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => printJob(detail, monthLabel, groupByCsi)}
                        >
                          Print / Save PDF
                        </Button>
                      </div>
                      <Breakdown detail={detail} groupByCsi={groupByCsi} />
                      <JtLink
                        href={`https://app.jobtread.com/jobs/${r.jobId}/documents`}
                        className={btn("primary", "md", "mt-3 w-full")}
                      >
                        Create invoice in JobTread ↗
                      </JtLink>
                      <p className="mt-2 text-xs text-neutral-500">
                        Open this job in JobTread, then <b>New → Customer Invoice</b> — its builder
                        pulls exactly these uninvoiced bills (and any uninvoiced time). Date it{" "}
                        {lastDay}, review &amp; send.
                      </p>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
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
