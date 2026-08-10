"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { CopyButton } from "@/components/CopyButton";
import { JtLink } from "@/components/JtLink";
import { SunsetDuplicateScan } from "@/components/SunsetDuplicateScan";
import { Banner, Button, CardSkeletonList, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { clearTouchedBills, touchedBillCount } from "@/lib/billTouch";

const TSYS_URL = "https://hostedpaynow.com/hostedapp/tsys/paymentOptions";
const FILTERS = ["unpaid", "paid", "all"] as const;
type Filter = (typeof FILTERS)[number];
const EXTRACT_BATCH = 4; // statements Gemini-read per request (bounded so it never times out)

interface Statement {
  expId: string;
  project: string;
  statementDate: string;
  pdfUrl: string;
  accountName: string;
  statementNumber: string;
  total: string;
  discount: string;
  net: string;
  extractedAt: string;
  status: string;
  paidAt: string;
}

interface Invoice {
  number: string;
  amount: number;
  isCredit: boolean;
  date: string;
  docId: string;
  jobId: string;
}

const jtDocUrl = (inv: Invoice) =>
  inv.docId && inv.jobId
    ? `https://app.jobtread.com/jobs/${encodeURIComponent(inv.jobId)}/documents/${encodeURIComponent(inv.docId)}`
    : "";
// In-app Bill Details for a reconciled invoice. `from=payments` tells that page
// to send Back here instead of to the coding queue. Every invoice number below
// links here; the small JT chip beside it opens the same bill in JobTread.
const billHref = (inv: { docId?: string; jobId?: string }) =>
  inv.docId && inv.jobId
    ? `/bill/${encodeURIComponent(inv.docId)}?jobId=${encodeURIComponent(inv.jobId)}&from=payments`
    : "";
const jtChip =
  "shrink-0 rounded bg-current/10 px-1 text-[10px] font-semibold uppercase tracking-wide opacity-70 transition hover:opacity-100";
interface MatchInvoice {
  number: string;
  statementAmount?: number;
  systemAmount?: number;
  isCredit?: boolean;
  date: string;
  docId: string;
  jobId: string;
  elsewhere?: boolean;
  fuzzy?: boolean;
  // Office flagged this bill "Bought Back" in the Reconcile Overrides tab: line
  // items were recoded to the shop after Sunset already billed the job, so the
  // statement/system amounts are expected to differ. boughtBackAmount = statement − system.
  boughtBack?: boolean;
  boughtBackAmount?: number;
}
interface MatchBlock {
  matched: MatchInvoice[];
  mismatched: MatchInvoice[];
  missing: MatchInvoice[];
  extra: MatchInvoice[];
  extraCredits: MatchInvoice[];
}
interface Reconciliation {
  projectId: string;
  month: string;
  year: string;
  invoiceCount: number;
  chargeTotal: number;
  creditCount: number;
  creditTotal: number;
  netTotal: number;
  invoices: Invoice[];
  hasLineItems?: boolean;
  statementLineCount?: number;
  statementTotal?: number;
  match?: MatchBlock | null;
  // Σ (statement − system) over bought-back-tagged matches — netTotal is expectedly
  // short by this much, so it's added back before comparing to the statement total.
  boughtBackTotal?: number;
}

const jtMatchUrl = (m: MatchInvoice) =>
  m.docId && m.jobId
    ? `https://app.jobtread.com/jobs/${encodeURIComponent(m.jobId)}/documents/${encodeURIComponent(m.docId)}`
    : "";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The statement's BILLING PERIOD, as "July 2026", for the card name.
// Preferred source is the reconcile payload's month/year — read straight from the
// statement row's Billing Month / Billing Year columns. Until that second fetch
// lands (or if it fails) we derive it from statementDate, which is exact rather
// than approximate: handleStatement writes Date Purchased AND Billing Month/Year
// from the same statement date, so their month/year always agree. Returns "" when
// neither is usable, and the name then renders as it did before.
function billingLabel(statementDate: string, month?: string, year?: string): string {
  const m = Number(month);
  const y = Number(year);
  if (Number.isInteger(m) && m >= 1 && m <= 12 && y > 0) return `${MONTHS[m - 1]} ${y}`;
  // statementDate is "YYYY-MM-DD" or the "YYYY-MM" fallback form.
  const hit = /^(\d{4})-(\d{2})/.exec(statementDate ?? "");
  if (!hit) return "";
  const dm = Number(hit[2]);
  if (dm < 1 || dm > 12) return "";
  return `${MONTHS[dm - 1]} ${hit[1]}`;
}

const money = (s: string) => {
  const n = Number(s);
  return s !== "" && Number.isFinite(n)
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
};

const moneyN = (n: number) =>
  Number.isFinite(n)
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

// ---------------------------------------------------------------------------
// PAGE SNAPSHOT
// Both of this page's loads are expensive, and the reconcile especially so: Apps
// Script re-reads the whole Expenditure sheet and pages every JobTread vendorBill
// since the cutoff (~10-20s). Clicking an invoice to fix its bill and coming back
// used to pay all of that again behind skeletons — which is what made working a
// statement feel slow, since one statement means several trips into bills.
//
// So the last payloads live here at module scope: they survive navigation inside
// the app (not a reload), render on the FIRST paint of a return visit, and are
// re-fetched only in the BACKGROUND — when a bill was written through the
// assistant (markBillTouched, set by the bill page's cache invalidation) or when
// the snapshot has gone cold. The expanded cards and scroll offset ride along, so
// you land where you left off instead of at the top of a collapsed list.
// ---------------------------------------------------------------------------
const SNAP_COLD_MS = 2 * 60_000; // older than this → refresh behind the scenes
const SNAP_MAX_MS = 30 * 60_000; // older than this → don't show it, load fresh
let snapList: { at: number; filter: Filter; items: Statement[] } | null = null;
let snapRecon: { at: number; recon: Record<string, Reconciliation>; live: boolean } | null = null;
const openCards = new Set<string>(); // expIds whose invoice list is expanded
let snapScrollY = 0;
let snapFilter: Filter = "unpaid"; // the tab you were on, so a return doesn't reset it

const validSnapList = (f: Filter) =>
  snapList && snapList.filter === f && Date.now() - snapList.at < SNAP_MAX_MS ? snapList : null;
const validSnapRecon = () =>
  snapRecon && Date.now() - snapRecon.at < SNAP_MAX_MS ? snapRecon : null;

export default function PaymentsPage() {
  const [filter, setFilter] = useState<Filter>(snapFilter);
  // First render only: what the snapshot can put on screen immediately. Reading it
  // in the state initializers (rather than an effect) is the point — an effect
  // would paint one frame of skeletons before the cached rows appeared.
  const [restored] = useState(() => ({ list: validSnapList(snapFilter), recon: validSnapRecon() }));
  const [items, setItems] = useState<Statement[]>(restored.list ? restored.list.items : []);
  const [loading, setLoading] = useState(!restored.list);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [filling, setFilling] = useState(false);
  const [recon, setRecon] = useState<Record<string, Reconciliation>>(
    restored.recon ? restored.recon.recon : {},
  );
  const [reconLoading, setReconLoading] = useState(!restored.recon);
  const [reconLive, setReconLive] = useState(restored.recon ? restored.recon.live : true);
  // How many background re-fetches are in flight (a counter, not a flag — the
  // list and the reconcile refresh independently).
  const [refreshing, setRefreshing] = useState(0);
  const [openIds, setOpenIds] = useState<string[]>(() => Array.from(openCards));
  const runRef = useRef(0);
  const reconRunRef = useRef(0);

  /** Remember which cards are expanded, so a trip into a bill doesn't collapse them. */
  function toggleCard(expId: string, isOpen: boolean) {
    if (isOpen) openCards.add(expId);
    else openCards.delete(expId);
    setOpenIds(Array.from(openCards));
  }

  // Progressively Gemini-extract the uncached statements in small batches so no
  // single request ever runs unbounded work. `token` guards against a filter
  // change superseding an in-flight fill.
  const fill = useCallback(async (ids: string[], token: number) => {
    setFilling(true);
    for (let i = 0; i < ids.length; i += EXTRACT_BATCH) {
      if (token !== runRef.current) return;
      const chunk = ids.slice(i, i + EXTRACT_BATCH);
      try {
        const res = await fetch("/api/sunset-statements/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expIds: chunk }),
        });
        const json = await res.json();
        if (token !== runRef.current) return;
        if (res.ok && json.ok !== false) {
          const ex: Record<string, Statement> = json.extracted ?? {};
          const fail: string[] = json.failed ?? [];
          if (Object.keys(ex).length) {
            setItems((rows) => rows.map((r) => (ex[r.expId] ? { ...r, ...ex[r.expId] } : r)));
          }
          if (fail.length) setFailed((f) => ({ ...f, ...Object.fromEntries(fail.map((id) => [id, true])) }));
        } else {
          setFailed((f) => ({ ...f, ...Object.fromEntries(chunk.map((id) => [id, true])) }));
        }
      } catch {
        if (token !== runRef.current) return;
        setFailed((f) => ({ ...f, ...Object.fromEntries(chunk.map((id) => [id, true])) }));
      }
    }
    if (token === runRef.current) setFilling(false);
  }, []);

  // `background` = a snapshot is already on screen: keep it there, no skeletons,
  // no error banner if the refresh fails (what's showing is still usable).
  const load = useCallback(
    async (f: Filter, background: boolean) => {
      const token = ++runRef.current;
      if (background) setRefreshing((n) => n + 1);
      else {
        setLoading(true);
        setError("");
        setFilling(false);
        setFailed({});
      }
      try {
        const res = await fetch(`/api/sunset-statements?status=${f}`);
        const json = await res.json();
        if (token !== runRef.current) return;
        if (!res.ok || json.ok === false) {
          if (!background) setError(json.error ?? "Request failed");
          return;
        }
        const list: Statement[] = json.items ?? [];
        setItems(list);
        snapList = { at: Date.now(), filter: f, items: list };
        const uncached = list.filter((s) => !s.extractedAt).map((s) => s.expId);
        if (uncached.length) fill(uncached, token);
      } catch (e) {
        if (token === runRef.current && !background) {
          setError(e instanceof Error ? e.message : "Network error");
        }
      } finally {
        if (background) setRefreshing((n) => n - 1);
        else if (token === runRef.current) setLoading(false);
      }
    },
    [fill],
  );

  // Invoice-vs-statement reconciliation is keyed by ExpID and independent of the
  // paid/unpaid filter, so it's fetched separately from the list. It nets the
  // Sunset invoices the system holds for each statement's project + billing month
  // against the statement, so the card can show whether every invoice on it is
  // accounted for. This is the slow call — hence the snapshot.
  const loadRecon = useCallback(async (background: boolean) => {
    const token = ++reconRunRef.current;
    if (background) setRefreshing((n) => n + 1);
    else setReconLoading(true);
    try {
      const res = await fetch("/api/sunset-statements/reconcile");
      const json = await res.json();
      if (token !== reconRunRef.current) return;
      if (res.ok && json.ok !== false) {
        const next = (json.reconciliation as Record<string, Reconciliation>) ?? {};
        const live = json.liveChecked !== false;
        setRecon(next);
        setReconLive(live);
        snapRecon = { at: Date.now(), recon: next, live };
        // This pull saw every bill written since the last one, so the staleness
        // signal is spent — the next return visit needn't refresh for them.
        clearTouchedBills();
      }
    } catch {
      /* non-fatal enhancement — keep whatever is already on screen */
    } finally {
      if (background) setRefreshing((n) => n - 1);
      else if (token === reconRunRef.current) setReconLoading(false);
    }
  }, []);

  /** Force both reads now (the Refresh button), without blanking the page. */
  function refreshNow() {
    load(filter, true);
    loadRecon(true);
  }

  // The statements list: from the snapshot when one matches this filter, else a
  // real load. A snapshot is revalidated only when a bill was written or it has
  // gone cold — so bill → back → bill costs nothing.
  useEffect(() => {
    const snap = validSnapList(filter);
    if (!snap) {
      load(filter, false);
      return;
    }
    setItems(snap.items);
    setLoading(false);
    if (touchedBillCount() > 0 || Date.now() - snap.at > SNAP_COLD_MS) load(filter, true);
  }, [filter, load]);

  // Same policy for the reconcile (which ignores the filter, so it's mount-only).
  useEffect(() => {
    const snap = validSnapRecon();
    if (snap) {
      setRecon(snap.recon);
      setReconLive(snap.live);
      setReconLoading(false);
    }
    if (!snap || touchedBillCount() > 0 || Date.now() - snap.at > SNAP_COLD_MS) loadRecon(!!snap);
  }, [loadRecon]);

  // Keep the snapshot in step with what is actually on screen — the Gemini header
  // values fill in after the list arrives, and Mark paid moves a row — so a return
  // visit renders the page as you left it, not as it first loaded. The freshness
  // stamp stays the LAST FETCH's, since none of this is new data from the server.
  useEffect(() => {
    if (loading) return;
    const at = snapList && snapList.filter === filter ? snapList.at : Date.now();
    snapList = { at, filter, items };
  }, [items, filter, loading]);

  // Land back where you were reading — but only when the snapshot supplied BOTH
  // payloads, since then every card renders at its final height on the first
  // paint and the saved offset still points at the same statement.
  useEffect(() => {
    if (restored.list && restored.recon && snapScrollY > 0) window.scrollTo(0, snapScrollY);
  }, [restored]);

  useEffect(() => {
    const onScroll = () => {
      snapScrollY = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function setPaid(expId: string, status: "paid" | "unpaid") {
    setBusy((b) => ({ ...b, [expId]: true }));
    try {
      const res = await fetch(`/api/sunset-statements/${encodeURIComponent(expId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Could not update");
        return;
      }
      const next =
        filter === "all"
          ? items.map((r) => (r.expId === expId ? { ...r, ...json.statement } : r))
          : items.filter((r) => r.expId !== expId);
      setItems(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy((b) => ({ ...b, [expId]: false }));
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Sunset Statements"
        description="Pay each statement at TSYS — copy the fields, pay, mark it done. Each card reconciles the statement total against the Sunset invoices logged for that project & month."
        className="!mb-4"
      />

      <SunsetDuplicateScan />

      <div className="mb-4 flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => {
              snapFilter = f;
              setFilter(f);
            }}
            className={
              "rounded-full px-3 py-1 text-xs font-semibold capitalize transition " +
              (filter === f
                ? "bg-accent/10 text-accent dark:text-accent-soft"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10")
            }
          >
            {f}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          {(filling || refreshing > 0) && (
            <span className="flex items-center gap-1.5 text-xs text-neutral-500">
              <Spinner /> {filling ? "Reading statements…" : "Refreshing…"}
            </span>
          )}
          <button
            onClick={refreshNow}
            disabled={refreshing > 0}
            title="Re-read the statements and re-run the reconcile"
            className="rounded-full px-2.5 py-1 text-xs font-semibold text-neutral-500 transition hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-white/10"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading && <CardSkeletonList rows={3} />}

      {!loading && items.length === 0 && (
        <EmptyState>
          {filter === "unpaid"
            ? "Nothing to pay — every Sunset statement is marked paid. 🎉"
            : "No statements here."}
        </EmptyState>
      )}

      {!reconLoading && !reconLive && (
        <div className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          Couldn&apos;t reach JobTread to verify — showing the hourly sheet mirror, so a just-deleted or voided bill may still appear.
        </div>
      )}

      <ul className="space-y-2">
        {items.map((s) => {
          const done = !!s.extractedAt;
          const fail = !!failed[s.expId];
          const rc = recon[s.expId];
          const billing = billingLabel(s.statementDate, rc?.month, rc?.year);
          // Net-to-paid: reconcile (invoices − credits) against the statement's NET
          // (gross − early-pay discount) — the amount actually paid — once the
          // discount has been read. Until then, fall back to the gross total.
          const netKnown = !!s.extractedAt && s.net !== "" && Number.isFinite(Number(s.net));
          const hasRows = !!rc && (rc.invoiceCount > 0 || rc.creditCount > 0);
          const m = rc?.match ?? null;
          const useLines = !!rc?.hasLineItems;
          // Comparison basis. When the statement's own invoice list was captured we
          // reconcile invoice-total → invoice-total: the sum of the statement's
          // printed lines (its gross) against the sum of the system's invoices. The
          // early-pay discount is a payment term shown up top, NOT a reconciliation
          // gap — so this basis needs no discount read and the headline number agrees
          // with the itemized detail below. Without a captured list, fall back to
          // net → net (which does need the discount, hence netKnown).
          const cmpTarget = useLines
            ? rc?.statementTotal ?? 0
            : netKnown
              ? Number(s.net)
              : Number(s.total);
          const cmpReady = useLines || netKnown;
          // netTotal is expectedly short by boughtBackTotal on any bill the office
          // flagged "Bought Back" (line items recoded to the shop after Sunset
          // already billed the job) — add it back before comparing to the statement.
          const boughtBackTotal = rc?.boughtBackTotal ?? 0;
          const diff = rc && cmpReady && Number.isFinite(cmpTarget)
            ? Math.round((cmpTarget - rc.netTotal - boughtBackTotal) * 100) / 100
            : null;
          // Invoice-number discrepancies: an invoice on the statement but missing
          // from the system, a $ mismatch, or a system charge the statement doesn't
          // list. These fail reconciliation even when the totals happen to match
          // (a missing invoice masked by an offsetting extra one).
          const matchIssues = m ? m.missing.length + m.mismatched.length + m.extra.length : 0;
          const totalMatches = hasRows && cmpReady && diff !== null && Math.abs(diff) <= 0.01;
          const reconciled = totalMatches && matchIssues === 0;
          return (
            <li
              key={s.expId}
              className="rounded-xl border border-line bg-white p-3 dark:bg-ink-raised"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">
                    {s.accountName || s.project || s.expId}
                    {billing && (
                      <span className="font-normal text-neutral-500 dark:text-neutral-400">
                        {" · "}
                        {billing}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {s.statementNumber ? `Statement #${s.statementNumber}` : "Statement #—"}
                    {s.statementDate ? ` · ${s.statementDate}` : ""}
                    {s.project && s.accountName ? ` · ${s.project}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold tabular-nums">{money(s.net)}</div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-400">net to pay</div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-600 tabular-nums dark:text-neutral-400">
                <span>Total {money(s.total)}</span>
                <span>Discount {s.discount ? "−" + money(s.discount) : "—"}</span>
              </div>

              {/* Reconciliation: net the Sunset invoices (minus credits) logged for this project & month against the statement's net */}
              {reconLoading && !rc ? (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                  <Spinner /> Matching invoices…
                </div>
              ) : rc && !hasRows ? (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  No logged Sunset invoices for this project &amp; month
                </div>
              ) : rc ? (
                <div
                  className={
                    "mt-2 rounded-lg border px-2.5 py-2 text-xs " +
                    (reconciled
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : cmpReady
                        ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                        : "border-line bg-neutral-50 text-neutral-600  dark:bg-white/5 dark:text-neutral-300")
                  }
                >
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    <span>
                      {reconciled
                        ? `✓ Reconciled · ${rc.invoiceCount} invoice${rc.invoiceCount === 1 ? "" : "s"}${
                            rc.creditCount ? ` − ${rc.creditCount} credit${rc.creditCount === 1 ? "" : "s"}` : ""
                          }`
                        : cmpReady
                          ? totalMatches && matchIssues > 0
                            ? `⚠ Totals match, but ${matchIssues} invoice discrepanc${matchIssues === 1 ? "y" : "ies"}`
                            : `⚠ Off by ${moneyN(Math.abs(diff ?? 0))}`
                          : `${rc.invoiceCount} invoice${rc.invoiceCount === 1 ? "" : "s"}${
                              rc.creditCount ? ` · ${rc.creditCount} credit${rc.creditCount === 1 ? "" : "s"}` : ""
                            } · reading discount…`}
                    </span>
                    <span className="tabular-nums">
                      {useLines ? "sys " : "net "}{moneyN(rc.netTotal)}
                    </span>
                  </div>

                  {(rc.creditCount > 0 || boughtBackTotal > 0 || (cmpReady && !reconciled)) && (
                    <div className="mt-0.5 tabular-nums opacity-80">
                      {rc.invoiceCount} invoice{rc.invoiceCount === 1 ? "" : "s"} {moneyN(rc.chargeTotal)}
                      {rc.creditCount > 0
                        ? ` − ${rc.creditCount} credit${rc.creditCount === 1 ? "" : "s"} ${moneyN(rc.creditTotal)}`
                        : ""}
                      {` = ${moneyN(rc.netTotal)}`}
                      {boughtBackTotal > 0 ? ` + ${moneyN(boughtBackTotal)} bought back` : ""}
                      {cmpReady
                        ? useLines
                          ? ` vs statement total ${moneyN(cmpTarget)}`
                          : ` vs statement net ${moneyN(cmpTarget)}`
                        : ""}
                    </div>
                  )}

                  {/* Invoice-number reconciliation: name each discrepancy, don't just measure it. */}
                  {m && (m.missing.length > 0 || m.mismatched.length > 0 || m.extra.length > 0) ? (
                    <div className="mt-2 space-y-1.5 border-t border-current/20 pt-1.5">
                      {m.missing.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold">
                            ❗ On statement, not in system ({m.missing.length})
                          </div>
                          <ul className="mt-0.5 space-y-0.5 text-[11px]">
                            {m.missing.map((x, i) => (
                              <li key={"mi" + i} className="flex justify-between gap-3 tabular-nums">
                                <span className="min-w-0 truncate">
                                  <span className="font-medium">#{x.number || "—"}</span>
                                  {x.date ? <span className="opacity-60"> · {x.date}</span> : null}
                                </span>
                                <span>{moneyN(x.statementAmount ?? 0)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {m.mismatched.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold">
                            ⚠ Amount differs ({m.mismatched.length})
                          </div>
                          <ul className="mt-0.5 space-y-0.5 text-[11px]">
                            {m.mismatched.map((x, i) => {
                              const url = jtMatchUrl(x);
                              const detail = billHref(x);
                              return (
                                <li key={"mm" + i} className="flex justify-between gap-3 tabular-nums">
                                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                                    {detail ? (
                                      <Link href={detail} className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current">
                                        #{x.number || "—"}
                                      </Link>
                                    ) : (
                                      <span className="font-medium">#{x.number || "—"}</span>
                                    )}
                                    {url && (
                                      <JtLink href={url} className={jtChip}>
                                        JT ↗
                                      </JtLink>
                                    )}
                                  </span>
                                  <span>stmt {moneyN(x.statementAmount ?? 0)} · sys {moneyN(x.systemAmount ?? 0)}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      {m.extra.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold">
                            ➕ In system, not on statement ({m.extra.length})
                          </div>
                          <ul className="mt-0.5 space-y-0.5 text-[11px]">
                            {m.extra.map((x, i) => {
                              const url = jtMatchUrl(x);
                              const detail = billHref(x);
                              return (
                                <li key={"ex" + i} className="flex justify-between gap-3 tabular-nums">
                                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                                    {detail ? (
                                      <Link href={detail} className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current">
                                        #{x.number || "—"}
                                      </Link>
                                    ) : (
                                      <span className="font-medium">#{x.number || "—"}</span>
                                    )}
                                    {url && (
                                      <JtLink href={url} className={jtChip}>
                                        JT ↗
                                      </JtLink>
                                    )}
                                    {x.date ? <span className="opacity-60"> · {x.date}</span> : null}
                                  </span>
                                  <span>{moneyN(x.systemAmount ?? 0)}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      {m.matched.some((x) => x.elsewhere) && (
                        <div className="text-[10px] opacity-70">
                          Some matches are filed under a different month/project than this statement.
                        </div>
                      )}
                      {m.matched.some((x) => x.boughtBack) && (
                        <div className="text-[10px] opacity-70">
                          ↩ {m.matched.filter((x) => x.boughtBack).length} bought back to the shop — statement amount
                          expected to run higher than the system amount.
                        </div>
                      )}
                    </div>
                  ) : m && rc.hasLineItems ? (
                    <div className="mt-1.5 text-[11px] opacity-70">
                      ✓ All {m.matched.length} statement invoice{m.matched.length === 1 ? "" : "s"} matched by number
                      {m.matched.some((x) => x.boughtBack) &&
                        ` (${m.matched.filter((x) => x.boughtBack).length} bought back to shop)`}
                    </div>
                  ) : !rc.hasLineItems ? (
                    <div className="mt-1.5 text-[10px] opacity-60">
                      Per-invoice detail unavailable (statement lines weren&apos;t captured) — showing totals only.
                    </div>
                  ) : null}

                  <details
                    className="mt-1.5 group"
                    open={openIds.includes(s.expId)}
                    onToggle={(e) => toggleCard(s.expId, e.currentTarget.open)}
                  >
                    <summary className="cursor-pointer list-none select-none opacity-80 hover:opacity-100">
                      <span className="group-open:hidden">Show {rc.creditCount > 0 ? "invoices & credits" : "invoices"} ▸</span>
                      <span className="hidden group-open:inline">Hide {rc.creditCount > 0 ? "invoices & credits" : "invoices"} ▾</span>
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 border-t border-current/20 pt-1.5">
                      {rc.invoices.map((inv, i) => {
                        const url = jtDocUrl(inv);
                        const detail = billHref(inv);
                        return (
                          <li key={inv.number + "-" + i} className="flex justify-between gap-3 tabular-nums">
                            <span className="flex min-w-0 items-center gap-1.5 truncate">
                              {detail ? (
                                <Link
                                  href={detail}
                                  className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
                                >
                                  #{inv.number || "—"}
                                </Link>
                              ) : (
                                <span className="font-medium">#{inv.number || "—"}</span>
                              )}
                              {url && (
                                <JtLink href={url} className={jtChip}>
                                  JT ↗
                                </JtLink>
                              )}
                              {inv.isCredit && (
                                <span className="rounded bg-rose-500/15 px-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-300">
                                  credit
                                </span>
                              )}
                              {inv.date ? <span className="opacity-60"> · {inv.date}</span> : null}
                            </span>
                            <span className={inv.isCredit ? "text-rose-600 dark:text-rose-400" : ""}>
                              {inv.isCredit ? "−" + moneyN(Math.abs(inv.amount)) : moneyN(inv.amount)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                </div>
              ) : null}

              {!done &&
                (fail ? (
                  <Banner tone="warning" className="mt-2 !py-2 text-xs">
                    Couldn&apos;t read this statement automatically — open the PDF for the numbers.
                  </Banner>
                ) : (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                    <Spinner /> Reading statement…
                  </div>
                ))}

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {s.accountName && <CopyButton value={s.accountName} label="Account" />}
                {s.statementNumber && <CopyButton value={s.statementNumber} label="Stmt #" />}
                {s.net && <CopyButton value={s.net} label="Net" />}
                <JtLink
                  href={TSYS_URL}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
                >
                  Pay at TSYS ↗
                </JtLink>
                {s.pdfUrl && (
                  <a
                    href={s.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 transition hover:border-accent hover:text-accent dark:border-neutral-600 dark:text-neutral-300"
                  >
                    View PDF
                  </a>
                )}
                <div className="ml-auto">
                  {s.status === "paid" ? (
                    <Button variant="secondary" size="sm" disabled={busy[s.expId]} onClick={() => setPaid(s.expId, "unpaid")}>
                      {busy[s.expId] ? "…" : "Undo paid"}
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy[s.expId]} onClick={() => setPaid(s.expId, "paid")}>
                      {busy[s.expId] ? "…" : "Mark paid"}
                    </Button>
                  )}
                </div>
              </div>

              {s.status === "paid" && s.paidAt && (
                <div className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  Paid {new Date(s.paidAt).toLocaleDateString()}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
