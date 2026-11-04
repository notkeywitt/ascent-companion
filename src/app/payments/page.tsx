"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { CopyButton } from "@/components/CopyButton";
import { JtLink } from "@/components/JtLink";
import { SunsetDuplicateScan } from "@/components/SunsetDuplicateScan";
import { SunsetExpenseSwitch } from "@/components/SunsetExpenseSwitch";
import { SunsetLinkPicker, type LinkTarget } from "@/components/SunsetLinkPicker";
import { SunsetStatementBills } from "@/components/SunsetStatementBills";
import { Banner, Button, CardSkeletonList, EmptyState, PageHeader, Spinner } from "@/components/ui";
import { BillPopup } from "@/app/trackingsheet/BillPopup";
import { useIsWide, type Selection } from "@/app/trackingsheet/DraftWorkbench";
import { clearTouchedBills, touchedBillCount } from "@/lib/billTouch";
import { reconcileState } from "@/lib/sunsetReconcile";
import type { SunsetCandidate } from "@/lib/sunsetLinks";
import { money as moneyN } from "@/lib/money";
import { approvalStatusFor, monthKeyLabel, statementMonthKey } from "@/lib/sunsetStatementMonth";

// The TSYS hosted-payment page rejects requests that don't arrive through Sunset's
// own site, so Pay goes to sunsetbuilderssupply.com and you click through from there.
const TSYS_URL = "https://www.sunsetbuilderssupply.com/";
const FILTERS = ["unpaid", "paid", "all"] as const;
type Filter = (typeof FILTERS)[number];
const EXTRACT_BATCH = 4; // statements model-read per request (bounded so it never times out)

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
  /** "JobTread" when the list route marked it paid off its Office-job bill. */
  paidBy?: string;
  /** Its bill on the Office job (Create Bills), or null when it has none. */
  bill?: { docId: string; status: string; name: string; amountPaid: number; balance: number; paidAt: string } | null;
}

/** One statement's Office-job bill, any status — what Approve all counts. */
interface MonthBill {
  expId: string;
  statementDate: string;
  docId: string;
  status: string;
  name: string;
}

const OFFICE_JOB_ID = "22PXevQbM9FQ"; // same as OFFICE_JOB_ID in src/lib/jobtread.ts
const officeBillUrl = (docId: string) =>
  `https://app.jobtread.com/jobs/${OFFICE_JOB_ID}/documents/${encodeURIComponent(docId)}`;
