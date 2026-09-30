"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { setUrlParam } from "@/lib/urlParam";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  Loading,
  MetaLine,
  PageHeader,
  SectionLabel,
  Select,
  Spinner,
  StatementBlock,
  StickyActionBar,
  btn,
} from "@/components/ui";
import type { Option } from "@/components/CostCodeSelect";
import { JobPicker, jobAddress } from "@/components/JobPicker";
import { useBillMove } from "@/components/BillMove";
import { DocumentAccess } from "@/components/DocumentAccess";
import { JtLink } from "@/components/JtLink";
import { SplitGrid } from "@/components/SplitGrid";
import { CostDonuts, type CostDonutRow } from "./CostDonuts";
import {
  buildHeadroom,
  jobRingRows,
  monthRingRows,
  remainingOf,
  usedOf,
  type Headroom,
} from "./headroom";
import {
  BillCodingCard,
  money,
  money0,
  type CodingCardCtl,
} from "./BillCodingCard";
import { billLineMath, round2, type LineEdit } from "@/lib/billLineMath";
import { TimeCodingCard } from "./TimeCodingCard";
import {
  TimeEntryList,
  TimeRecodeCard,
  type CodeHeadroom,
  type TimeEntryRow,
} from "@/components/TimeEntryList";
import { AddTimeCard } from "./AddTimeCard";
import { useTimeCoding } from "./useTimeCoding";
import { BillListView } from "./BillListView";
import { CodeLanesView } from "./CodeLanesView";
import { BillingSummaryView } from "./BillingSummaryView";
import { BudgetRail } from "./BudgetRail";
import { CodeDrillSheet } from "./CodeDrillSheet";
import { useLineDrag } from "./useLineDrag";
import { useCodeDrill } from "./useCodeDrill";
import { useBillFiles } from "./useBillFiles";
import { useLineEdits } from "./useLineEdits";
import { useBillReview } from "./useBillReview";
import { useBillFields } from "./useBillFields";
import { useCodingDraft } from "./useCodingDraft";
import { useMonthLoad } from "./useMonthLoad";
import { saveCoding } from "./saveCoding";
import { useBillApproval } from "./useBillApproval";
import { useRailView } from "./useRailView";
import { useTrackingPush } from "./useTrackingPush";
import { usePreSendCheck } from "./usePreSendCheck";
import { InvoiceReconcile, reconStatus, type Recon } from "@/components/InvoiceReconcile";
import { UncapturedBills } from "@/components/UncapturedBills";
import { BILL_STRIPE_COLOR, billInvoiceState } from "@/lib/billInvoiceState";
import { billPaidState, driveMainWindowToDoc, type Detail } from "@/components/BillingSummary";
import { runTrackingSync } from "@/components/TrackingSheetSync";
import { TrackingSheetRisks } from "@/components/TrackingSheetRisks";
import { PreSendCheck } from "./PreSendCheck";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { confirmLeaveIfDirty, useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { discardDraft, draftSavedAtLabel } from "@/lib/codingDraft";
import { isSalesTaxLine, SALES_TAX_LINE_NAME } from "@/lib/salesTax";
import { billingMonths, monthLabel } from "@/lib/billingMonths";
import type { CombineRequest } from "@/lib/combineLines";

/**
 * Invoicing coding board — the desktop workbench for deciding which cost code
 * each of a month's expenditures should land on.
 *
 * The premise: the decision is "we're maxed out on Gypsum Drywall but have room
 * in Interior Finishes", and until now the bills and that headroom lived on
 * different screens (the bill page vs. the project's Google Tracking Sheet).
 * Here they share one: a cost-code reference rail on the left carrying live
 * budget headroom, the month's bills in the middle, and a coding drawer on the
 * right.
 *
 * STAGED, NOT SAVED. A recode updates the on-screen math immediately and
 * nothing else; JobTread is written only when you press Sync. That's what makes
 * "try moving this and see what it does to the budget" cheap.
 *
 * WHAT A RECODE IS. A bill line's cost code is derived by JobTread from the
 * budget leaf it's coded to, so re-pointing `jobCostItemId` is the whole edit —
 * verified live across 793 lines with zero divergence. Only cost codes that
 * already have a budget leaf can be targets; codes with none render dimmed,
 * because coding to them would mean inventing budget rows.
 *
 * Everything the board reads comes from /api/trackingsheet in one fetch.
 */

export interface BillRef {
  id: string;
  label: string;
  externalId: string | null;
  number: string | null;
  vendor: string;
  cost: number;
  status: string;
  issueDate: string | null;
  /** JobTread's "Payment Due" — when the vendor's invoice is due. Null when the
   *  bill runs on net terms (`dueDays`) instead. */
  dueDate: string | null;
  /** Net terms in days, set only when there is no explicit due date. */
  dueDays: number | null;
  createdAt: string | null;
  name: string;
  /** Legacy document tax field — non-zero only on a bill pushed before 2026-09-05.
   *  A bill's real sales tax is `billTax(bill)`: its 88 80 00 line plus this. */
  nonRecoverableTax: number;
  /** JobTread's "Record Tax" toggle. On means the bill shows a document tax row —
   *  which the 88 80 00 model forbids, so a Sync turns it off. */
  recordsTax: boolean;
  qboIsIgnored: boolean;
  /** QuickBooks "Push as": "bill" | "purchase" (Expense) | null (Bill). */
  qboDocumentType: string | null;
  /** Paid-in-QuickBooks figures JobTread computes — read as a pair, see billPaidState. */
  amountPaid: number;
  balance: number;
  saved: boolean;
  reviewed: boolean;
  needsReview: boolean;
  invoiced: boolean;
  /** On any non-denied customer invoice, draft included, and whether the job's
   *  month has an invoice at all — the stripe's two inputs (billInvoiceState). */
  onInvoice: boolean;
  monthInvoiceExists: boolean;
  fileCount: number;
}
export interface JobBillLine {
  id: string;
  docId: string;
  billStatus: string;
  name: string;
  cost: number;
  quantity?: number;
  unitCost?: number;
  code: string;
  codeName: string;
  jobCostItemId: string | null;
}
/**
 * One time entry in the month: the shared list's row (see TimeEntryList) plus
 * the raw clock only this page edits.
 *
 * Declared as an EXTENSION rather than a second copy of the same fields — the
 * two drifted once already, which is the whole reason the list is shared now.
 * `endedAt`/`minutes` survive the trip because the single-entry editor rewrites
 * the actual window worked, not just the duration JobTread derived from it.
 */
interface MonthTimeEntry extends TimeEntryRow {
  endedAt: string | null;
  minutes: number;
}
export interface BudgetItem {
  id: string;
  number: string;
  name: string;
  detail?: string;
  costType?: string;
  cost?: number;
  /** JobTread's own division name for the code (`costCode.parentCostCode`). */
  division?: string;
}
interface CostCodeRow {
  number: string;
  name: string;
  division: string;
  budget: number;
  bills: number;
  labor: number;
  laborApproved: number;
  invoiced: number;
}
interface CostDivisionRow {
  division: string;
  name: string;
  codes: CostCodeRow[];
}
export interface BoardPayload {
  job: {
    id: string;
    name: string;
    address: string;
    customer: string;
    /** The job's Phase — decides whether sales tax on its bills is recoverable. */
    phase?: string;
  } | null;
  bills: BillRef[];
  billTotal: number;
  lines: JobBillLine[];
  timeEntries: MonthTimeEntry[];
  budget: BudgetItem[];
  costDetail: { divisions: CostDivisionRow[]; budgetBasis: string };
  writesEnabled: boolean;
  error?: string;
}

/** One vendor-bill line behind a cost code's "bills" total — from /api/trackingsheet/contributors. */
interface CostCodeBillContributor {
  id: string; // costItemId — matches JobBillLine.id for staged-recode reconciliation
  docId: string;
  code: string;
  vendor: string;
  label: string;
  issueDate: string | null;
  status: string;
  lineName: string;
  cost: number;
}
/** One time entry behind a cost code's "labor" total — from /api/trackingsheet/contributors. */
export interface CostCodeTimeContributor {
  id: string;
  code: string;
  employee: string;
  startedAt: string | null;
  hours: number;
  cost: number;
  notes: string;
  isApproved: boolean;
}
export interface JobCostContributors {
  bills: CostCodeBillContributor[];
  time: CostCodeTimeContributor[];
}
/** One row in the drill-down's bill list — a committed bill from JobTread, or a still-open draft. */
export interface DrillBillRow {
  key: string;
  docId: string;
  vendor: string;
  lineName: string;
  issueDate: string | null;
  status: string;
  cost: number;
  draft: boolean;
}



/**
 * Sunset Builders Supply, matched the same way the rest of the codebase does
 * (`/sunset/i` on the vendor name — see getUninvoicedBills / getMonthlyInvoiceJobs).
 * The high invoice count makes it noise when you're deciding where to move money,
 * so in the by-bill list it's split off into its own collapsible pane instead of
 * cluttering the main list. Its cost stays in every budget figure on this page —
 * the split is a view convenience only, never a change to a number.
 */
const isSunsetVendor = (vendor: string) => /sunset/i.test(vendor);

/**
 * Default billing month. A bill's billing month is simply the month of its
 * Invoice Date; the 10th-of-the-month rule is an INGESTION convention (it
 * decides which issueDate a newly-arrived bill gets), so it belongs here only as
 * the sensible default guess at "the month you're working on", never as a filter.
 */
function defaultYm(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  if (now.getDate() <= 10) d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Is this cost code the DIVISION itself ("04 00 00", "26 00 00")? Everything
 * after the first two digits is zero. JobTread leaves these without a
 * parentCostCode — they ARE the parent — so their own name names the division.
 * (Mirrors `isDivisionLevelCode` in lib/jobtread.ts; this file is a client
 * component and can't import that server module.)
 */
function isDivisionLevelCode(number: string): boolean {
  const digits = String(number ?? "").replace(/\D/g, "");
  return digits.length >= 4 && /^0+$/.test(digits.slice(2));
}

/**
 * Hours as a headline figure: "350 hrs", "349.8 hrs". One decimal, but only
 * when there is one — a month's total reading "350.0 hrs" is noise, and
 * rounding it away entirely would hide a part-hour.
 */
const hoursLabel = (n: number) => {
  const v = Math.round(n * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} hrs`;
};

/** Per-cost-code money, after staged moves. */
// The budget math — Headroom, usedOf, remainingOf, isCommitted and the rail /
// ring builders — lives in ./headroom.ts, with its tests.

/* <Meter> now lives in components/ui — the budget bar is the same object here,
   on the mobile headroom rail, and on any future page that shows spend against
   a budget, so it belongs to the design system rather than to this board. */

/**
 * True below the `xl` boundary — where the coding column itself is hidden.
 * Mirrors the `hidden xl:block` on that section: one source of truth would be
 * better, but a media query is what CSS is doing there too.
 *
 * There used to be a SECOND hook on the `lg` line, and the gap between them was
 * a bug. The bill list sent `lg` and below to /bill, but the column it kept the
 * rest for only exists from `xl` — so between 1024 and 1280 a tapped bill
 * selected a row and rendered its card nowhere. One line now: below xl a bill
 * opens the bill page, which shows the same BillCodingCard the column does, and
 * a time entry opens it as a sheet.
 */
function useIsBelowXl() {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const update = () => setBelow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return below;
}

export function Board() {
  // Office-edited wording (Admin → Page Text); see src/lib/copy.ts.
  const c = useCopy();
  const params = useSearchParams();
  const router = useRouter();
  // Bill moves run in the background, owned by the root layout — see BillMove.tsx.
  const billMove = useBillMove();
  const startBillMove = billMove.start;
  const belowXl = useIsBelowXl();
  const jobId = params.get("jobId") ?? "";

  const [ym, setYm] = useState(() => params.get("ym") || defaultYm());
  // Whether the Sunset pane in the by-bill list is expanded. Collapsed by
  // default, same as the Labor block below it — Sunset is the noise you
  // fold away, and its cost is already in every figure on the page regardless.
  const [sunsetBlockOpen, setSunsetBlockOpen] = useState(false);
  /** …and the main bill list, which folds the SAME way but starts OPEN — it is
   *  the month's actual work, not the noise either of its neighbours is. */
  const [billBlockOpen, setBillBlockOpen] = useState(true);
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  /** A reload over a board that's already on screen. Unlike `loading` it does
      NOT unmount the page — every write here (approve, sync, delete, combine)
      re-pulls the month, and blanking the board threw away your scroll spot
      every time. Only the FIRST pull of a job+month has nothing to show. */
  const [refreshing, setRefreshing] = useState(false);
  /** The job+month the board is currently showing, so load() can tell a first
      pull from a refresh without depending on `data` (which would rebuild
      load() and re-fire its effect). */
  const shownKey = useRef("");
  const [error, setError] = useState("");

  /** costItemId → the budget leaf it's been staged onto. */
  const [staged, setStaged] = useState<Map<string, string>>(new Map());
  /** costItemId → in-flight description / qty / unit-cost text, draft bills only. */
  const [edits, setEdits] = useState<Record<string, LineEdit | undefined>>({});
  /** docId → in-flight sales-tax text, staged the same way as edits/staged. */
  const [taxEdits, setTaxEdits] = useState<Record<string, string>>({});
  /** docId → the Bill/Expense type staged for it. Save writes it (name AND
   *  QuickBooks' "Push as"); it is in here only while it differs from JobTread. */
  const [typeEdits, setTypeEdits] = useState<Record<string, "Bill" | "Expense">>({});
  /** The merge waiting for Save — see combineRows. */
  const [combinePending, setCombinePending] = useState<CombineRequest | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const codingColRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<"bill" | "code" | "summary">("bill");
  /**
   * The client-facing billing summary for this job and month, from the SAME
   * endpoint the all-jobs roster reads (/api/stage?jobId=). Fetched on demand
   * when Summary mode is opened rather than derived from the board's own
   * payload: the printed document and the roster card have to agree to the
   * cent, and they only can if they're built from one source.
   */
  const [summary, setSummary] = useState<Detail | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [summaryByCsi, setSummaryByCsi] = useState(false);
  // Lifted out of the reconcile rectangle so the header can show the same
  // authoritative "to be invoiced" figure without fetching it twice.
  const [recon, setRecon] = useState<Recon | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);



  /**
   * Bulk Document Access — the month's vendor bills added to the client's
   * "Document Access" list in one press, instead of sharing forty documents one
   * at a time in JobTread. The list itself is <DocumentAccess>, the same
   * component the bill card uses for a single bill.
   */
  const [accessOpen, setAccessOpen] = useState(false);

  // The Tracking Sheet push is its own button in the closing row, never a step
  // inside Save. It still needs target resolution and result state held HERE
  // the way /stage drives TrackingSheetSync, rather than the self-contained
  // TrackingSheetSyncFor, so a result outlives whatever the office does next.
  const { can } = useAccess();
  const canTrack = can("tracking-sheet");
  const canApprove = can("bill-approve");
  const canLaborReview = can("labor-review");
  // Admin-only: the tracking-sheet-vs-JobTread gap panel in the budget rail
  // reads /api/historical-cost, which carries the same view gate.
  const canSheetGap = can("historical-cost");
  const canPackage = can("invoicing-summary");
  // The job's tracking sheet and the last push into it — ./useTrackingPush.
  const { trackingTarget, trackingChecked, trackingSync, setTrackingSync, trackingBusy } = useTrackingPush({
    canTrack,
    jobId,
    ym,
  });

  // ---- pre-send check (the invoice review's checks, on this job) — ./usePreSendCheck
  const { preSend, preSendRunning, preSendError, runPreSend } = usePreSendCheck({ jobId, ym });

  // The budget column's screen state (search, folds, hide) — ./useRailView.
  const {
    codeQuery,
    setCodeQuery,
    collapsedDivs,
    setCollapsedDivs,
    railCollapsed,
    setRailCollapsed,
    railHidden,
    toggleRailHidden,
    headroomMostLeft,
    setHeadroomMostLeft,
  } = useRailView();
  // ---- time coding: state and handlers live in ./useTimeCoding ---------------
  const leafById = useMemo(() => {
    const m = new Map<string, BudgetItem>();
    for (const b of data?.budget ?? []) m.set(b.id, b);
    return m;
  }, [data]);
  const {
    timeBlockOpen,
    setTimeBlockOpen,
    openTimeId,
    setOpenTimeId,
    addTimeOpen,
    setAddTimeOpen,
    timeSelected,
    setTimeSelected,
    timeStaged,
    setTimeStaged,
    timeEdits,
    setTimeEdits,
    timeTouched,
    timeLeafOf,
    timeCodeOf,
    monthTime,
    monthTimeTotal,
    monthTimeHours,
    timeFilters,
    timeSelectedEntries,
    stageTimeSelection,
    stageTimeEdit,
    stageTimeType,
    timeTypeOf,
    undoTimeStage,
    toggleTimeFlag,
    markTimeApproved,
    openTime,
    timeCodeOptions,
  } = useTimeCoding({
    data,
    setData,
    jobId,
    ym,
    leafById,
    onStaged: () => setSyncMsg(null),
  });

  // ---- derived: bills + their lines ---------------------------------------
  // Declared here, ABOVE taxDirty: taxDirty runs during render and calls
  // billTax, and a `const` read before its line throws (it crashed the board
  // whenever a sales-tax figure was staged).
  // Codeable lines per bill, with the 88 80 00 sales-tax line taken OUT — it is
  // not something the office codes, and leaving it in would let a tax amount be
  // edited as if it were a material line. `taxByDoc` keeps what each one carried.
  const { linesByDoc, taxByDoc } = useMemo(() => {
    const m = new Map<string, JobBillLine[]>();
    const tax = new Map<string, number>();
    for (const l of data?.lines ?? []) {
      if (isSalesTaxLine(l)) {
        tax.set(l.docId, round2((tax.get(l.docId) ?? 0) + (Number(l.cost) || 0)));
        continue;
      }
      const arr = m.get(l.docId) ?? [];
      arr.push(l);
      m.set(l.docId, arr);
    }
    return { linesByDoc: m, taxByDoc: tax };
  }, [data]);

  /**
   * A bill's sales tax: its 88 80 00 line plus any legacy `nonRecoverableTax`.
   * Summed, not preferred, so a bill halfway through the migration reports all
   * of its tax. Exactly one of the two is non-zero in practice.
   */
  const billTax = useCallback(
    (b: { id: string; nonRecoverableTax?: number } | undefined | null) =>
      b ? round2((taxByDoc.get(b.id) ?? 0) + (Number(b.nonRecoverableTax) || 0)) : 0,
    [taxByDoc],
  );

  const taxDirty = Object.entries(taxEdits).some(([docId, v]) => {
    if (v === "") return false;
    const bill = data?.bills.find((b) => b.id === docId);
    if (!bill) return false;
    return round2(Number(v) || 0) !== round2(billTax(bill));
  });
  const dirty =
    staged.size > 0 ||
    timeStaged.size > 0 ||
    Object.keys(timeEdits).length > 0 ||
    Object.keys(edits).length > 0 ||
    taxDirty ||
    Object.keys(typeEdits).length > 0 ||
    combinePending !== null;
  /** Everything Sync would write, for the toolbar's chip. A staged merge counts
   *  as one change however many lines it folds together — it is one decision. */
  const stagedCount =
    staged.size + timeTouched.size + Object.keys(typeEdits).length + (combinePending ? 1 : 0);
  // Still worth a prompt — leaving means the coding hasn't reached JobTread —
  // but it no longer says "lose them", because it isn't true any more: the
  // autosave below has already put the work somewhere it survives (see
  // src/lib/codingDraft.ts). The dialog is now a reminder, not the safety net.
  useUnsavedChanges(
    dirty,
    "You have staged coding changes that haven't been synced to JobTread. They'll be saved and offered back when you return — leave now?",
  );

  // ---- durable drafts — saved, offered back and reconciled in ./useCodingDraft
  const { draftKey, restoreMsg, setRestoreMsg, restoreStartedRef, autosaveArmedRef } = useCodingDraft({
    jobId,
    ym,
    loading,
    data,
    staged,
    setStaged,
    edits,
    setEdits,
    taxEdits,
    setTaxEdits,
    timeStaged,
    setTimeStaged,
    timeEdits,
    setTimeEdits,
  });

  // The month load — one read, and what it does to staged work — ./useMonthLoad.
  const load = useMonthLoad({
    jobId,
    ym,
    shownKey,
    setLoading,
    setRefreshing,
    setError,
    setData,
    setStaged,
    setEdits,
    setTaxEdits,
    setTypeEdits,
    setTimeStaged,
    setTimeEdits,
    setTimeSelected,
  });

  /**
   * Load the billing summary when Summary mode is open. `data` is a real
   * dependency, not a refresh hack: the summary describes the same month the
   * board has just loaded, so it waits for that load and re-runs after one —
   * which is also what refreshes it after a Sync writes new coding to JobTread.
   */
  useEffect(() => {
    if (mode !== "summary" || !jobId || !data) return;
    let alive = true;
    (async () => {
      setSummaryLoading(true);
      setSummaryError("");
      try {
        const [y, m] = ym.split("-").map(Number);
        const p = new URLSearchParams({ jobId, year: String(y), month: String(m) });
        p.set("includeInvoiced", "1");
        p.set("includeDrafts", "1");
        const res = await fetch(`/api/stage?${p.toString()}`);
        const j = await res.json();
        if (!alive) return;
        if (res.ok) {
          setSummary({
            customer: j.customer ?? null,
            job: j.job,
            lines: j.lines ?? [],
            total: j.total ?? 0,
          });
        } else {
          setSummaryError(j.error ?? "Couldn't load the billing summary");
        }
      } catch (e) {
        if (alive) setSummaryError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (alive) setSummaryLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode, jobId, ym, data]);

  // Returning from a bill's detail page (mobile) lands here with a `#bill-<id>`
  // hash naming the bill that was tapped. The list renders async, so the browser
  // can't do the hash scroll itself — do it once the bills are on screen, which
  // drops you back at your exact spot. Guarded so it fires only on that first
  // load, not on every later data refresh.
  const didHashScroll = useRef(false);
  useEffect(() => {
    if (loading || !data || didHashScroll.current) return;
    const hash = window.location.hash;
    if (!hash.startsWith("#bill-")) return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      didHashScroll.current = true;
      el.scrollIntoView({ block: "center" });
    }
  }, [loading, data]);

  // ---- derived: coding targets -------------------------------------------

  const leavesByCode = useMemo(() => {
    const m = new Map<string, BudgetItem[]>();
    for (const b of data?.budget ?? []) {
      const arr = m.get(b.number) ?? [];
      arr.push(b);
      m.set(b.number, arr);
    }
    return m;
  }, [data]);

  /** The leaf a line currently points at, staged edits winning. */
  const leafOf = useCallback(
    (l: JobBillLine) => staged.get(l.id) ?? l.jobCostItemId ?? "",
    [staged],
  );

  /** The cost code a line currently sits under, staged edits winning. */
  const codeOf = useCallback(
    (l: JobBillLine) => {
      const leaf = leafOf(l);
      return leafById.get(leaf)?.number ?? l.code;
    },
    [leafOf, leafById],
  );

  // ---- derived: headroom per cost code ------------------------------------
  const headroom = useMemo(
    () =>
      buildHeadroom({
        divisions: data?.costDetail?.divisions ?? [],
        leavesByCode,
        lines: data?.lines ?? [],
        timeEntries: data?.timeEntries ?? [],
        codeOf,
        timeCodeOf,
      }),
    [data, codeOf, timeCodeOf, leavesByCode],
  );

  /**
   * cost code → its JobTread budget, for the admin sheet-vs-JobTread panel.
   * Taken off `headroom` rather than re-fetched, so the panel compares the
   * sheet against the same budget the rail under it draws.
   */
  const budgetByCode = useMemo(
    () => new Map([...headroom.values()].map((h) => [h.code, h.budget])),
    [headroom],
  );

  /**
   * The cost rings' JOB-TO-DATE scope — the SAME `headroom` map the budget rail
   * draws, so the rings cannot disagree with the rail beside them and a staged
   * recode moves a slice the moment you drop a line. Bills folds drafts in,
   * matching `usedOf`: on this page a draft is coded money, it is just not
   * committed yet. Codes with no cost at all sit out, so the rings never carry
   * a legend of zeroes.
   */
  const costDonutRows = useMemo<CostDonutRow[]>(() => jobRingRows(headroom), [headroom]);

  /**
   * …and the rings' SELECTED-MONTH scope, which is the one they open on. Built
   * from the month's own bill lines and time entries rather than sliced out of
   * `headroom`, because `headroom` is job-to-date by construction — it starts
   * from `costDetail`, which has no month in it.
   *
   * Coded through `codeOf`/`timeCodeOf`, the same staged-aware readers the rail
   * and every drill-down use, so a drag moves a slice here too. Bills counts
   * every line in the month, draft and committed alike: the board always loads
   * the month with `includeDrafts` and `includeInvoiced` on, and on this page a
   * draft is coded money. Names come off `headroom` first so a code reads the
   * same in both scopes, with the line's own `codeName` as the fallback for a
   * code that never reached the budget.
   */
  const costDonutMonthRows = useMemo<CostDonutRow[]>(
    () =>
      monthRingRows({
        lines: data?.lines ?? [],
        timeEntries: data?.timeEntries ?? [],
        codeOf,
        timeCodeOf,
        headroom,
      }),
    [data, codeOf, timeCodeOf, headroom],
  );

  const railRows = useMemo(() => {
    const q = codeQuery.trim().toLowerCase();
    // Labor-only codes count: a code with hours but no budget and no bills is
    // over budget by definition, and hiding it would hide that.
    const rows = [...headroom.values()].filter(
      (h) => h.budget !== 0 || h.spent !== 0 || h.drafts !== 0 || h.labor !== 0,
    );
    const matched = q ? rows.filter((h) => `${h.code} ${h.name}`.toLowerCase().includes(q)) : rows;
    return matched.sort((a, b) => a.code.localeCompare(b.code));
  }, [headroom, codeQuery]);

  /**
   * The rail, grouped into collapsible CSI divisions. A division's figures are
   * the sum of its codes', so a collapsed division still says whether there's
   * room in it — otherwise collapsing would hide the answer you came for.
   */
  const railGroups = useMemo(() => {
    const g = new Map<string, { code: string; name: string; rows: Headroom[] }>();
    for (const h of railRows) {
      const dc = h.code.replace(/\D/g, "").slice(0, 2) || "—";
      const e = g.get(dc) ?? { code: dc, name: "", rows: [] };
      // A division is named by JobTread's parent cost code. A code that IS the
      // division ("04 00 00 Masonry") has no parent, so its own name names the
      // division — otherwise the header falls back to the number and reads
      // "04 04".
      if (!e.name) e.name = h.division || (isDivisionLevelCode(h.code) ? h.name : "");
      e.rows.push(h);
      g.set(dc, e);
    }
    return [...g.values()]
      .map((e) => ({
        ...e,
        budget: e.rows.reduce((s, r) => s + r.budget, 0),
        used: e.rows.reduce((s, r) => s + usedOf(r), 0),
        remaining: e.rows.reduce((s, r) => s + remainingOf(r), 0),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [railRows]);

  /**
   * The tightest cost codes, for the phone's headroom rail.
   *
   * The full rail is a desktop instrument — 24-odd codes you scan while dragging
   * — and on a phone it's collapsed behind a tap, which in practice meant the
   * budget simply wasn't visible on the device the month gets reviewed on. This
   * is the answer to the question you actually have there ("what am I about to
   * run out of?"): every code with a real budget, fewest DOLLARS left first.
   *
   * Ranked by dollars, not by percent of budget. A percentage put a $400 code
   * $250 over ahead of a $60,000 code $9,000 over, which is the wrong end of the
   * list to be looking at — the money is what has to be covered, and a small
   * code's big percentage is usually a rounding decision. Codes with no budget
   * are still excluded: the card divides by the budget for its bar and its
   * percentage, and an unbudgeted code would sit at the front forever.
   *
   * Reversed, it answers the OTHER question — "where do I still have room?" —
   * so it flips the whole list before taking the eight, rather than reading the
   * same eight backwards. The cards you get are different ones.
   */
  const tightestCodes = useMemo(
    () =>
      railRows
        .filter((h) => h.budget > 0)
        .sort((a, b) =>
          headroomMostLeft ? remainingOf(b) - remainingOf(a) : remainingOf(a) - remainingOf(b),
        )
        .slice(0, 8),
    [railRows, headroomMostLeft],
  );

  const toggleDiv = (code: string) =>
    setCollapsedDivs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  // Start every division rolled up so the rail opens as a scannable index of
  // divisions rather than a wall of codes — expand the ones you're working in.
  // Seed once, when the job's data first arrives (railGroups is empty until
  // then); after that the user's toggles own the state, so we don't re-collapse.
  const didSeedCollapse = useRef(false);
  useEffect(() => {
    if (didSeedCollapse.current || railGroups.length === 0) return;
    didSeedCollapse.current = true;
    setCollapsedDivs(new Set(railGroups.map((g) => g.code)));
  }, [railGroups, setCollapsedDivs]);


  /**
   * Splitting Sunset off is a VIEW convenience and nothing more. Every budget
   * figure on the page (rail meters, per-bill chips, remaining, the
   * committed/draft split) reads `data.lines` / `data.bills` in full above, so
   * the split below never changes a number — only which pane a bill is listed
   * in.
   */
  const sunsetDocIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of data?.bills ?? []) if (isSunsetVendor(b.vendor)) s.add(b.id);
    return s;
  }, [data]);

  // The by-bill list, split in two: everything else in the main list, Sunset in
  // its own collapsible pane at the bottom.
  /**
   * The cost code the bill list is narrowed to, or null for the whole month.
   * Set by clicking a ring slice or its legend row — the rings answer "what is
   * this month made of", and the obvious next question is "show me those". It
   * carries a list of CODES rather than one, because the grey "Other" arc
   * stands for every code the ring folded away.
   */
  const [billCodeFilter, setBillCodeFilter] = useState<{
    key: string;
    label: string;
    codes: string[];
    /** The ring slice's own colour, when the pick came from the ring — it is
     *  what ties the banner below to the arc that set it. */
    color?: string;
  } | null>(null);

  /**
   * The month's bills, narrowed to the picked codes. A bill is IN when any of
   * its lines is coded there — reading a code's bills means the whole bill, not
   * the one line that touched it, because the rest of that bill is the context
   * for why it did. Staged recodes count, through `codeOf`, so a line dragged
   * onto the picked code joins the list before Save.
   */
  const filteredBills = useMemo(() => {
    const all = data?.bills ?? [];
    if (!billCodeFilter) return all;
    const want = new Set(billCodeFilter.codes);
    const keep = new Set<string>();
    for (const l of data?.lines ?? []) if (want.has(codeOf(l))) keep.add(l.docId);
    return all.filter((b) => keep.has(b.id));
  }, [data, billCodeFilter, codeOf]);

  /**
   * The cost codes this month's bills actually touch, for the list's own
   * dropdown — the twin of the labor list's "Cost code" select, so the two
   * lists are narrowed the same way. Read off the lines through `codeOf`, so a
   * staged recode moves a bill between options before Save. "" is the uncoded
   * bucket and is offered as its own row, because "which of these is still
   * uncoded" is the question the queue exists for.
   */
  const billCodeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of data?.lines ?? []) {
      const code = codeOf(l);
      if (!seen.has(code)) seen.set(code, headroom.get(code)?.name || l.codeName || "");
    }
    return [...seen.entries()]
      .map(([number, name]) => ({ number, name }))
      .sort((a, b) => (a.number || "\uffff").localeCompare(b.number || "\uffff"));
  }, [data, codeOf, headroom]);

  const nonSunsetBills = useMemo(
    () => filteredBills.filter((b) => !sunsetDocIds.has(b.id)),
    [filteredBills, sunsetDocIds],
  );
  const sunsetBills = useMemo(
    () => filteredBills.filter((b) => sunsetDocIds.has(b.id)),
    [filteredBills, sunsetDocIds],
  );
  /** The two panes read end to end — the order a person works down the page,
   *  and so the order "the next bill" means after an approve. */
  const orderedBills = useMemo(
    () => [...nonSunsetBills, ...sunsetBills],
    [nonSunsetBills, sunsetBills],
  );
  // THE CARD OPENS BESIDE ITS ROW (owner, 2026-09-29). The coding column
  // scrolls with the page, and opening a bill used to scroll back to the
  // column's top — away from the row just clicked. Instead the card is pushed
  // down to the clicked row's height, so it lands next to it and nothing moves.
  const [openTop, setOpenTop] = useState(0);
  useLayoutEffect(() => {
    const row = openDocId ? document.getElementById(`bill-${openDocId}`) : null;
    const col = codingColRef.current;
    setOpenTop(row && col ? Math.max(0, row.getBoundingClientRect().top - col.getBoundingClientRect().top) : 0);
  }, [openDocId, sunsetBlockOpen, orderedBills]);

  // Previous / next through the list, in the order it reads down the page.
  // The new row is scrolled to the top, so the card stays put on screen while
  // the list moves under it.
  const openIndex = orderedBills.findIndex((b) => b.id === openDocId);
  const stepBill = (dir: 1 | -1) => {
    const next = orderedBills[openIndex + dir];
    if (!next) return;
    if (sunsetDocIds.has(next.id)) setSunsetBlockOpen(true);
    driveMainWindowToDoc(jobId, next.id);
    setOpenTimeId(null);
    setOpenDocId(next.id);
    requestAnimationFrame(() =>
      document.getElementById(`bill-${next.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  };

  const sunsetTotal = useMemo(() => sunsetBills.reduce((s, b) => s + b.cost, 0), [sunsetBills]);
  const nonSunsetTotal = useMemo(
    () => nonSunsetBills.reduce((s, b) => s + b.cost, 0),
    [nonSunsetBills],
  );

  // Approving bills — one, or every draft on screen — lives in ./useBillApproval.
  const {
    approveOpen,
    setApproveOpen,
    approving,
    approveMsg,
    setApproveMsg,
    draftBills,
    approvalTarget,
    approveOneBill,
    approveDraftBills,
  } = useBillApproval({ data, dirty, orderedBills, setOpenDocId, load });
  /** Nothing left to approve: the month HAS bills and not one of them is still
   *  a draft. That is the moment the row's action stops being "approve these"
   *  and becomes "create the invoice". A month with no bills at all is not
   *  approved, it is empty — so it keeps the (disabled) Approve button. */
  const allApproved = (data?.bills?.length ?? 0) > 0 && draftBills.length === 0;
  /** Does the bottom action row carry an Approve button? It needs the role AND a
   *  loaded month — the check button beside it needs neither. */
  const showApprove = canApprove && !!data && !loading;
  /** The reconcile banner reads green: an invoice already holds the whole
   *  month, so "Create Invoice in JobTread" would only raise a duplicate. */
  const reconReady = !!recon && reconStatus(recon).good;

  /**
   * What a cost code has left, for the chip on every row. Unlike Labor Review's,
   * this counts DRAFT bills — the board loads them, and a code with open drafts
   * genuinely has less room than that page can see.
   */
  const timeHeadroomFor = useCallback(
    (code: string): CodeHeadroom | null => {
      const h = headroom.get(code);
      return h ? { name: h.name, remaining: h.budget - usedOf(h) } : null;
    },
    [headroom],
  );

  const openBill = data?.bills.find((b) => b.id === openDocId) ?? null;

  // The open bill's Needs review flag and note — ./useBillReview
  const {
    review,
    saveReview,
    setReview,
  } = useBillReview({
    data,
    load,
    openDocId,
  });
  const openLines = openDocId ? (linesByDoc.get(openDocId) ?? []) : [];

  // Tax is staged the same way as edits/staged (keyed by docId, not line id) —
  // nothing writes until Sync. Previewed here so the total/subtotal below move
  // live as the office types, same as bill/[docId]'s tax field.
  const openStoredTax = billTax(openBill);
  const openTaxEdit = openBill ? taxEdits[openBill.id] : undefined;
  const openTaxView =
    openTaxEdit !== undefined && openTaxEdit !== "" ? Number(openTaxEdit) || 0 : openStoredTax;

  /** De-taxed display values + the whole-bill payload for the open bill. */
  const openMath = useMemo(
    () =>
      billLineMath({
        lines: openLines,
        storedTax: openStoredTax,
        legacyTaxField: openBill?.nonRecoverableTax ?? 0,
        taxView: openTaxView,
        status: openBill?.status,
        edits,
        picked: Object.fromEntries(staged),
        budget: data?.budget ?? [],
      }),
    [openLines, openBill, openStoredTax, openTaxView, edits, staged, data],
  );

  // The open bill's line actions: code all, merge, delete, add, buy back — ./useLineEdits
  const {
    addLine,
    addLineMsg,
    addLineSaving,
    addingLine,
    anyCombinable,
    applyCodeToAll,
    bulkCode,
    buybackId,
    buybackLineById,
    canCombine,
    cancelCombine,
    combineCodeSet,
    combineHasEdit,
    combineMsg,
    combineRows,
    combineSelected,
    combining,
    deleteLineById,
    deleteLineMsg,
    deletingLineId,
    isCombinable,
    newLine,
    setAddLineMsg,
    setAddingLine,
    setBulkCode,
    setCombineMsg,
    setCombining,
    setNewLine,
    toggleCombineSel,
  } = useLineEdits({
    data,
    edits,
    leafOf,
    load,
    openBill,
    openDocId,
    openLines,
    openMath,
    openTaxView,
    setCombinePending,
    setEdits,
    setStaged,
    setSyncMsg,
  });

  // ---- filing: which month the bill bills in, and which job it belongs to ---
  // Ported from the bill page's Filing card so a bill can be finished without
  // leaving the board. Both WRITE immediately — they're filing facts read off
  // the document, not "try it and see" coding choices — and both can take the
  // bill off this board entirely, which is why their success is reported in the
  // page-level banner (the drawer they were pressed in is gone by then) and
  // only their errors stay in the card.

  /** True when the open bill carries coding work that hasn't been synced yet. */
  const openBillDirty = openLines.some((l) => staged.has(l.id) || edits[l.id] !== undefined);

  // The open bill's own fields (billing month, due date, type, bill number, job) — ./useBillFields
  const {
    billNumberDraft,
    billNumberSaving,
    dueDateSaving,
    filingMsg,
    monthSaving,
    reassignJob,
    saveBillNumber,
    setBillNumberDraft,
    setBillingMonth,
    setDueDate,
    stageBillType,
  } = useBillFields({
    jobId,
    load,
    openBill,
    openBillDirty,
    openDocId,
    setData,
    setOpenDocId,
    setSyncMsg,
    setTypeEdits,
    startBillMove,
    ym,
  });

  // The open bill's scanned invoice, remembered per bill — ./useBillFiles
  const {
    files,
    filesLoading,
  } = useBillFiles({
    openDocId,
  });

  /**
   * The "by cost code" lanes. Within a lane, lines belonging to the SAME bill
   * collapse into one draggable stack — a bill that split three ways across a
   * code reads as one thing you can move, with a ×3 badge, not three identical
   * chips.
   */
  const laneRows = useMemo(() => {
    const byCode = new Map<string, Map<string, JobBillLine[]>>();
    for (const l of data?.lines ?? []) {
      const code = codeOf(l) || "(uncoded)";
      const lanes = byCode.get(code) ?? new Map<string, JobBillLine[]>();
      const arr = lanes.get(l.docId) ?? [];
      arr.push(l);
      lanes.set(l.docId, arr);
      byCode.set(code, lanes);
    }
    const billById = new Map((data?.bills ?? []).map((b) => [b.id, b]));
    return [...byCode.entries()]
      .map(([code, lanes]) => {
        const all = [...lanes.entries()]
          .map(([docId, ls]) => ({
            key: `${code}/${docId}`,
            docId,
            lines: ls,
            cost: ls.reduce((s, l) => s + l.cost, 0),
            label: billById.get(docId)?.vendor ?? ls[0]?.name ?? "Bill",
            status: billById.get(docId)?.status ?? ls[0]?.billStatus ?? "",
            invoiced: billById.get(docId)?.invoiced ?? false,
          }))
          .sort((a, b) => b.cost - a.cost);
        const total = all.reduce((s, x) => s + x.cost, 0);
        return {
          code,
          h: headroom.get(code),
          stacks: all,
          total,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [data, codeOf, headroom]);

  /**
   * Options for the coding dropdown — every non-labor budget leaf on the job.
   * Labor leaves are filled by time entries, not vendor bills, so they aren't
   * valid coding targets here.
   */
  const codeOptions: Option[] = useMemo(
    () =>
      (data?.budget ?? [])
        .filter((b) => (b.costType ?? "").trim().toLowerCase() !== "labor")
        .map((b) => ({
          id: b.id,
          number: b.number,
          name: b.name,
          detail: b.detail,
          costType: b.costType,
          cost: b.cost,
        })),
    [data],
  );

  const stageLine = useCallback((lineId: string, leafId: string, originalLeafId: string | null) => {
    setStaged((prev) => {
      const next = new Map(prev);
      if (leafId === (originalLeafId ?? "")) next.delete(lineId);
      else next.set(lineId, leafId);
      return next;
    });
    setSyncMsg(null);
  }, []);


  /**
   * The Assistant-local "reviewed" flag — not a JobTread write, so it works
   * regardless of the write gate. Optimistic: the tag flips immediately and the
   * request is best-effort, same as the bill page.
   */
  const toggleReviewed = async (docId: string, reviewed: boolean) => {
    setData((d) =>
      d ? { ...d, bills: d.bills.map((b) => (b.id === docId ? { ...b, reviewed } : b)) } : d,
    );
    try {
      await fetch("/api/bill-reviewed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, reviewed }),
      });
    } catch {
      /* best-effort */
    }
  };

  /**
   * Everything the shared coding card needs, assembled from the state this
   * board already holds. The card's MARKUP lives in BillCodingCard.tsx and is
   * rendered identically by the needs-coding queue — read that file before
   * changing what the card shows.
   */
  const codingCtl: CodingCardCtl = {
    // The board is one job, so its Phase answers for every bill on it.
    // A staged type shows as the bill's type until Save writes it.
    bill: openBill
      ? {
          ...openBill,
          jobPhase: data?.job?.phase ?? "",
          ...(typeEdits[openBill.id] && {
            name: typeEdits[openBill.id],
            qboDocumentType: typeEdits[openBill.id] === "Expense" ? "purchase" : "bill",
          }),
        }
      : openBill,
    lines: openLines,
    math: openMath,
    jobId,
    c,
    writes: Boolean(data?.writesEnabled),
    codeOptions,
    leafOf,
    codeOf,
    stageLine,
    staged,
    // The board's headroom carries labor and this month's drafts as well as
    // committed spend, which is why the card asks for a number rather than
    // computing one from a budget it can't see.
    remainingFor: (code) => {
      const h = headroom.get(code);
      return h ? remainingOf(h) : null;
    },
    bulkCode,
    setBulkCode,
    applyCodeToAll,
    edits,
    // Coding here is STAGED — nothing reaches JobTread until Sync — so a line
    // edit also clears the last sync result, which no longer describes what is
    // on screen.
    setLineEdit: (lineId, patch) => {
      setEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
      setSyncMsg(null);
    },
    taxEdit: openTaxEdit ?? null,
    storedTax: openStoredTax,
    taxView: openTaxView,
    setTax: (v) => {
      if (openBill) setTaxEdits((p) => ({ ...p, [openBill.id]: v }));
    },
    toggleReviewed,
    setDueDate: (d) => void setDueDate(d),
    dueDateSaving,
    setBillType: stageBillType,
    scrollWithPage: true,
    review: {
      flagged: review.flagged,
      note: review.note,
      setNote: (v) => setReview((p) => ({ ...p, note: v })),
      save: (flagged) => void saveReview(flagged),
      saving: review.saving,
      msg: review.msg,
      by: review.by,
      at: review.at,
    },
    approveBill: canApprove ? approveOneBill : undefined,
    approvingBill: approving,
    approveBlocked: dirty ? "Save staged coding changes to JobTread first" : null,
    isCombinable,
    anyCombinable,
    combineSelected,
    toggleCombineSel,
    combineCodeSet,
    combineHasEdit,
    canCombine,
    combining,
    combineRows,
    combineMsg,
    combinePending,
    cancelCombine,
    buybackId,
    buybackLineById,
    deletingLineId,
    deleteLineById,
    deleteLineMsg,
    addingLine,
    setAddingLine,
    newLine,
    setNewLine,
    addLine,
    addLineSaving,
    addLineMsg,
    setAddLineMsg,
    files,
    filesLoading,
    billNumberDraft,
    setBillNumberDraft,
    saveBillNumber,
    billNumberSaving,
    monthOptions: billingMonths(),
    setBillingMonth,
    monthSaving,
    reassignJob,
    reassigning: billMove.isMoving(openDocId ?? ""),
    filingMsg,
  };

  const revertAll = () => {
    setStaged(new Map());
    setTimeStaged(new Map());
    setTimeEdits({});
    setTimeSelected(new Set());
    setEdits({});
    setTaxEdits({});
    setTypeEdits({});
    setCombinePending(null);
    setCombineMsg("");
    setSyncMsg(null);
    setRestoreMsg(null);
    // Revert is the one place the office says "I don't want this work" — so it
    // throws the saved draft away too, on every device. Everything else keeps it.
    if (draftKey) discardDraft(draftKey);
  };


  // Which bills and hours make up a cost code's total: the drill-down and the ring hover cards — ./useCodeDrill
  const {
    codeDrill,
    contributorsError,
    contributorsLoading,
    donutDetail,
    drillBills,
    drillTime,
    ensureContributors,
    openCodeDrill,
    setCodeDrill,
  } = useCodeDrill({
    codeOf,
    data,
    jobId,
    leafById,
    staged,
    timeCodeOf,
  });

  // Drag a line or a whole bill onto a cost code — ./useLineDrag
  const {
    beginDrag,
    dragLineIds,
    dragOverCode,
    dropHandlers,
    endDrag,
    leafPicker,
    moveLinesToLeaf,
    setLeafPicker,
  } = useLineDrag({
    data,
    leavesByCode,
    setStaged,
    setSyncMsg,
  });

  // ---- save ---------------------------------------------------------------
  /**
   * Write staged coding to JobTread. THAT IS ALL IT DOES.
   *
   * It used to push the month into the Google tracking sheet in the same step.
   * The sheet push is a long Apps Script round trip against a document the
   * office also edits by hand, so riding it on every save meant a one-line
   * recode rewrote the whole sheet. It is its own button now — "Sync to
   * Tracking Sheet", in the closing row here and on the bill page.
   */
  // Save — the board's JobTread write loop — lives in ./saveCoding.
  const save = () =>
    saveCoding({
      data,
      dirty,
      setSyncing,
      setSyncMsg,
      staged,
      edits,
      linesByDoc,
      billTax,
      timeStaged,
      timeEdits,
      typeEdits,
      taxEdits,
      combinePending,
      setCombining,
      setCombineMsg,
      setCombinePending,
      setRestoreMsg,
      draftKey,
      load,
      restoreStartedRef,
      autosaveArmedRef,
    });


  /**
   * Is the pointer ON the commit bar? On desktop the month's three closing
   * actions ride in that bar and stay hidden until it is — three buttons parked
   * over the workbench all session read as a banner, not as a foot. A
   * proximity box was tried first and fired on a cursor merely crossing the
   * corner; the bar itself is the target, so the bar's own hover is the test.
   * Touch has no pointer, so below lg those actions keep their own row under
   * the columns and this flag is never consulted.
   *
   * It sits above the no-job guard below because a hook after an early
   * return runs on some renders and not others, which is the one thing React
   * forbids.
   */
  const [barHover, setBarHover] = useState(false);

  // Defensive only: ClientInvoicing.tsx routes the no-job case to <AllJobs />
  // before this component ever mounts, so this is the guard for a direct render,
  // not a state the office can reach.
  if (!jobId) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <PageHeader title={c("page.recode.title")} />
        <EmptyState>
          {c("recode.empty.noJob")}{" "}
          <Link href="/trackingsheet" className="text-accent underline">
            {c("recode.empty.noJobLink")}
          </Link>
          .
        </EmptyState>
      </main>
    );
  }

  // Still needed by the approve-confirmation dialog below: a modal covers the
  // header, so the dialog has to name the job it is about to act on itself.
  const jobTitle = data?.job?.name ?? "";
  // The page title is the job in context — "Customer - Job" once loaded, falling
  // back to the generic page name before data arrives (or if the job carries no
  // customer). It's the JOB PICKER's closed state now: the title names the job,
  // so the title is the control that changes it. This string is only what the
  // picker reads until the jobs list resolves the same job for itself.
  const customerName = data?.job?.customer ?? "";
  const headerTitle = jobTitle
    ? customerName
      ? `${customerName} - ${jobTitle}`
      : jobTitle
    : c("page.recode.title");
  // Where the job IS, under the title. It rode in the app header while the
  // picker did; both belong to the page whose subject is one job.
  const headerAddress = data?.job ? jobAddress(data.job) : "";

  // Switching jobs stays on Tracking Sheets — same page, new subject. Empty id
  // is the "All jobs" row, which is this route with no ?jobId. `replace`, not
  // push: it's a change of subject, not a step deeper. The staged-coding guard
  // has to be asked by hand — a router call isn't an anchor click it can catch.
  /**
   * The billing month, as a control. It renders TWICE and only ever one of the
   * two is visible: inline beside the page title on a phone (the title line has
   * room to its right and the month is the control changed most often here), and
   * in the desktop toolbar from lg up, where the row has space for it. CSS can
   * hide a box but it cannot move one between two parents, so the alternative
   * was a single select in the wrong place at one width or the other. Only the
   * desktop copy carries the id, since two elements cannot share one.
   */
  const monthSelect = (cls: string, id?: string) => (
    <Select
      id={id}
      value={ym}
      onChange={(e) => {
        setYm(e.target.value);
        // Into the address too, so the workspace tabs carry the month.
        setUrlParam("ym", e.target.value);
      }}
      className={cls}
      aria-label="Billing month"
    >
      {billingMonths().map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );

  const onPickJob = (id: string) => {
    if (id === jobId) return;
    if (!confirmLeaveIfDirty()) return;
    // The month rides along, so switching jobs keeps you in the billing period
    // you were reading rather than snapping back to the current one.
    const month = `ym=${encodeURIComponent(ym)}`;
    router.replace(
      id ? `/trackingsheet?jobId=${encodeURIComponent(id)}&${month}` : `/trackingsheet?${month}`,
    );
  };

  // One bill's card, shared by the main by-bill list and the Sunset pane — both
  // render exactly the same row, so the drag, drawer and detail-link behaviour
  // stays identical whichever list a bill sits in.
  const renderBillCard = (b: BillRef) => {
    const lines = linesByDoc.get(b.id) ?? [];
    const codes = new Map<string, number>();
    let movedHere = 0;
    for (const l of lines) {
      const c = codeOf(l);
      codes.set(c, (codes.get(c) ?? 0) + l.cost);
      if (staged.has(l.id)) movedHere++;
    }
    const isOpen = openDocId === b.id;
    const stripe = billInvoiceState(b);
    // On a phone this page is read-only and the coding drawer is
    // hidden, so a tapped bill opens its full detail page instead of
    // the (invisible) drawer. `from=recode` + `ym` + the `#bill-…`
    // anchor let its back arrow return to this exact spot.
    const openBillDetail = () =>
      router.push(
        `/bill/${b.id}?jobId=${encodeURIComponent(jobId)}&from=recode` +
          `&ym=${encodeURIComponent(ym)}`,
      );
    // Ordinary state — what stage the bill is at, whether it's paid, whether
    // anyone has been through it — reads as one quiet line of text. It used to
    // be six or seven coloured pills per bill, and once "uninvoiced" (the
    // normal case, on most rows) shouted as loudly as "needs review", none of
    // them meant anything at scrolling speed. A chip is spent below only on the
    // exceptions.
    const meta: string[] = [];
    if (b.status === "draft") meta.push("draft");
    else meta.push(b.invoiced ? "invoiced" : "uninvoiced");
    if (billPaidState(b) === "paid") meta.push("paid");
    else if (billPaidState(b) === "partial") meta.push("part paid");
    if (b.reviewed) meta.push("✓ reviewed");
    else if (b.saved) meta.push("✓ saved");

    return (
      <li key={b.id} id={`bill-${b.id}`} className="scroll-mt-20">
        {/* A ROW of the month's one bill card, not a card of its own. Thirty
            bills used to draw thirty rectangles with a gap between each pair;
            they are divided by a hairline now, and the open row is marked by a
            tint rather than a ring, so the list reads as one list. */}
        <div
          draggable={lines.length > 0 && !b.invoiced}
          onDragStart={beginDrag(lines.map((l) => l.id))}
          onDragEnd={endDrag}
          className={`flex items-stretch transition ${isOpen ? "bg-accent/10" : ""} ${
            lines.length > 0 && !b.invoiced ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          {/* Invoicing lifecycle as an edge stripe, so a month can be
              triaged by colour down the left margin before a word is
              read: wide red = flagged for review, green = out of draft
              and on an invoice, thin red = an invoice exists for the
              month and this bill is NOT on it, blue = out of draft,
              reviewed, and no invoice raised yet. ONE axis only — see
              billInvoiceState. Budget headroom, coding progress and
              paid state are chips on the row, not stripe colours. */}
          <span
            aria-hidden
            className={`shrink-0 ${stripe === "needs-review" ? "w-1" : "w-0.5"} ${
              BILL_STRIPE_COLOR[stripe]
            }`}
          />
          <button
            type="button"
            onClick={() => {
              // Side-panel dual navigation — see the note on the
              // cost-code lane's chips above.
              // belowXl, not isMobile. The coding column is `xl:block`, so
              // between lg and xl (a small laptop, a split window, the Chrome
              // side panel) `setOpenDocId` used to select a bill and render its
              // card NOWHERE — the row tinted and nothing else happened. Sending
              // that band to /bill costs nothing now: the bill page shows the
              // SAME BillCodingCard this column would have.
              if (belowXl || !isOpen) driveMainWindowToDoc(jobId, b.id);
              if (belowXl) openBillDetail();
              else {
                setOpenTimeId(null);
                setOpenDocId(isOpen ? null : b.id);
              }
            }}
            aria-expanded={belowXl ? undefined : isOpen}
            className="min-w-0 flex-1 px-3 py-2.5 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
          >
            {/* Vendor and amount own the first line; the status
                badges get their own wrapping line below. Inline,
                they sat inside the same `truncate` span as the
                vendor name, so on a phone a long vendor simply
                clipped them off — the "No file" and "invoiced"
                flags were invisible exactly where they matter
                most. */}
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-semibold">{b.label}</span>
              <span className="shrink-0 text-base font-semibold tabular-nums">{money(b.cost)}</span>
            </span>

            {/* Ordinary state as quiet text; a chip only where something is
                actually wrong or waiting. */}
            <MetaLine
              className="mt-1"
              items={[
                b.needsReview && (
                  <Chip
                    key="flag"
                    tone="danger"
                    title="Flagged for a billing correction — open the bill to see the note"
                  >
                    ⚑ Needs review
                  </Chip>
                ),
                b.fileCount === 0 && (
                  <Chip
                    key="nofile"
                    tone="warning"
                    title="No file attached to this bill in JobTread"
                  >
                    No file
                  </Chip>
                ),
                movedHere > 0 && (
                  <Chip key="moved" tone="warning">
                    {movedHere} moved
                  </Chip>
                ),
                ...meta,
              ]}
            />

            {/* What this bill is charging, and where. One line of quiet
                figures: each code used to be a filled box carrying its amount
                AND its remaining headroom, which on a four-code bill was four
                boxes of nine words — the headroom is what the rail beside this
                list and the headroom strip above it are FOR. Over-budget codes
                still turn red here, so the warning survives the diet. */}
            {codes.size > 0 && (
              <span className="mt-1 block line-clamp-2 text-[11.5px] tabular-nums text-neutral-500 dark:text-neutral-400">
                {[...codes.entries()]
                  .sort((x, y) => y[1] - x[1])
                  .map(([code, amt], i) => {
                    const h = headroom.get(code);
                    const over = !!h && remainingOf(h) < 0;
                    return (
                      <span key={code}>
                        {i > 0 && (
                          <span aria-hidden className="text-neutral-300 dark:text-neutral-600">
                            {"  ·  "}
                          </span>
                        )}
                        <span
                          className={over ? "font-semibold text-red-600 dark:text-red-400" : ""}
                          title={
                            h
                              ? `${h.name} — ${money(remainingOf(h))} remaining`
                              : "No budget line for this code"
                          }
                        >
                          {code || "uncoded"}
                          {h?.name ? (
                            <span className="font-normal normal-nums"> {h.name}</span>
                          ) : null}{" "}
                          {money0(amt)}
                        </span>
                      </span>
                    );
                  })}
              </span>
            )}
          </button>
          {/* Outside the button — a link nested in a button is
              invalid, and clicking it would also toggle the card.
              The dragstart guard stops the browser dragging the
              anchor itself, which would hijack the card's drag. */}
          <span
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="flex shrink-0 items-start"
          >
            <JtLink
              href={`https://app.jobtread.com/jobs/${jobId}/documents/${b.id}`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-xs font-semibold text-neutral-400 transition hover:text-accent dark:text-neutral-500"
            >
              JT ↗
            </JtLink>
          </span>
        </div>
      </li>
    );
  };

  /**
   * The per-job Tracking Sheet action, for the action bar. It writes the
   * selected month's sub/vendor invoices into this job's own Google tracking
   * sheet. With no sheet linked it instead links to the Tracking Sheet page to
   * connect one (the URL lives on the Projects sheet — no in-app write for it).
   * Rendered nothing until we've read whether the job has a sheet, so the label
   * is never wrong. `cls` carries whatever width the row it sits in wants.
   */
  const trackingSheetAction = (cls: string) => {
    if (!canTrack || !trackingChecked) return null;
    if (trackingTarget) {
      return (
        <Button
          variant="secondary"
          className={cls}
          disabled={syncing || trackingBusy}
          // The sheet reads costCode off the bill lines IN JOBTREAD, so staged
          // coding that has not been saved simply will not appear in it. Said
          // here rather than blocking the push: refreshing the sheet from what
          // JobTread holds today is still a legitimate thing to want.
          title={
            dirty
              ? `Push ${monthLabel(ym)} into ${trackingTarget.label} — your ${stagedCount} staged change${stagedCount === 1 ? "" : "s"} are not saved yet, so the sheet won't show them`
              : `Push ${monthLabel(ym)} into ${trackingTarget.label}`
          }
          onClick={() => {
            const [y, m] = ym.split("-").map(Number);
            runTrackingSync(trackingTarget.projectId, m, y, setTrackingSync);
          }}
        >
          {trackingBusy ? "Syncing sheet…" : "Sync to Tracking Sheet"}
        </Button>
      );
    }
    return (
      <Link
        href={`/tracking-sheet?jobId=${encodeURIComponent(jobId)}&ym=${ym}`}
        className={btn("secondary", "md", `text-center ${cls}`)}
      >
        Link Google tracking sheet
      </Link>
    );
  };

  /**
   * The month's three closing actions, in the order you do them: check the job,
   * push the sheet, approve the drafts. ONE definition, rendered in two places
   * — its own centred row under the columns on touch, and inside the commit bar
   * on desktop, where it appears only as the pointer reaches that corner.
   *
   * The check wears the same secondary style as the sheet push, because both
   * are things you run and read; Approve stays primary — it is the one that
   * ends the month. The standalone sheet push only appears with NOTHING staged,
   * because Save Changes already runs it as part of the same commit.
   */
  const closingActions = (
    <>
      <Button
        variant="secondary"
        onClick={runPreSend}
        disabled={preSendRunning}
        className="min-h-11"
      >
        {preSendRunning ? "Checking…" : preSend ? "Check again" : "Check this job"}
      </Button>
      {trackingSheetAction("min-h-11")}
      <Button
        variant="secondary"
        className="min-h-11"
        title={`Add the client to the Document Access list on every ${monthLabel(ym)} bill`}
        onClick={() => setAccessOpen(true)}
      >
        Give Document Access
      </Button>
      {showApprove &&
        (allApproved ? (
          /* Every bill is approved, so the next step is JobTread's own invoice
             builder — New → Customer Invoice on the job's documents page pulls
             exactly these uninvoiced bills. Staged coding still blocks it: an
             invoice built now would carry the OLD cost codes, so save first. A
             disabled <a> is not a thing, hence the button/link swap. Hidden
             entirely once the reconcile banner above is already green — an
             invoice exists and holds the whole month, so this would only raise a
             duplicate one; the banner's own "Open invoice" link is the way in
             from here. */
          reconReady ? null : dirty ? (
            <Button
              disabled
              title="Save staged coding changes to JobTread first"
              className="min-h-11"
            >
              Create Invoice in JobTread ↗
            </Button>
          ) : (
            <JtLink
              href={`https://app.jobtread.com/jobs/${jobId}/documents`}
              className={btn("primary", "md", "min-h-11")}
            >
              Create Invoice in JobTread ↗
            </JtLink>
          )
        ) : (
          <Button
            onClick={() => {
              setApproveMsg(null);
              setApproveOpen(true);
            }}
            disabled={draftBills.length === 0 || dirty || syncing || approving}
            title={dirty ? "Save staged coding changes to JobTread first" : undefined}
            className="min-h-11"
          >
            Approve Draft Bills{draftBills.length > 0 ? ` (${draftBills.length})` : ""}
          </Button>
        ))}
    </>
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 lg:max-w-[110rem]">
      {/* The title IS the picker — this page's subject is one job, so the name
          of the job and the control that changes it are the same thing. The
          address is INSIDE the title slot, not the header's `description`: the
          toolbar wraps below the title on a phone, so a description would print
          the address under the whole toolbar instead of under the job it
          names. */}
      <PageHeader
        titleSlot={
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <JobPicker
                variant="title"
                value={jobId}
                onChange={onPickJob}
                fallbackLabel={headerTitle}
                allLabel="All jobs"
                allDescription="Every job's month, side by side"
                showPhaseFilter
                showToBeInvoiced={can("recode")}
              />
              {/* The month, in the empty half of the title line — it used to
                  take a labelled full-width row of its own under the address,
                  which is a lot of phone for one word and a year. The width is
                  on the WRAPPER: `inputCls` carries `w-full`, which Tailwind
                  emits after any fixed width, so a `w-[8.5rem]` on the select
                  itself would silently lose. */}
              <div className="w-[8.5rem] shrink-0 lg:hidden">{monthSelect("!h-11")}</div>
            </div>
            {headerAddress && (
              <p className="mt-1 truncate text-sm text-neutral-500 dark:text-neutral-400">
                {headerAddress}
              </p>
            )}
          </div>
        }
        actionsClassName="w-full min-w-0 items-center lg:w-auto"
        actions={
          // The toolbar carries the month and nothing else. Revert, Save
          // Changes and the staged-change count moved to the docked action bar
          // at the foot of the screen, which is now rendered at EVERY width:
          // the commit belongs where the coding happens, and the top of the
          // page is the one place you are not looking after dragging a line.
          <div className="flex w-full min-w-0 flex-col gap-3 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
            {/* The desktop copy of the month, and under it the month's other
                destination. Stacked rather than side by side: the month is what
                this page is scoped to, and the package is that same month read
                across every job — a step out, not a second control. */}
            <div className="flex w-full min-w-0 flex-col gap-1.5 lg:w-52">
              {monthSelect("hidden lg:block w-full", "recode-month")}
              {canPackage && (
                <Link
                  href={`/invoicing-summary?ym=${ym}`}
                  onClick={(e) => {
                    if (!confirmLeaveIfDirty()) e.preventDefault();
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-line px-3 text-xs font-semibold text-neutral-500 transition hover:border-accent hover:text-accent dark:text-neutral-400 lg:min-h-0 lg:py-1.5"
                >
                  Invoicing Package
                  <span aria-hidden className="text-[10px]">
                    →
                  </span>
                </Link>
              )}
            </div>
          </div>
        }
      />

      {/* The month's headline figure — the one number worth reading from arm's
          length, so on a phone it comes FIRST, directly under the address, with
          the budget folded in under it. From lg up it heads the bills column
          instead, where the eye already starts. It renders on each side of that
          breakpoint because CSS can hide a box but cannot move one between two
          parents; it is a pure read of `recon`, so two mounts cost nothing.

          No accent rule over it — the page header's own brand hairline is a few
          lines up, and a second one read as a stray divider between the two. The
          `sub` line carries the split that matters at invoicing time: JobTread
          won't pull a draft onto an invoice, so the figure is what the month
          WILL bill and the approved half is what it can bill today. */}
      <StatementBlock
        rule={false}
        className="mb-4 lg:hidden"
        label={c("recode.statement.toBeInvoiced")}
        value={recon ? money(recon.remaining + recon.draftBillsCost) : "—"}
        sub={
          recon
            ? `${money(recon.remaining)} approved${
                recon.draftBillCount > 0
                  ? ` · ${money(recon.draftBillsCost)} in ${recon.draftBillCount} draft${
                      recon.draftBillCount === 1 ? "" : "s"
                    }`
                  : ""
              }`
            : "checking JobTread…"
        }
      />

      {/* This job's ingested bills that never reached JobTread — the green
          "all in JobTread" all-clear, or the amber "Not in JobTread" queue.
          Under the month's figure, which is the one thing asked to come first;
          this is the next, because the figure is only true if nothing is
          stranded outside JobTread. They're absent from every
          figure on this page (budget rail, "to be invoiced", coding queue)
          because none of it is in JobTread yet. Scoped to this job; the all-jobs
          view lists the rest. Renders nothing when the queue is empty. */}
      {jobId && !loading && <UncapturedBills jobId={jobId} />}

      {data && !data.writesEnabled && (
        <p className="mb-4 text-[11px] text-amber-600 dark:text-amber-400">
          Writes are disabled on this deployment — Sync will preview only.
        </p>
      )}

      {/* Unsynced work came back. Said out loud rather than restored silently:
          the figures on this page now include coding JobTread doesn't have yet,
          and that has to be visible the moment you land. Revert is one tap
          away in the toolbar and the sticky bar. */}
      {restoreMsg && (
        <Banner tone="info" className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Restored {restoreMsg.kept} unsynced coding change
              {restoreMsg.kept === 1 ? "" : "s"} from {draftSavedAtLabel(restoreMsg.savedAt)}
              {restoreMsg.dropped > 0 && (
                <> · {restoreMsg.dropped} no longer applied and were dropped</>
              )}
              . Nothing is in JobTread until you press Sync.
            </span>
            <button
              type="button"
              onClick={() => setRestoreMsg(null)}
              className="shrink-0 text-xs underline underline-offset-2 opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        </Banner>
      )}

      {syncMsg && (
        <Banner tone={syncMsg.tone} className="mb-4">
          {syncMsg.text}
        </Banner>
      )}
      {approveMsg && (
        <Banner tone={approveMsg.tone} className="mb-4">
          {approveMsg.text}
        </Banner>
      )}
      {trackingSync && (
        <div className="mb-4">
          {(trackingSync.status === "queued" || trackingSync.status === "running") && (
            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
              <Spinner />
              {trackingSync.status === "queued"
                ? "Queued for the Tracking Sheet…"
                : "Syncing to the Tracking Sheet…"}
            </div>
          )}
          {trackingSync.status === "error" && (
            <Banner tone="error" className="!py-2 text-xs">
              Tracking Sheet: {trackingSync.error}
            </Banner>
          )}
          {trackingSync.status === "done" && trackingSync.result && (
            <>
              <p className="text-xs text-neutral-500">
                Tracking Sheet: wrote{" "}
                <span className="font-semibold">{trackingSync.result.rowCount}</span> row
                {trackingSync.result.rowCount === 1 ? "" : "s"} ·{" "}
                <span className="font-semibold">{money(trackingSync.result.total)}</span> ·{" "}
                <a
                  href={trackingSync.result.trackingSheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-accent"
                >
                  {trackingSync.result.trackingSheetName}
                </a>
              </p>
              <TrackingSheetRisks
                unmatched={trackingSync.result.unmatched}
                deadColumns={trackingSync.result.deadColumns}
                compact
                className="mt-1.5 !py-2"
              />
            </>
          )}
        </div>
      )}
      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading && <Loading label={c("recode.loading.billsAndBudget")} />}

      {/* A refresh keeps the board where it is and says so quietly here. */}
      {refreshing && (
        <MetaLine
          className="mb-2"
          items={[
            <>
              <Spinner /> Refreshing…
            </>,
          ]}
        />
      )}

      {/* What this month is worth, and whether JobTread is ready to bill it.
          Same endpoint and same rectangle the Invoicing page uses, so the two
          pages can't drift.

          The HEADLINE is everything the month will bill — invoiceable now PLUS
          bills still sitting in draft — because that's the figure you're working
          toward while coding. JobTread's own `remaining` excludes drafts (it
          won't pull a draft onto an invoice), which on a fully-draft month reads
          as $0.00 and looks broken next to an "Include drafts" toggle that's
          switched on. That distinction is real and still shown, but demoted to
          one line describing the state of JobTread rather than driving the
          number. */}
      {/* `order-last` (not a DOM move) is what drops this BELOW the bills list
          on a phone — where it's the last thing on screen, since the coding
          drawer is xl-only — while leaving it above the columns from lg up,
          exactly as before. It works because <main> is a flex column; the
          modals below are `fixed`, so they're out of flow and unaffected. */}
      {jobId && !loading && (
        <div className="order-last mt-4 lg:order-none lg:mb-4 lg:mt-0">
          <InvoiceReconcile jobId={jobId} ym={ym} onData={setRecon} />
        </div>
      )}

      {/* `lg:order-1` pushes the whole workbench BELOW the month's closing-action
          row, which is DOM-later — so on desktop those buttons read directly
          under the "to be invoiced" figures instead of a full workbench away at
          the foot of the page. Nothing moves on a phone: the row is `order-last`
          there and this class starts at lg. */}
      {data && !loading && (
        <SplitGrid
          className={`lg:order-1 ${
            railHidden ? "lg:grid-cols-[3.5rem_minmax(0,1fr)]" : "lg:grid-cols-2"
          }`}
          hideFirst={railHidden}
        >
          <BudgetRail
            budgetByCode={budgetByCode}
            c={c}
            canSheetGap={canSheetGap}
            codeQuery={codeQuery}
            collapsedDivs={collapsedDivs}
            dragLineIds={dragLineIds}
            dragOverCode={dragOverCode}
            dropHandlers={dropHandlers}
            headroomMostLeft={headroomMostLeft}
            jobId={jobId}
            openCodeDrill={openCodeDrill}
            railCollapsed={railCollapsed}
            railGroups={railGroups}
            railHidden={railHidden}
            railRows={railRows}
            setCodeQuery={setCodeQuery}
            setCollapsedDivs={setCollapsedDivs}
            setHeadroomMostLeft={setHeadroomMostLeft}
            setRailCollapsed={setRailCollapsed}
            tightestCodes={tightestCodes}
            toggleDiv={toggleDiv}
            toggleRailHidden={toggleRailHidden}
            trackingTarget={trackingTarget}
          />

          {/* ─────────── CENTRE: the month's bills ─────────── */}
          <section className="min-w-0">
            {/* The desktop copy of the headline figure — see the mobile one
                under the page header for why there are two. */}
            <StatementBlock
              rule={false}
              className="mb-4 hidden lg:block"
              label={c("recode.statement.toBeInvoiced")}
              value={recon ? money(recon.remaining + recon.draftBillsCost) : "—"}
              sub={
                recon
                  ? `${money(recon.remaining)} approved${
                      recon.draftBillCount > 0
                        ? ` · ${money(recon.draftBillsCost)} in ${recon.draftBillCount} draft${
                            recon.draftBillCount === 1 ? "" : "s"
                          }`
                        : ""
                    }`
                  : "checking JobTread…"
              }
            />

            {/* Where the money went, by cost code — bills in one ring, labor in
                the other. Opens on the SELECTED MONTH, which is what this page
                is for; the caption switches it to the whole job. It heads the
                bills column because that is where the eye starts, and because
                it frames the list under it: the rail answers "is there room in
                06 20 00", these answer "what is this month made of". Folded on
                a phone, open from lg. */}
            <CostDonuts
              month={costDonutMonthRows}
              jobToDate={costDonutRows}
              monthLabel={monthLabel(ym)}
              detail={donutDetail}
              // Clicking a slice narrows the list under it. The rings say what
              // the month is made of; this is the way from that answer into the
              // bills behind it.
              onSelect={setBillCodeFilter}
              selectedKey={billCodeFilter?.key ?? null}
              // …and the labor ring narrows the LABOR list, through the same
              // code filter its own dropdown sets. Opening the block is part of
              // the click: a filter applied to a folded list is a click that
              // appears to do nothing.
              onSelectLabor={(sel) => {
                timeFilters.setCode(sel?.codes[0] ?? "");
                if (sel) setTimeBlockOpen(true);
              }}
              selectedLaborKey={timeFilters.code || null}
              // The job-scope card needs the whole-job contributors; the month
              // scope needs nothing. Fetching on first hover keeps a page load
              // that never touches the rings free of it.
              onDetailWanted={(scope) => {
                if (scope === "job") ensureContributors();
              }}
            />

            {/* THE LISTS' OWN ROW — what is being filtered on the left, how the
                bills are arranged on the right.

                It used to carry "17 bills · $64,293.88" under a brand rule, and
                that line said nothing the three block headers below do not say
                better and per-block. What the spot is FOR is the thing there is
                no other room for: a filter that silently drops two thirds of
                the month off the page. */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              {billCodeFilter ? (
                <button
                  type="button"
                  onClick={() => setBillCodeFilter(null)}
                  title="Clear this cost-code filter"
                  className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-accent bg-accent/10 py-1.5 pl-2.5 pr-2 text-left transition hover:bg-accent/20"
                >
                  {/* The arc's own colour, so the banner and the slice that set
                      it are visibly the same thing. Falls back to the accent
                      when the pick came from the dropdown instead. */}
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: billCodeFilter.color ?? "var(--accent)" }}
                  />
                  <span className="min-w-0 truncate">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                      Filtered to
                    </span>{" "}
                    <span className="text-sm font-semibold">{billCodeFilter.label}</span>
                    <span className="ml-2 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      {filteredBills.length} of {data.bills.length} bill
                      {data.bills.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-sm font-semibold text-neutral-500 dark:text-neutral-400"
                  >
                    ✕
                  </span>
                </button>
              ) : (
                <span />
              )}
              {
                /* Grouping switch, as a segmented control: one soft-filled track
                 so the three options read as a set, with 44px-tall segments on
                 touch (they were 26px) and the desktop density restored at
                 lg. Filled rather than bordered — the same trade the quiet
                 fields make, and one less rectangle beside the heading. */
                <div className="flex shrink-0 gap-1 rounded-lg bg-neutral-100 p-0.5 text-xs dark:bg-white/[0.07] lg:bg-transparent lg:p-0 lg:dark:bg-transparent">
                  {(
                    [
                      ["bill", "By bill"],
                      ["code", "By cost code"],
                      // The client-facing rollup — what the month bills, in the
                      // shape the customer sees it, and the source of the printed
                      // summary. Not a drag surface.
                      ["summary", "Summary"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      aria-pressed={mode === m}
                      className={`inline-flex min-h-10 items-center rounded-md px-2.5 transition lg:min-h-0 lg:py-1 ${
                        mode === m
                          ? "bg-accent text-accent-fg font-semibold"
                          : "text-neutral-500 hover:text-accent dark:text-neutral-400"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
            </div>

            {/* ---- this month's time entries ----
                Not a drop target: a time entry is coded independently of any
                bill, and this board's drag only moves bill lines. Everything
                else about it is Labor Review's list, because it IS Labor
                Review's list — src/components/TimeEntryList, the same component
                that page renders. Tick rows to recode a week of them together
                (the drawer takes the coding column, where a bill is coded, so
                there's no second layout to learn); tap a row to fix its hours,
                day, code or job without leaving the month. ---- */}
            {mode !== "summary" && (
              <Card pad={false} className="mb-2 overflow-hidden">
                {/* The header is a ROW, not one button: the chevron toggles the
                    list and "Add time" opens the dialog, and a button inside a
                    button is invalid markup (the inner click would also fire the
                    outer one). The block itself now renders even with no entries
                    — a month with no labor logged is exactly when the office
                    needs the Add time link. */}
                <div className="flex w-full items-baseline gap-2 px-3 py-3 lg:py-2">
                  <button
                    type="button"
                    onClick={() => setTimeBlockOpen((v) => !v)}
                    aria-expanded={timeBlockOpen}
                    disabled={monthTime.length === 0}
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold transition hover:text-accent disabled:cursor-default disabled:hover:text-inherit"
                  >
                    <span
                      aria-hidden
                      className={`mr-1.5 inline-block text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${
                        timeBlockOpen ? "rotate-90" : ""
                      } ${monthTime.length === 0 ? "opacity-0" : ""}`}
                    >
                      ▶
                    </span>
                    Labor ({monthTime.length} {monthTime.length === 1 ? "entry" : "entries"})
                  </button>
                  {/* Logging FOR somebody — /employee-time can only log for the
                      person signed in, so the office does it here. */}
                  <button
                    type="button"
                    onClick={() => setAddTimeOpen(true)}
                    className="shrink-0 text-xs font-semibold text-accent transition hover:underline"
                  >
                    + Add time
                  </button>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {money(monthTimeTotal)} · {hoursLabel(monthTimeHours)}
                  </span>
                </div>
                {/* The month's COMPANY-WIDE Labor Report used to sit here, on
                    its own hairline row. It takes only the month and reports
                    EVERY job's hours, so a job workbench was the wrong host for
                    it — it now sits with the other company-wide tools on the
                    all-jobs view (AllJobs.tsx), beside the Drive sync. */}
                {timeBlockOpen && monthTime.length > 0 && (
                  <>
                    {/* The list, its filters and its grouping are the SAME
                        component Labor Review renders — see
                        src/components/TimeEntryList. The CHECKBOX selects rows
                        for the coding column's bulk recode; the ROW opens the
                        single-entry editor (hours, day, code, job, approve),
                        which is this board's own affordance and the reason a
                        correction no longer means leaving the month. */}
                    <TimeEntryList
                      filters={timeFilters}
                      jobId={jobId}
                      monthEntries={monthTime}
                      codeOf={timeCodeOf}
                      headroomFor={timeHeadroomFor}
                      // "Changed", not only "moved": a staged hours or pay-type
                      // correction is staged work the Save will write, and a row
                      // that shows nothing looks like it was never touched.
                      isMoved={(t) => timeTouched.has(t.id)}
                      selected={timeSelected}
                      onSelectedChange={setTimeSelected}
                      onFlag={(id, flagged) => void toggleTimeFlag(id, flagged)}
                      onEdit={(id) => {
                        setOpenDocId(null);
                        setOpenTimeId((cur) => (cur === id ? null : id));
                      }}
                      editingId={openTimeId}
                    />
                    {/* BELOW xl the coding column isn't rendered, so the recode
                        drawer sits inline under the rows it acts on. Not a
                        modal: a sheet that opened on the first tick would cover
                        the list you are still selecting from. */}
                    {belowXl && timeSelectedEntries.length > 0 && (
                      <div className="border-t border-line-soft p-3">
                        <div className="mb-2 flex items-baseline justify-between gap-2">
                          <SectionLabel>Recode time</SectionLabel>
                          <button
                            type="button"
                            onClick={() => setTimeSelected(new Set())}
                            className="shrink-0 text-[11px] font-semibold text-accent"
                          >
                            Clear selection
                          </button>
                        </div>
                        <TimeRecodeCard
                          entries={timeSelectedEntries}
                          jobId={jobId}
                          codeOptions={timeCodeOptions}
                          leafOf={timeLeafOf}
                          onPick={stageTimeSelection}
                          typeOf={timeTypeOf}
                          onPickRate={stageTimeType}
                          isStaged={(t) => timeStaged.has(t.id)}
                          onUndo={undoTimeStage}
                          onApproved={markTimeApproved}
                          writes={Boolean(data?.writesEnabled)}
                        />
                      </div>
                    )}

                    {/* Labor Review shows the same list against a whole-job
                        budget rail and a "cost codes in view" readout — the
                        wider view of the same work, not a different tool. */}
                    {canLaborReview && (
                      <Link
                        href={`/labor-review?jobId=${encodeURIComponent(jobId)}&ym=${ym}`}
                        className="block border-t border-line-soft px-3 py-2.5 text-xs font-semibold text-accent transition hover:bg-accent/5 dark:border-neutral-800 dark:hover:bg-white/5"
                      >
                        Open this month in Labor Review →
                      </Link>
                    )}
                  </>
                )}
              </Card>
            )}

            <BillingSummaryView
              c={c}
              jobId={jobId}
              mode={mode}
              recon={recon}
              setSummaryByCsi={setSummaryByCsi}
              summary={summary}
              summaryByCsi={summaryByCsi}
              summaryError={summaryError}
              summaryLoading={summaryLoading}
              ym={ym}
            />

            <CodeLanesView
              beginDrag={beginDrag}
              belowXl={belowXl}
              c={c}
              dragLineIds={dragLineIds}
              dragOverCode={dragOverCode}
              dropHandlers={dropHandlers}
              endDrag={endDrag}
              jobId={jobId}
              laneRows={laneRows}
              mode={mode}
              router={router}
              setOpenDocId={setOpenDocId}
              setOpenTimeId={setOpenTimeId}
              staged={staged}
              ym={ym}
            />

            <BillListView
              billBlockOpen={billBlockOpen}
              billCodeFilter={billCodeFilter}
              billCodeOptions={billCodeOptions}
              c={c}
              filteredBills={filteredBills}
              mode={mode}
              nonSunsetBills={nonSunsetBills}
              nonSunsetTotal={nonSunsetTotal}
              renderBillCard={renderBillCard}
              setBillBlockOpen={setBillBlockOpen}
              setBillCodeFilter={setBillCodeFilter}
              setSunsetBlockOpen={setSunsetBlockOpen}
              sunsetBills={sunsetBills}
              sunsetBlockOpen={sunsetBlockOpen}
              sunsetTotal={sunsetTotal}
            />
          </section>

          {/* ─────────── RIGHT: coding drawer ─────────── */}
          {/* NOT sticky, and the card is not capped (`scrollWithPage`): the
              owner asked for the bill to scroll with the page rather than
              inside a window (2026-09-28). A sticky column taller than the
              viewport would strand its own bottom, so the two go together.
              An open bill's card is pushed down beside its row (`openTop`). */}
          <section ref={codingColRef} className="scroll-below-header hidden min-w-0 xl:block">
            {/* One column, three subjects, in order of how specific the claim
                is: ONE entry being edited (a row clicked), then a SELECTION
                being recoded, then the bills. The office codes labor exactly where it
                codes a bill instead of learning a second layout — and the
                recode drawer is the same component Labor Review shows, so the
                two pages move a week of hours identically. */}
            {openTime && !belowXl ? (
              <>
                {/* No section title: the card names the person and the entry,
                    and a "Labor" caption over it only repeated the block
                    the entry was clicked in. */}
                <TimeCodingCard
                  entry={openTime}
                  jobId={jobId}
                  codeOptions={timeCodeOptions}
                  writes={Boolean(data?.writesEnabled)}
                  staged={timeEdits[openTime.id]}
                  stagedLeafId={timeStaged.get(openTime.id)}
                  onStage={(patch) => stageTimeEdit(openTime.id, patch)}
                  onSaved={() => {
                    // The write already landed in JobTread, so this is a
                    // re-read, not a sync — and it must keep the staged bill
                    // work, which has nothing to do with the entry just saved.
                    setOpenTimeId(null);
                    load({ preserveStaged: true });
                  }}
                  onClose={() => setOpenTimeId(null)}
                />
              </>
            ) : timeSelectedEntries.length > 0 ? (
              <>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <SectionLabel>Recode time</SectionLabel>
                  <button
                    type="button"
                    onClick={() => setTimeSelected(new Set())}
                    className="shrink-0 text-[11px] font-semibold text-accent"
                  >
                    Clear selection
                  </button>
                </div>
                <TimeRecodeCard
                  entries={timeSelectedEntries}
                  jobId={jobId}
                  codeOptions={timeCodeOptions}
                  leafOf={timeLeafOf}
                  onPick={stageTimeSelection}
                  typeOf={timeTypeOf}
                  onPickRate={stageTimeType}
                  isStaged={(t) => timeStaged.has(t.id)}
                  onUndo={undoTimeStage}
                  onApproved={markTimeApproved}
                  writes={Boolean(data?.writesEnabled)}
                />
              </>
            ) : (
              <div style={{ paddingTop: openTop }}>
                {openBill && openIndex >= 0 && (
                  <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
                    <button
                      type="button"
                      onClick={() => stepBill(-1)}
                      disabled={openIndex === 0}
                      className="rounded-lg px-2 py-1 font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-40 dark:text-accent-soft"
                    >
                      ← Previous
                    </button>
                    <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                      Bill {openIndex + 1} of {orderedBills.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => stepBill(1)}
                      disabled={openIndex >= orderedBills.length - 1}
                      className="rounded-lg px-2 py-1 font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-40 dark:text-accent-soft"
                    >
                      Next →
                    </button>
                  </div>
                )}
                <BillCodingCard ctl={codingCtl} />
              </div>
            )}
          </section>
        </SplitGrid>
      )}

      {/* THE CHECK'S RESULT, wherever the check was run from. It sits at this
          spot in the DOM so it lands above the workbench on desktop (the grid
          below is `lg:order-1`) and below it on a phone, and it renders only
          once there is something to report. */}
      {jobId && (preSend || preSendError || preSendRunning) && (
        <div className="order-last mt-4 lg:order-none lg:mb-4">
          <PreSendCheck result={preSend} error={preSendError} />
        </div>
      )}

      {/* THE MONTH'S LAST STEP, on touch: approve the month's draft bills, then
          raise its invoice in JobTread. `order-last` drops it below the columns.

          Desktop does NOT render this row — the same three buttons ride in the
          commit bar below and appear when the pointer comes for that corner.
          Keeping both would put the month's terminal action on screen twice. */}
      {jobId && (
        <div className="order-last mt-4 border-t border-line pt-4 lg:hidden">
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2">
            {closingActions}
          </div>
        </div>
      )}

      {/* THE COMMIT BAR — a compact card docked in the LOWER RIGHT corner, at
          every width. It carries the staged count, Revert and Save Changes: the
          write, and nothing else. The month's closing actions — check, sheet
          push, approve — are one centred row above, since none of them commits
          the staged coding this bar is about.

          It used to be `lg:hidden`, with Revert and Save duplicated in the top
          toolbar and Save duplicated AGAIN in the coding drawer — so the desktop
          workbench, the one that scrolls furthest, was the only surface with no
          commit in reach. One bar, three call sites collapsed into it.

          It was a full-bleed strip until 2026-09-09, and this page runs to
          110rem: a band that wide floating over the workbench read as an
          overlay, not as a foot. `dock="right"` sizes it to its buttons and
          pushes it to the column's right edge instead.

          It pins above the tab bar (`--tabbar-h`), so it clears the tab bar at
          desktop widths too. `order-last` keeps it at the bottom of the flex
          column even though the reconcile block above also claims that order on
          a phone; both are last in DOM order here, so they stack in source
          order. */}
      {jobId && (
        <StickyActionBar
          dock="right"
          className="order-last mt-4 flex-wrap justify-end"
          onMouseEnter={() => setBarHover(true)}
          onMouseLeave={() => setBarHover(false)}
        >
          {/* The month's closing actions, revealed while the pointer is on the
              bar — see `barHover`. `hidden lg:flex` keeps them out of the bar on
              touch, where they have their own row under the columns. */}
          {barHover && (
            <div className="hidden flex-wrap items-center justify-end gap-2 lg:flex">
              {closingActions}
            </div>
          )}
          {dirty && (
            <span className="text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">
              {stagedCount} staged change{stagedCount === 1 ? "" : "s"}
              <span className="block text-[10.5px] font-medium text-neutral-500 dark:text-neutral-400">
                Nothing is written until you save
              </span>
            </span>
          )}
          <div className="flex items-center gap-2">
            {dirty && (
              <Button
                variant="secondary"
                size="sm"
                onClick={revertAll}
                disabled={syncing}
                className="min-h-11"
              >
                Revert
              </Button>
            )}
            {/* The coding commit, and only that. The tracking sheet is pushed
                by its own button in the closing row — see save(). */}
            <Button
              size="sm"
              onClick={save}
              disabled={!dirty || syncing}
              title="Write staged coding to JobTread"
              className="min-h-11"
            >
              {syncing ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </StickyActionBar>
      )}

      {/* The Labor panel, where the coding column doesn't fit. Same
          component, same behaviour — a bottom sheet on a phone and a centred
          dialog from sm up, exactly like the cost-code drill-down below, so the
          Close button lands where the thumb already is. Rendered EITHER here or
          in the column, never both: two mounts would duplicate its field ids
          and its state. */}
      {openTime && belowXl && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit time entry"
          onClick={() => setOpenTimeId(null)}
        >
          {/* No background of its own: TimeCodingCard IS a Card, so the sheet
              only sizes and pads it. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-0"
          >
            <TimeCodingCard
              entry={openTime}
              jobId={jobId}
              codeOptions={timeCodeOptions}
              writes={Boolean(data?.writesEnabled)}
              staged={timeEdits[openTime.id]}
              stagedLeafId={timeStaged.get(openTime.id)}
              onStage={(patch) => stageTimeEdit(openTime.id, patch)}
              onSaved={() => {
                setOpenTimeId(null);
                load({ preserveStaged: true });
              }}
              onClose={() => setOpenTimeId(null)}
            />
          </div>
        </div>
      )}

      {/* The Add time dialog. A modal at EVERY width, unlike the edit panel:
          the panel belongs to the coding column (a bill or an entry is always
          open there), while adding time is a short errand that ends in a Close
          — and it must not push the bill being coded out of that column. */}
      {addTimeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add time"
          onClick={() => setAddTimeOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-0"
          >
            <AddTimeCard
              jobId={jobId}
              jobLabel={jobTitle}
              codeOptions={timeCodeOptions}
              writes={Boolean(data?.writesEnabled)}
              onSaved={() => {
                setAddTimeOpen(false);
                // The write already landed in JobTread — a re-read, not a sync,
                // and it must keep the staged bill work untouched.
                load({ preserveStaged: true });
              }}
              onClose={() => setAddTimeOpen(false)}
            />
          </div>
        </div>
      )}

      <CodeDrillSheet
        c={c}
        codeDrill={codeDrill}
        contributorsError={contributorsError}
        contributorsLoading={contributorsLoading}
        drillBills={drillBills}
        drillTime={drillTime}
        headroom={headroom}
        jobId={jobId}
        setCodeDrill={setCodeDrill}
      />

      {/* A dropped-on code with several MEANINGFUL budget rows (Labor vs
          Materials vs Allowance) is a real coding decision — ask, don't guess. */}
      {leafPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLeafPicker(null)}
        >
          <Card
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] !p-4 sm:rounded-b-xl sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold">Which budget line under {leafPicker.code}?</p>
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              This cost code has several budget rows. Moving{" "}
              {leafPicker.lineIds.length === 1 ? "1 line" : `${leafPicker.lineIds.length} lines`}.
            </p>
            {/* Each option is a decision you commit with one tap, so they get
                full-height rows rather than 34px slivers. */}
            <ul className="space-y-2">
              {(leavesByCode.get(leafPicker.code) ?? []).map((leaf) => (
                <li key={leaf.id}>
                  <button
                    type="button"
                    onClick={() => {
                      moveLinesToLeaf(leafPicker.lineIds, leaf.id);
                      setLeafPicker(null);
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-left text-sm transition hover:border-accent hover:bg-accent/5 dark:border-neutral-700"
                  >
                    <span className="min-w-0 truncate">
                      {leaf.detail || leaf.name}
                      {leaf.costType && (
                        <span className="ml-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                          {leaf.costType}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      {money0(leaf.cost ?? 0)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <Button
                variant="secondary"
                className="min-h-11 sm:min-h-0"
                onClick={() => setLeafPicker(null)}
              >
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}

      {approveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !approving && setApproveOpen(false)}
        >
          <Card
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] !p-4 sm:rounded-b-xl sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold">
              Approve {draftBills.length} draft bill{draftBills.length === 1 ? "" : "s"}?
            </p>
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              {billingMonths().find((o) => o.value === ym)?.label ?? ym}
              {jobTitle ? ` · ${jobTitle}` : ""}. Bills move to Pending (approved for payment);
              Expenses move straight to Approved (paid).
            </p>
            <ul className="max-h-[40dvh] space-y-2 overflow-y-auto">
              {draftBills.map((b) => {
                const target = approvalTarget(b);
                const taxOn = billTax(b) > 0;
                const pushQb = !b.qboIsIgnored;
                return (
                  <li
                    key={b.id}
                    className="rounded-lg border border-line px-3 py-2.5 text-sm dark:border-neutral-700"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">{b.label}</span>
                      <span className="shrink-0 tabular-nums font-semibold">{money(b.cost)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                      <span>→ {target === "approved" ? "Approved (paid)" : "Pending"}</span>
                      <span
                        className={
                          pushQb
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-neutral-500 dark:text-neutral-400"
                        }
                      >
                        Push to QuickBooks: {pushQb ? "On" : "Off"}
                      </span>
                      <span
                        className={
                          taxOn
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-neutral-500 dark:text-neutral-400"
                        }
                      >
                        {SALES_TAX_LINE_NAME}: {taxOn ? money(billTax(b)) : "Off"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 dark:border-neutral-700">
              <SectionLabel>Total</SectionLabel>
              <span className="text-xl font-bold tabular-nums">
                {money(draftBills.reduce((s, b) => s + b.cost, 0))}
              </span>
            </div>
            {data && !data.writesEnabled && (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                Writes are disabled on this deployment — this will preview only.
              </p>
            )}
            {/* This posts real writes to JobTread, so the confirm button is
                full-width in the sheet's thumb zone with Cancel beside it —
                not two small pills tucked into a corner. */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                className="min-h-11 w-full"
                onClick={() => setApproveOpen(false)}
                disabled={approving}
              >
                Cancel
              </Button>
              <Button
                className="min-h-11 w-full"
                onClick={approveDraftBills}
                disabled={approving || draftBills.length === 0}
              >
                {approving
                  ? "Approving…"
                  : `Approve ${draftBills.length} bill${draftBills.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {accessOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setAccessOpen(false)}
        >
          <Card
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] !p-4 sm:rounded-b-xl sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold">Give Document Access</p>
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              {monthLabel(ym)}
              {jobTitle ? ` · ${jobTitle}` : ""}. The contact is added to the Document Access list
              on every vendor bill dated in the month, so the client can open the bills behind their
              invoice. No email is sent.
            </p>

            <DocumentAccess jobId={jobId} ym={ym} scopeLabel={monthLabel(ym)} />

            <div className="mt-4 flex justify-end">
              <Button
                variant="secondary"
                className="min-h-11 sm:min-h-0"
                onClick={() => setAccessOpen(false)}
              >
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}