const BILL_STATUS: Record<string, string> = { draft: "Draft", pending: "Approved", approved: "Approved", denied: "Voided" };
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

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
// to send Back here instead of to the coding queue. An invoice number opens the
// bill's coding card in a popup over this page; this is the popup's "Full page"
// link. The small JT chip beside the number opens the same bill in JobTread.
// `canOpen` is the "recode" view that /bill rides: a lead holds this page but
// not that one, and a popup would only fail its reads, so they get plain text.
const billHref = (inv: { docId?: string; jobId?: string }, canOpen: boolean) =>
  canOpen && inv.docId && inv.jobId
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
  // The bill sits on another job or month than the statement (the office moved
  // it, or Sunset rang it up on the wrong account). jobName is where it sits now.
  elsewhere?: boolean;
  jobName?: string;
  // The bill's own number, when it differs from the printed one (a fuzzy or linked match).
  systemNumber?: string;
  fuzzy?: boolean;
  // An office link (the Link button) made this match, not the automatic one.
  linked?: boolean;
  // missing: another statement's line already took the bill with this number.
  // movedOut: the statement that claims this job's bill, and its printed line.
  claimedBy?: string;
  line?: string;
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
  // Bills on this statement's job that ANOTHER statement prints — information,
  // not a discrepancy, so they are left out of this statement's total.
  movedOut?: MatchInvoice[];
}
interface Reconciliation {
  projectId: string;
  projectName?: string;
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
interface MonthBlock {
  invoices: SunsetCandidate[];
  unclaimed: SunsetCandidate[];
}
interface StaleLink {
  statementId: string;
  line: string;
  number: string;
  reason: string;
}
let snapRecon: {
  at: number;
  recon: Record<string, Reconciliation>;
  live: boolean;
  months: Record<string, MonthBlock> | null;
  stale: StaleLink[];
} | null = null;
const openCards = new Set<string>(); // expIds whose invoice list is expanded
let snapScrollY = 0;
let snapFilter: Filter = "unpaid"; // the tab you were on, so a return doesn't reset it
// The month picked ("" = all months; null = not picked yet, so the newest).
let snapMonth: string | null = null;
let snapMonthBills: MonthBill[] = [];

interface BankDetails {
  routing: string;
  account: string;
  label: string;
}

// Ascent's own ACH numbers, for the bank fields on the TSYS form. Kept out of the
// client bundle: they come from server-only env vars via /api/bank-details, which
// middleware gates to admins (the page itself is a lead view), so a non-admin
// simply gets no row. Fetched once per app session and held here rather than in
// state, so returning to the page doesn't re-request them.
let snapBank: BankDetails | null = null;

/** Show only the last 4 until Reveal — the numbers shouldn't sit on a shared screen. */
const maskTail = (v: string) => (v.length > 4 ? "•".repeat(Math.min(v.length - 4, 8)) + v.slice(-4) : v);

function BankRow() {
  const [bank, setBank] = useState<BankDetails | null>(snapBank);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (snapBank) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/bank-details");
        if (!res.ok) return; // 403 (not an admin) or 404 (not configured) — render nothing
        const json = await res.json();
        if (!live || json.ok === false) return;
        snapBank = { routing: json.routing ?? "", account: json.account ?? "", label: json.label ?? "" };
        setBank(snapBank);
      } catch {
        /* non-fatal — the row just doesn't appear */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!bank) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-neutral-50 px-3 py-2 dark:bg-ink-raised">
      <span className="mr-1 text-xs font-semibold text-neutral-500">
        {bank.label || "Ascent bank"}
      </span>
      {bank.routing && <CopyButton value={bank.routing} label="Routing" />}
      {bank.account && <CopyButton value={bank.account} label="Account #" />}
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="rounded-md px-2 py-1 text-xs font-semibold text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-white/10"
      >
        {shown ? "Hide" : "Reveal"}
      </button>
      {shown && (
        <span className="text-xs text-neutral-600 tabular-nums dark:text-neutral-300">
          {bank.routing && <>R {bank.routing}</>}
          {bank.routing && bank.account ? " · " : ""}
          {bank.account && <>A {bank.account}</>}
        </span>
      )}
      {!shown && (bank.routing || bank.account) && (
        <span className="text-xs text-neutral-400 tabular-nums">
          {maskTail(bank.account || bank.routing)}
        </span>
      )}
    </div>
  );
}

const validSnapList = (f: Filter) =>
  snapList && snapList.filter === f && Date.now() - snapList.at < SNAP_MAX_MS ? snapList : null;
const validSnapRecon = () =>
  snapRecon && Date.now() - snapRecon.at < SNAP_MAX_MS ? snapRecon : null;

export default function PaymentsPage() {
  const access = useAccess();
  const canOpenBill = access.can("recode");
  // Approve all posts to /api/bill-status, which rides the "bill-approve" view.
  const canApprove = access.can("bill-approve");
  const [month, setMonth] = useState<string | null>(snapMonth);
  const [monthBills, setMonthBills] = useState<MonthBill[]>(snapMonthBills);
  const [approving, setApproving] = useState("");
  const [approveMsg, setApproveMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>(snapFilter);
  // First render only: what the snapshot can put on screen immediately. Reading it
  // in the state initializers (rather than an effect) is the point — an effect
  // would paint one frame of skeletons before the cached rows appeared.
  const [restored] = useState(() => ({ list: validSnapList(snapFilter), recon: validSnapRecon() }));
  const [items, setItems] = useState<Statement[]>(restored.list ? restored.list.items : []);
  const [loading, setLoading] = useState(!restored.list);
  const [error, setError] = useState("");
  /** The statement bills could not be read, so JobTread payments are not shown. */
  const [billsUnread, setBillsUnread] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [filling, setFilling] = useState(false);
  const [recon, setRecon] = useState<Record<string, Reconciliation>>(
    restored.recon ? restored.recon.recon : {},
  );
  const [reconLoading, setReconLoading] = useState(!restored.recon);
  const [reconLive, setReconLive] = useState(restored.recon ? restored.recon.live : true);
  // The month-wide view: every Sunset bill of each billing month, for the Link
  // picker. null until the month-wide appscript reconcile is deployed.
  const [months, setMonths] = useState<Record<string, MonthBlock> | null>(
    restored.recon ? restored.recon.months : null,
  );
  const [stale, setStale] = useState<StaleLink[]>(restored.recon ? restored.recon.stale : []);
  const [linkFor, setLinkFor] = useState<LinkTarget | null>(null);
  // How many background re-fetches are in flight (a counter, not a flag — the
  // list and the reconcile refresh independently).
  const [refreshing, setRefreshing] = useState(0);
  const [openIds, setOpenIds] = useState<string[]>(() => Array.from(openCards));
  const runRef = useRef(0);
  const reconRunRef = useRef(0);
  // From xl up the page has room beside the list: the statement PDF docks there,
  // so reading the statement never costs the cards. Below xl, View PDF opens a tab.
  const wide = useIsWide();
  const [pdfFor, setPdfFor] = useState("");
  // The bill a reconcile invoice opened, coded in a popup over this page. `list`
  // is the warning list it came from, so Prev/Next walks it without closing.
  const [popup, setPopup] = useState<{ list: Selection[]; hrefs: string[]; i: number } | null>(null);

  /** An invoice number: a button into the bill's coding card, or plain text. */
  function billRef(s: Statement, list: { number: string; docId?: string; jobId?: string }[], i: number) {
    const x = list[i];
    if (!billHref(x, canOpenBill)) return <span className="font-medium">#{x.number || "—"}</span>;
    const open = list.filter((y) => billHref(y, canOpenBill));
    const at = open.indexOf(x);
    return (
      <button
        type="button"
        onClick={() => {
          if (s.pdfUrl) setPdfFor(s.expId);
          setPopup({
            list: open.map((y) => ({
              docId: y.docId ?? "",
              jobId: y.jobId ?? "",
              label: `Sunset · #${y.number || "—"}`,
              jobName: s.project,
            })),
            hrefs: open.map((y) => billHref(y, canOpenBill)),
            i: at,
          });
        }}
        className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
      >
        #{x.number || "—"}
      </button>
    );
  }

  /** A statement's name by ExpID — any statement, paid or not, from the reconcile. */
  function stmtName(expId: string): string {
    const it = items.find((r) => r.expId === expId);
    const rc = recon[expId];
    const name = it?.accountName || it?.project || rc?.projectName || "another statement";
    const when = rc ? billingLabel(it?.statementDate ?? "", rc.month, rc.year) : "";
    return when ? `${name} · ${when}` : name;
  }

  /** The Link button on a statement line — office/admin, once the month view is live. */
  function linkBtn(s: Statement, rc: Reconciliation, x: MatchInvoice) {
    if (!canOpenBill || !months || !months[`${rc.month}|${rc.year}`]) return null;
    return (
      <button
        type="button"
        onClick={() =>
          setLinkFor({
            statementExpId: s.expId,
            statementName: stmtName(s.expId),
            line: { number: x.number, amount: x.statementAmount ?? 0, date: x.date },
            currentDocId: x.docId || undefined,
            linked: !!x.linked,
          })
        }
        className={jtChip}
      >
        {x.linked ? "Linked ✎" : "Link"}
      </button>
    );
  }

  /** Remember which cards are expanded, so a trip into a bill doesn't collapse them. */
  function toggleCard(expId: string, isOpen: boolean) {
    if (isOpen) openCards.add(expId);
    else openCards.delete(expId);
    setOpenIds(Array.from(openCards));
  }

  // Progressively extract the uncached statements in small batches so no
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
        setBillsUnread(json.billsRead === false);
        if (json.billsRead) {
          snapMonthBills = json.monthBills ?? [];
          setMonthBills(snapMonthBills);
        }
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
        const mo = (json.months as Record<string, MonthBlock> | null) ?? null;
        const st = (json.staleLinks as StaleLink[]) ?? [];
        setRecon(next);
        setReconLive(live);
        setMonths(mo);
        setStale(st);
        snapRecon = { at: Date.now(), recon: next, live, months: mo, stale: st };
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
      setMonths(snap.months);
      setStale(snap.stale);
      setReconLoading(false);
    }
    if (!snap || touchedBillCount() > 0 || Date.now() - snap.at > SNAP_COLD_MS) loadRecon(!!snap);
  }, [loadRecon]);

  // Keep the snapshot in step with what is actually on screen — the extracted header
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

  // The months on screen, newest first. Not picked yet → the newest month.
  const monthKeys = [...new Set(items.map((r) => statementMonthKey(r.statementDate)).filter(Boolean))].sort().reverse();
  // A month the current tab no longer holds falls back to the newest, so a tab
  // switch never leaves an empty list with no chip lit.
  const activeMonth = month === "" ? "" : month && monthKeys.includes(month) ? month : monthKeys[0] ?? "";
  const pickMonth = (m: string) => {
    snapMonth = m;
    setMonth(m);
    setApproveMsg(null);
  };
  const visible = activeMonth ? items.filter((r) => statementMonthKey(r.statementDate) === activeMonth) : items;
  // Draft statement bills for the month, from every statement (paid or not).
  const monthDrafts = activeMonth
    ? monthBills.filter((b) => b.status === "draft" && statementMonthKey(b.statementDate) === activeMonth)
    : [];

  /** Approve every draft statement bill of the month — the same write as the board's batch approve. */
  async function approveAll() {
    const drafts = monthDrafts;
    if (!drafts.length || approving) return;
    const label = monthKeyLabel(activeMonth);
    if (!window.confirm(`Approve ${drafts.length} draft statement bill${drafts.length === 1 ? "" : "s"} for ${label} in JobTread? Approving locks each bill's lines.`)) return;
    setApproveMsg(null);
    const failures: string[] = [];
    let previewed = false;
    for (let i = 0; i < drafts.length; i++) {
      setApproving(`${i + 1} of ${drafts.length}`);
      const b = drafts[i];
      try {
        const r = await fetch("/api/bill-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: b.docId, status: approvalStatusFor(b.name) }),
        });
        const j = await r.json();
        if (!r.ok || j.error) failures.push(`${b.expId}: ${j.error ?? "Approve failed"}`);
        else if (j.previewed) previewed = true;
      } catch (e) {
        failures.push(`${b.expId}: ${e instanceof Error ? e.message : "Request failed"}`);
      }
    }
    setApproving("");
    const ok = drafts.length - failures.length;
    setApproveMsg(
      previewed
        ? { tone: "error", text: "JobTread writes are off, so nothing was approved." }
        : failures.length
          ? { tone: "error", text: `${ok} approved. ${failures.length} failed — ${failures.join("; ")}` }
          : { tone: "success", text: `✓ ${ok} statement bill${ok === 1 ? "" : "s"} approved for ${label}.` },
    );
    load(filter, true);
  }

  // The statement in the side pane: the one last picked, else the first with a PDF.
  const pdfStatement = wide
    ? visible.find((r) => r.expId === pdfFor && r.pdfUrl) ?? visible.find((r) => r.pdfUrl)
    : undefined;

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6 xl:grid xl:max-w-none xl:grid-cols-[42rem_minmax(0,1fr)] xl:items-start xl:gap-6">
      <div className="min-w-0">
      <PageHeader
        title="Sunset Statements"
        description="Pay each statement at TSYS — copy the fields, pay, mark it done. Each card reconciles the statement against every Sunset bill in JobTread that month, on any job. Link a line to its bill when the match cannot find it."
        className="!mb-4"
      />

      <BankRow />

      <SunsetDuplicateScan />

      {/* A bill write — office/admin only (its route rides the "recode" gate). */}
      {canOpenBill && <SunsetExpenseSwitch />}

      {/* "Create Bills" — a bill write on the same gate. */}
      {canOpenBill && <SunsetStatementBills />}

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

      {/* The month. Approve all and Print act on the month picked here. */}
      {monthKeys.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {monthKeys.map((m) => (
            <button
              key={m}
              onClick={() => pickMonth(m)}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold transition " +
                (activeMonth === m
                  ? "bg-accent/10 text-accent dark:text-accent-soft"
                  : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10")
              }
            >
              {monthKeyLabel(m)}
            </button>
          ))}
          <button
            onClick={() => pickMonth("")}
            className={
              "rounded-full px-3 py-1 text-xs font-semibold transition " +
              (activeMonth === ""
                ? "bg-accent/10 text-accent dark:text-accent-soft"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10")
            }
          >
            All months
          </button>
          {activeMonth && (
            <div className="ml-auto flex items-center gap-1.5">
              {canApprove && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!!approving || monthDrafts.length === 0}
                  title="Approve every draft statement bill of this month on the Office job"
                  onClick={approveAll}
                >
                  {approving ? `Approving ${approving}…` : `Approve all (${monthDrafts.length})`}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                title="A summary page, then every statement PDF of this month"
                onClick={() => window.open(`/api/sunset-statements/print?month=${activeMonth}`, "_blank", "noopener")}
              >
                Print
              </Button>
            </div>
          )}
        </div>
      )}

      {approveMsg && (
        <Banner tone={approveMsg.tone} className="mb-4 !py-2 text-xs">
          {approveMsg.text}
        </Banner>
      )}

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {billsUnread && (
        <Banner tone="warning" className="mb-4">
          Couldn&apos;t read the statement bills from JobTread, so a statement paid there may still show unpaid
          here. Reload to try again.
        </Banner>
      )}

      {loading && <CardSkeletonList rows={3} />}

      {!loading && items.length === 0 && (
        <EmptyState>
          {filter === "unpaid"
            ? "Nothing to pay — every Sunset statement is marked paid."
            : "No statements here."}
        </EmptyState>
      )}

      {!reconLoading && !reconLive && (
        <div className="mb-2 text-xs text-warn">
          Couldn&apos;t reach JobTread to verify — showing the hourly sheet mirror, so a just-deleted or voided bill may still appear.
        </div>
      )}

      <MonthCheck
        months={months}
        stale={stale}
        stmtName={stmtName}
        onRemove={
          canOpenBill
            ? async (l) => {
                await fetch("/api/sunset-statement-links", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ statementExpId: l.statementId, lineNumber: l.line }),
                }).catch(() => undefined);
                loadRecon(true);
              }
            : undefined
        }
      />

      <ul className="space-y-2">
        {visible.map((s) => {
          const done = !!s.extractedAt;
          const fail = !!failed[s.expId];
          const rc = recon[s.expId];
          const billing = billingLabel(s.statementDate, rc?.month, rc?.year);
          // The green test lives in lib/sunsetReconcile, so the home card counts
          // the same statements green as this page shows.
          const { hasRows, useLines, cmpTarget, cmpReady, boughtBackTotal, diff, matchIssues, totalMatches, reconciled } =
            reconcileState(s, rc);
          const m = rc?.match ?? null;
          // Lines the month-wide match found off the statement's own job, by amount
          // instead of number, or through an office link — shown so the office can
          // confirm them, and relink one that is wrong.
          const found = m ? m.matched.filter((x) => x.elsewhere || x.fuzzy || x.linked) : [];
          const movedOut = m?.movedOut ?? [];
          return (
            <li
              key={s.expId}
              className={
                "rounded-xl border bg-white p-3 dark:bg-ink-raised " +
                (pdfStatement?.expId === s.expId ? "border-accent" : "border-line")
              }
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
                    {/* `statementNumber` is what Sunset prints on the statement, but it's
                        really the JOB's account number — and it's what TSYS wants in its
                        Reference ID field. Labeled accordingly in both places. */}
                    {s.statementNumber ? `Account #${s.statementNumber}` : "Account #—"}
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
                  {m && (m.missing.length > 0 || m.mismatched.length > 0 || m.extra.length > 0 || found.length > 0 || movedOut.length > 0) ? (
                    <div className="mt-2 space-y-1.5 border-t border-current/20 pt-1.5">
                      {m.missing.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold">
                            ⚠ On statement, not in system ({m.missing.length})
                          </div>
                          <ul className="mt-0.5 space-y-0.5 text-[11px]">
                            {m.missing.map((x, i) => (
                              <li key={"mi" + i} className="flex justify-between gap-3 tabular-nums">
                                <span className="flex min-w-0 items-center gap-1.5 truncate">
                                  <span className="font-medium">#{x.number || "—"}</span>
                                  {linkBtn(s, rc, x)}
                                  {x.date ? <span className="opacity-60"> · {x.date}</span> : null}
                                  {x.claimedBy ? (
                                    <span className="opacity-60"> · already matched on {stmtName(x.claimedBy)}</span>
                                  ) : null}
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
                              return (
                                <li key={"mm" + i} className="flex justify-between gap-3 tabular-nums">
                                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                                    {billRef(s, m.mismatched, i)}
                                    {url && (
                                      <JtLink href={url} className={jtChip}>
                                        JT ↗
                                      </JtLink>
                                    )}
                                    {linkBtn(s, rc, x)}
                                    {x.elsewhere && x.jobName ? <span className="opacity-60"> · on {x.jobName}</span> : null}
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
                            + In system, not on statement ({m.extra.length})
                          </div>
                          <ul className="mt-0.5 space-y-0.5 text-[11px]">
                            {m.extra.map((x, i) => {
                              const url = jtMatchUrl(x);
                              return (
                                <li key={"ex" + i} className="flex justify-between gap-3 tabular-nums">
                                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                                    {billRef(s, m.extra, i)}
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
                      {found.length > 0 && (
                        <div>
                          <div className="text-[11px] font-semibold">
                            ✓ Matched on another job or by amount ({found.length})
                          </div>
                          <ul className="mt-0.5 space-y-0.5 text-[11px]">
                            {found.map((x, i) => {
                              const url = jtMatchUrl(x);
                              const other = x.systemNumber && x.systemNumber !== x.number ? x.systemNumber : "";
                              return (
                                <li key={"fd" + i} className="flex justify-between gap-3 tabular-nums">
                                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                                    {billRef(s, found, i)}
                                    {url && (
                                      <JtLink href={url} className={jtChip}>
                                        JT ↗
                                      </JtLink>
                                    )}
                                    {linkBtn(s, rc, x)}
                                    <span className="opacity-60">
                                      {[
                                        other ? `bill #${other}` : "",
                                        x.elsewhere ? `on ${x.jobName || "another job"}` : "",
                                        x.fuzzy ? "by amount" : "",
                                      ]
                                        .filter(Boolean)
                                        .map((t) => " · " + t)
                                        .join("")}
                                    </span>
                                  </span>
                                  <span>{moneyN(x.systemAmount ?? 0)}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      {movedOut.length > 0 && (
                        <div className="opacity-80">
                          <div className="text-[11px] font-semibold">
                            → On this job, printed on another statement ({movedOut.length})
                          </div>
                          <ul className="mt-0.5 space-y-0.5 text-[11px]">
                            {movedOut.map((x, i) => (
                              <li key={"mo" + i} className="flex justify-between gap-3 tabular-nums">
                                <span className="min-w-0 truncate">
                                  #{x.number || "—"}
                                  <span className="opacity-60"> · {stmtName(x.claimedBy ?? "")}</span>
                                </span>
                                <span>{moneyN(x.systemAmount ?? 0)}</span>
                              </li>
                            ))}
                          </ul>
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
                        return (
                          <li key={inv.number + "-" + i} className="flex justify-between gap-3 tabular-nums">
                            <span className="flex min-w-0 items-center gap-1.5 truncate">
                              {billRef(s, rc.invoices, i)}
                              {url && (
                                <JtLink href={url} className={jtChip}>
                                  JT ↗
                                </JtLink>
                              )}
                              {inv.isCredit && (
                                <span className="rounded bg-rose-500/15 px-1 text-[10px] font-semibold uppercase tracking-wide text-danger">
                                  credit
                                </span>
                              )}
                              {inv.date ? <span className="opacity-60"> · {inv.date}</span> : null}
                            </span>
                            <span className={inv.isCredit ? "text-danger" : ""}>
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
                {/* Ordered to match the TSYS form top-to-bottom: amount, account name, reference. */}
                {s.net && <CopyButton value={s.net} label="Net" />}
                {s.accountName && <CopyButton value={s.accountName} label="Account Name" />}
                {s.statementNumber && <CopyButton value={s.statementNumber} label="Reference ID" />}
                <JtLink
                  href={TSYS_URL}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
                >
                  Pay at TSYS ↗
                </JtLink>
                {s.pdfUrl && wide ? (
                  <button
                    type="button"
                    onClick={() => setPdfFor(s.expId)}
                    disabled={pdfStatement?.expId === s.expId}
                    className="inline-flex items-center rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 transition hover:border-accent hover:text-accent disabled:border-accent disabled:text-accent dark:border-neutral-600 dark:text-neutral-300"
                  >
                    {pdfStatement?.expId === s.expId ? "PDF shown →" : "View PDF"}
                  </button>
                ) : s.pdfUrl ? (
                  <a
                    href={s.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 transition hover:border-accent hover:text-accent dark:border-neutral-600 dark:text-neutral-300"
                  >
                    View PDF
                  </a>
                ) : null}
                <div className="ml-auto">
                  {s.status === "paid" && s.paidBy === "JobTread" ? (
                    // Paid in JobTread: undoing it here would only be re-marked on the next read.
                    <span className="text-xs font-semibold text-ok">Paid in JT</span>
                  ) : s.status === "paid" ? (
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

              {(s.bill || (s.status === "paid" && s.paidAt)) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                  {s.status === "paid" && s.paidAt && (
                    <span className="text-ok">
                      Paid {shortDate(s.paidAt)}
                      {s.paidBy === "JobTread" ? " in JobTread" : ""}
                    </span>
                  )}
                  {s.bill && (
                    <JtLink
                      href={officeBillUrl(s.bill.docId)}
                      className="text-neutral-500 underline decoration-current/40 underline-offset-2 hover:text-accent dark:text-neutral-400"
                    >
                      Office bill: {BILL_STATUS[s.bill.status] ?? s.bill.status}
                      {s.bill.amountPaid > 0.005 && Math.abs(s.bill.balance) > 0.005
                        ? ` · ${moneyN(s.bill.amountPaid)} paid, ${moneyN(s.bill.balance)} owed`
                        : ""}{" "}
                      ↗
                    </JtLink>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      </div>

      {/* The statement beside the cards. This is the one place a PDF goes in an
          <iframe> (see InvoiceViewer's rule): the pane is its own column, pinned
          below the header, so a wheel over it scrolls the statement and a wheel
          over the cards scrolls the page. Nothing is inline to trap. */}
      {pdfStatement && (
        <aside
          className="sticky-below-header hidden min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-white dark:bg-ink-raised xl:sticky xl:flex"
          style={{ height: "calc(100dvh - var(--appheader-h) - var(--tabbar-h) - 1.5rem)" }}
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-line-soft px-3 py-2 text-xs">
            <span className="min-w-0 truncate font-semibold">
              {pdfStatement.accountName || pdfStatement.project || pdfStatement.expId}
              {pdfStatement.statementDate ? (
                <span className="font-normal text-neutral-500 dark:text-neutral-400"> · {pdfStatement.statementDate}</span>
              ) : null}
            </span>
            <a
              href={pdfStatement.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto shrink-0 font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
            >
              Open in Drive ↗
            </a>
          </div>
          <iframe
            key={pdfStatement.expId}
            title={`Statement ${pdfStatement.statementNumber || pdfStatement.expId}`}
            src={`/api/sunset-statements/${encodeURIComponent(pdfStatement.expId)}/pdf#view=FitH`}
            className="min-h-0 w-full flex-1 bg-neutral-100 dark:bg-ink"
          />
        </aside>
      )}

      {linkFor && months && (
        <SunsetLinkPicker
          target={linkFor}
          candidates={(() => {
            const rc = recon[linkFor.statementExpId];
            return rc ? months[`${rc.month}|${rc.year}`]?.invoices ?? [] : [];
          })()}
          statementName={stmtName}
          onClose={() => setLinkFor(null)}
          onSaved={() => {
            setLinkFor(null);
            // The link applies on the next reconcile — re-run it behind the cards.
            loadRecon(true);
          }}
        />
      )}

      {popup && (
        <BillPopup
          key={popup.list[popup.i].docId}
          sel={popup.list[popup.i]}
          fullPageHref={popup.hrefs[popup.i]}
          nav={{
            position: popup.i + 1,
            count: popup.list.length,
            onPrev: () => setPopup((p) => (p ? { ...p, i: Math.max(p.i - 1, 0) } : p)),
            onNext: () => setPopup((p) => (p ? { ...p, i: Math.min(p.i + 1, p.list.length - 1) } : p)),
          }}
          onClose={() => {
            setPopup(null);
            // The popup saves straight to JobTread, so re-run the match behind
            // the cards — a fixed invoice drops off its warning list.
            loadRecon(true);
          }}
        />
      )}
    </main>
  );
}

const MONTH_KEY = /^(\d{1,2})\|(\d{4})$/;

/**
 * The month-wide check, above the cards: Sunset bills no statement accounts for
 * (on a job with no statement that month, and no statement line claims them),
 * and office links that no longer apply. A bill here is usually one the office
 * moved to a job Sunset has no account for — link the statement line that
 * prints it.
 */
function MonthCheck({
  months,
  stale,
  stmtName,
  onRemove,
}: {
  months: Record<string, MonthBlock> | null;
  stale: StaleLink[];
  stmtName: (expId: string) => string;
  /** Office/admin only: drop a link that no longer applies. */
  onRemove?: (l: StaleLink) => void;
}) {
  if (!months && stale.length === 0) return null;
  const rows = Object.entries(months ?? {})
    .filter(([k, b]) => MONTH_KEY.test(k) && b.unclaimed.length > 0)
    .sort(([a], [b]) => {
      const [, am, ay] = MONTH_KEY.exec(a)!;
      const [, bm, by] = MONTH_KEY.exec(b)!;
      return Number(by) - Number(ay) || Number(bm) - Number(am);
    });
  if (rows.length === 0 && stale.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-line bg-white px-3 py-2 text-xs dark:bg-ink-raised">
      {stale.length > 0 && (
        <div className="mb-1.5 text-warn">
          <div className="font-semibold">⚠ Links that no longer apply ({stale.length})</div>
          <ul className="mt-0.5 space-y-0.5">
            {stale.map((l, i) => (
              <li key={"st" + i} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">
                  {stmtName(l.statementId)} · line #{l.line || "—"}
                  {l.number ? ` → #${l.number}` : ""} · {l.reason}
                </span>
                {onRemove && (
                  <button type="button" onClick={() => onRemove(l)} className={jtChip}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rows.map(([k, b]) => {
        const [, mm, yy] = MONTH_KEY.exec(k)!;
        return (
          <details key={k} className="group py-0.5">
            <summary className="cursor-pointer list-none select-none font-semibold">
              {MONTHS[Number(mm) - 1]} {yy}: {b.unclaimed.length} Sunset bill{b.unclaimed.length === 1 ? "" : "s"} on no
              statement <span className="font-normal opacity-60 group-open:hidden">▸</span>
              <span className="hidden font-normal opacity-60 group-open:inline">▾</span>
            </summary>
            <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              These sit on a job with no statement this month. Link the statement line that prints each one.
            </div>
            <ul className="mt-1 space-y-0.5 text-[11px]">
              {b.unclaimed.map((c) => (
                <li key={c.uid} className="flex justify-between gap-3 tabular-nums">
                  <span className="min-w-0 truncate">
                    #{c.number || "—"}
                    <span className="opacity-60">
                      {" · "}
                      {c.jobName || "no job"}
                      {c.date ? ` · ${c.date}` : ""}
                    </span>
                  </span>
                  <span>{moneyN(c.amount)}</span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
