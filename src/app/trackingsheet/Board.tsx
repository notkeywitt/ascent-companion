"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Banner,
  Button,
  Card,
  Chip,
  ChipScroller,
  EmptyState,
  Label,
  Loading,
  MetaLine,
  Meter,
  PageHeader,
  SectionHeading,
  SectionLabel,
  Select,
  Spinner,
  StatementBlock,
  StickyActionBar,
  Toggle,
  btn,
} from "@/components/ui";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JobPicker, jobLabel, type JobRef } from "@/components/JobPicker";
import { JtLink } from "@/components/JtLink";
import {
  BillCodingCard,
  isImageFile,
  money,
  money0,
  type BillFile,
  type CodingCardCtl,
} from "./BillCodingCard";
import {
  billLineMath,
  descriptionForCode,
  recodeLog,
  round2,
  type LineChange,
  type LineEdit,
  type RecodeEntry,
} from "@/lib/billLineMath";
import { TimeCodingCard, laborOptions } from "./TimeCodingCard";
import {
  TimeEntryList,
  TimeRecodeCard,
  useTimeFilters,
  type CodeHeadroom,
  type TimeEntryRow,
} from "@/components/TimeEntryList";
import { LaborReportButton } from "@/components/LaborReportButton";
import { AddTimeCard } from "./AddTimeCard";
import { InvoiceReconcile, type Recon } from "@/components/InvoiceReconcile";
import { UncapturedBills } from "@/components/UncapturedBills";
import {
  Breakdown,
  billPaidState,
  driveMainWindowToDoc,
  printJob,
  type Detail,
} from "@/components/BillingSummary";
import {
  runTrackingSync,
  type TrackingSyncState,
  type TrackingTarget,
} from "@/components/TrackingSheetSync";
import { TrackingSheetRisks } from "@/components/TrackingSheetRisks";
import { PreSendCheck } from "./PreSendCheck";
import type { PreSendResult } from "@/lib/invoiceReview/preSend";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import {
  discardDraft,
  draftSavedAtLabel,
  jobDraftKey,
  loadDraft,
  reconcileDraft,
  saveDraft,
} from "@/lib/codingDraft";

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

interface BillRef {
  id: string;
  label: string;
  externalId: string | null;
  number: string | null;
  vendor: string;
  cost: number;
  status: string;
  issueDate: string | null;
  createdAt: string | null;
  name: string;
  nonRecoverableTax: number;
  nonRecoverableTaxName: string | null;
  qboIsIgnored: boolean;
  /** Paid-in-QuickBooks figures JobTread computes — read as a pair, see billPaidState. */
  amountPaid: number;
  balance: number;
  saved: boolean;
  reviewed: boolean;
  needsReview: boolean;
  invoiced: boolean;
  fileCount: number;
}
interface JobBillLine {
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
interface BudgetItem {
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
interface BoardPayload {
  job: { id: string; name: string; address: string; customer: string } | null;
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
interface CostCodeTimeContributor {
  id: string;
  code: string;
  employee: string;
  startedAt: string | null;
  hours: number;
  cost: number;
  notes: string;
  isApproved: boolean;
}
interface JobCostContributors {
  bills: CostCodeBillContributor[];
  time: CostCodeTimeContributor[];
}
/** One row in the drill-down's bill list — a committed bill from JobTread, or a still-open draft. */
interface DrillBillRow {
  key: string;
  docId: string;
  vendor: string;
  lineName: string;
  issueDate: string | null;
  status: string;
  cost: number;
  draft: boolean;
}


/** Draft bills are coded but not yet committed spend — JobTread's own budget math excludes them. */
const isCommitted = (status: string) => status === "pending" || status === "approved";


/**
 * Sunset Builders Supply, matched the same way the rest of the codebase does
 * (`/sunset/i` on the vendor name — see getUninvoicedBills / getMonthlyInvoiceJobs).
 * The high invoice count makes it noise when you're deciding where to move money,
 * so in the by-bill list it's split off into its own collapsible pane instead of
 * cluttering the main list. Its cost stays in every budget figure on this page —
 * the split is a view convenience only, never a change to a number.
 */
const isSunsetVendor = (vendor: string) => /sunset/i.test(vendor);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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

function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 18; i++) {
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/** "2026-07" → "July 2026". */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1] ?? ym} ${y}`;
}

/**
 * The issueDate that files a bill in `ym`: the last day of that month, the same
 * convention the bill page's Filing card writes. (Sunset bills carry their
 * arrival date instead — re-filing one from here re-dates it to the month end
 * like any other bill, which is what the office is asking for when they change
 * the month by hand.)
 */
function issueDateFor(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
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
interface Headroom {
  code: string;
  name: string;
  division: string;
  budget: number;
  spent: number; // committed: approved + pending bills (all time), ± staged moves
  drafts: number; // this month's draft-bill cost coded here (not yet committed)
  labor: number; // time entries coded here — billed to the customer like a bill
  droppable: boolean; // has at least one budget leaf to code to
}

/**
 * Everything that will have been charged against this code, so `remaining` is
 * the room actually left.
 *
 * Labor is in here because a customer invoice bills time entries alongside
 * vendor bills — leaving it out overstated headroom on any code carrying hours
 * (e.g. 01 31 20 read $0 left when it was $976 over). It does NOT move when a
 * bill is recoded: a time entry is coded independently of any bill, so it's a
 * fixed per-code baseline that the staged bill moves add to.
 */
const usedOf = (h: Headroom) => h.spent + h.drafts + h.labor;
const remainingOf = (h: Headroom) => h.budget - usedOf(h);

/**
 * "$11,848 used of $23,697 budget · $11,849 remaining" — the rail's one-line
 * budget sentence, identical on a cost code and on a division so the two read
 * the same way. Used is committed + drafts + labor, the same figure the meter
 * fills to, so the three numbers always tie out.
 */
function BudgetLine({
  used,
  budget,
  remaining,
}: {
  used: number;
  budget: number;
  remaining: number;
}) {
  return (
    <div className="mt-0.5 text-[10px] leading-tight tabular-nums text-neutral-500 dark:text-neutral-400">
      {money0(used)} used of {money0(budget)} budget ·{" "}
      <span className={remaining < 0 ? "font-semibold text-red-600 dark:text-red-400" : ""}>
        {money0(remaining)} remaining
      </span>
    </div>
  );
}

/* <Meter> now lives in components/ui — the budget bar is the same object here,
   on the mobile headroom rail, and on any future page that shows spend against
   a budget, so it belongs to the design system rather than to this board. */

/**
 * True on a phone-width screen — the same `lg` boundary this page uses to switch
 * to its read-only single-column layout (see the "read-only view on a narrow
 * screen" note). Below it, recoding is off and the coding drawer is hidden, so a
 * tapped bill has nowhere useful to open; instead we send it to the full bill
 * detail page. Starts false so server and first client render agree, then
 * corrects in the effect.
 */
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

/**
 * True below the `xl` boundary — where the coding column itself is hidden.
 * NOT the same line as `useIsMobile` (lg): between 1024 and 1280 the page still
 * has its full three-column behaviour but only two columns fit, so a time entry
 * clicked there needs the panel as a sheet rather than in a column that isn't
 * rendered. Mirrors the `hidden xl:block` on that section — one source of truth
 * would be better, but a media query is what CSS is doing there too.
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
  const isMobile = useIsMobile();
  const belowXl = useIsBelowXl();
  const jobId = params.get("jobId") ?? "";

  const [ym, setYm] = useState(() => params.get("ym") || defaultYm());
  // Whether the Sunset pane in the by-bill list is expanded. Collapsed by
  // default, same as the Time & labor block below it — Sunset is the noise you
  // fold away, and its cost is already in every figure on the page regardless.
  const [sunsetBlockOpen, setSunsetBlockOpen] = useState(false);
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** costItemId → the budget leaf it's been staged onto. */
  const [staged, setStaged] = useState<Map<string, string>>(new Map());
  /** costItemId → in-flight description / qty / unit-cost text, draft bills only. */
  const [edits, setEdits] = useState<Record<string, LineEdit | undefined>>({});
  /** docId → in-flight sales-tax text, staged the same way as edits/staged. */
  const [taxEdits, setTaxEdits] = useState<Record<string, string>>({});
  const [openDocId, setOpenDocId] = useState<string | null>(null);
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

  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveMsg, setApproveMsg] = useState<{ tone: "success" | "error"; text: string } | null>(
    null,
  );

  // The Tracking Sheet push rides along with "Save Changes" — one button,
  // one step from the office's point of view — so it needs its own target
  // resolution and result state the way /stage drives TrackingSheetSync,
  // rather than the self-contained TrackingSheetSyncFor this page used before.
  const { can } = useAccess();
  const canTrack = can("tracking-sheet");
  const canApprove = can("bill-approve");
  const canLaborReview = can("labor-review");
  const [trackingTarget, setTrackingTarget] = useState<TrackingTarget | null>(null);
  // Have we finished reading whether THIS job has a tracking sheet? Until we
  // have, the month-side button renders nothing rather than flashing the wrong
  // label (a real "Sync" vs a "Link one" for a job that in fact has a sheet).
  const [trackingChecked, setTrackingChecked] = useState(false);
  const [trackingSync, setTrackingSync] = useState<TrackingSyncState | undefined>(undefined);
  // The sheet push runs on its own task runner, so `syncing` (the JobTread write
  // loop) is already false while it's still going. Without this the button would
  // re-enable mid-push and a second click would queue a duplicate sync.
  const trackingBusy =
    trackingSync?.status === "queued" || trackingSync?.status === "running";

  useEffect(() => {
    // A new job starts unresolved — clear the old job's target so its Sync
    // button can't linger on the wrong sheet while the new read is in flight.
    setTrackingTarget(null);
    setTrackingChecked(false);
    if (!canTrack || !jobId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tracking-sheet", { cache: "no-store" });
        if (!res.ok) return; // non-fatal — stays unchecked, button stays hidden
        const b = await res.json();
        if (!alive) return;
        const hit = (
          (b.jobs ?? []) as { id: string; label: string; jtJobId: string; url: string }[]
        ).find((j) => j.jtJobId === jobId);
        if (hit) setTrackingTarget({ projectId: hit.id, label: hit.label, url: hit.url });
        // Only a clean read flips this on: a transient API failure hides the
        // button rather than wrongly offering to "Link" a sheet that exists.
        setTrackingChecked(true);
      } catch {
        /* non-fatal — stays unchecked */
      }
    })();
    return () => {
      alive = false;
    };
  }, [canTrack, jobId]);

  // A month change invalidates the result on screen — it describes another
  // billing period.
  useEffect(() => setTrackingSync(undefined), [ym]);

  // ---- pre-send check (the invoice review's checks, on this job) -----------
  // State lives here, not inside PreSendCheck, so both triggers — the bottom
  // action row and the phone's action drawer — sit outside the card, which
  // stays purely the result.
  const [preSend, setPreSend] = useState<PreSendResult | null>(null);
  const [preSendRunning, setPreSendRunning] = useState(false);
  const [preSendError, setPreSendError] = useState("");
  const runPreSend = useCallback(async () => {
    if (!jobId) return;
    setPreSendRunning(true);
    setPreSendError("");
    setPreSend(null);
    try {
      const res = await fetch(
        `/api/invoice-review/job?jobId=${encodeURIComponent(jobId)}&ym=${encodeURIComponent(ym)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "The check failed.");
      setPreSend(json as PreSendResult);
    } catch (e) {
      setPreSendError(e instanceof Error ? e.message : "The check failed.");
    } finally {
      setPreSendRunning(false);
    }
  }, [jobId, ym]);
  // A month or job change describes another period — drop the stale result.
  useEffect(() => {
    setPreSend(null);
    setPreSendError("");
  }, [jobId, ym]);

  const [codeQuery, setCodeQuery] = useState("");
  // Divisions the user has rolled up. Empty = all open, so the rail keeps
  // showing every code until it's deliberately tidied.
  const [collapsedDivs, setCollapsedDivs] = useState<Set<string>>(new Set());
  // Mobile-only: roll the whole cost-code rail away. On a phone it stacks on
  // top of the bills, so it starts collapsed to land you on the list — tap the
  // header to open it. The desktop sidebar ignores this (it's always docked,
  // via the `lg:` overrides), so defaulting to collapsed is a mobile-only cost.
  const [railCollapsed, setRailCollapsed] = useState(true);
  // The "Time & labor" block in the bills list starts collapsed to a single
  // summary row — expand it to see each entry, same collapse-by-default
  // pattern as the rail's divisions.
  const [timeBlockOpen, setTimeBlockOpen] = useState(false);
  /**
   * The time entry open in the coding column, or null when a bill is.
   *
   * The right column shows ONE thing, and clicking either kind of row is a
   * claim on it — so the two ids are mutually exclusive rather than stacked.
   * See the guards on the bill list's own clicks.
   */
  const [openTimeId, setOpenTimeId] = useState<string | null>(null);
  /**
   * The "Add time" dialog — logging an entry that was never clocked, for
   * somebody else. A dialog rather than a claim on the coding column: it is a
   * one-off errand with its own Close, and it must not evict a bill the office
   * is halfway through coding.
   */
  const [addTimeOpen, setAddTimeOpen] = useState(false);
  /**
   * Filtering and grouping the month's hours is the shared list's — see
   * useTimeFilters. What stays here is what the PAGE does with a selection.
   */
  /** The time entries the coding column is acting on. */
  const [timeSelected, setTimeSelected] = useState<Set<string>>(new Set());
  /**
   * timeEntryId → the budget leaf it's been staged onto. The labor twin of
   * `staged` above, and it rides the same Sync: recoding a week of hours is now
   * something this board does, not only Labor Review.
   */
  const [timeStaged, setTimeStaged] = useState<Map<string, string>>(new Map());

  const taxDirty = Object.entries(taxEdits).some(([docId, v]) => {
    if (v === "") return false;
    const bill = data?.bills.find((b) => b.id === docId);
    if (!bill) return false;
    return round2(Number(v) || 0) !== round2(bill.nonRecoverableTax);
  });
  const dirty =
    staged.size > 0 || timeStaged.size > 0 || Object.keys(edits).length > 0 || taxDirty;
  /** Everything Sync would write, for the toolbar's chip. */
  const stagedCount = staged.size + timeStaged.size;
  // Still worth a prompt — leaving means the coding hasn't reached JobTread —
  // but it no longer says "lose them", because it isn't true any more: the
  // autosave below has already put the work somewhere it survives (see
  // src/lib/codingDraft.ts). The dialog is now a reminder, not the safety net.
  useUnsavedChanges(
    dirty,
    "You have staged coding changes that haven't been synced to JobTread. They'll be saved and offered back when you return — leave now?",
  );

  // ---- durable drafts -----------------------------------------------------
  /**
   * Staged coding is saved continuously, scoped to this job and month, and
   * offered back when you return. It is NOT sent to JobTread — see
   * src/lib/codingDraft.ts for why the Sync button stays the only thing that
   * writes to the live org.
   */
  const draftKey = useMemo(() => (jobId ? jobDraftKey(jobId, ym) : ""), [jobId, ym]);
  /**
   * TWO refs, not one, and the difference matters.
   *
   * A load empties the staged state, and the restore that follows it is async.
   * If the autosave were armed the moment the restore STARTED, it would fire on
   * that empty state — deleting the very draft still being read. So the restore
   * marks itself started, and only arms the autosave once it has finished (with
   * work, or with nothing).
   */
  const restoreStartedRef = useRef("");
  const autosaveArmedRef = useRef("");
  const [restoreMsg, setRestoreMsg] = useState<{
    kept: number;
    dropped: number;
    savedAt: string;
  } | null>(null);

  // Offer the draft back once the month's data is on screen — reconciled
  // against it, so a change JobTread has since taken (or a line that no longer
  // exists) is dropped rather than restored as a phantom edit.
  useEffect(() => {
    if (!draftKey || loading || !data) return;
    if (restoreStartedRef.current === draftKey) return;
    restoreStartedRef.current = draftKey;
    let alive = true;
    (async () => {
      try {
        const draft = await loadDraft(draftKey);
        if (!alive || !draft) return;
        const r = reconcileDraft(draft, {
          lines: data.lines,
          bills: data.bills,
          budgetIds: data.budget.map((b) => b.id),
          timeEntries: data.timeEntries,
        });
        if (r.kept === 0) {
          // Everything in it has since landed or gone stale — nothing to offer.
          if (r.dropped > 0) discardDraft(draftKey);
          return;
        }
        // Only ever ADD to an empty state: the read is async, and work typed
        // while it was in flight outranks anything stored earlier.
        setStaged((prev) => (prev.size > 0 ? prev : new Map(Object.entries(r.staged))));
        setEdits((prev) => (Object.keys(prev).length > 0 ? prev : r.edits));
        setTaxEdits((prev) => (Object.keys(prev).length > 0 ? prev : r.taxEdits));
        setTimeStaged((prev) =>
          prev.size > 0 ? prev : new Map(Object.entries(r.timeStaged ?? {})),
        );
        setRestoreMsg({ kept: r.kept, dropped: r.dropped, savedAt: draft.savedAt });
      } finally {
        // Whatever came of it, this scope is now the browser's to save.
        if (alive) autosaveArmedRef.current = draftKey;
      }
    })();
    return () => {
      alive = false;
    };
  }, [draftKey, loading, data]);

  // …and save it on every change. Cheap: localStorage synchronously, the
  // companion DB on a debounce (and flushed when the tab is hidden or closed).
  useEffect(() => {
    if (!draftKey || autosaveArmedRef.current !== draftKey) return;
    const compactEdits: Record<string, LineEdit> = {};
    for (const [id, e] of Object.entries(edits)) if (e) compactEdits[id] = e;
    // The label is what the "unfinished work" list on the landing page shows —
    // that list reads storage alone and has no job to look a name up from.
    saveDraft(
      draftKey,
      {
        staged: Object.fromEntries(staged),
        edits: compactEdits,
        taxEdits,
        timeStaged: Object.fromEntries(timeStaged),
      },
      `${data?.job?.name || "This job"} · ${monthLabel(ym)}`,
    );
  }, [draftKey, staged, edits, taxEdits, timeStaged, data?.job?.name, ym]);

  const load = useCallback(
    async (opts?: { preserveStaged?: boolean }) => {
      if (!jobId) return;
      setLoading(true);
      setError("");
      const [y, m] = ym.split("-");
      try {
        const r = await fetch(
          `/api/trackingsheet?jobId=${encodeURIComponent(jobId)}&year=${y}&month=${Number(m)}` +
            // Always show the whole month: draft, uninvoiced, and invoiced
            // bills alike, each tagged with its state in the list below.
            `&includeDrafts=1&includeInvoiced=1`,
        );
        const j = (await r.json()) as BoardPayload;
        if (j.error) setError(j.error);
        else {
          setData(j);
          if (opts?.preserveStaged) {
            // Combining deletes lines. Drop any staged pick/edit that pointed at
            // an id JobTread no longer has, but leave every OTHER bill's staged
            // work untouched — combining on one bill shouldn't discard work on
            // another the office hasn't synced yet.
            const liveIds = new Set(j.lines.map((l) => l.id));
            const liveDocIds = new Set(j.bills.map((b) => b.id));
            const liveTimeIds = new Set(j.timeEntries.map((t) => t.id));
            setTimeStaged((prev) => {
              const next = new Map(prev);
              for (const id of next.keys()) if (!liveTimeIds.has(id)) next.delete(id);
              return next;
            });
            setStaged((prev) => {
              const next = new Map(prev);
              for (const id of next.keys()) if (!liveIds.has(id)) next.delete(id);
              return next;
            });
            setEdits((prev) => {
              const next = { ...prev };
              for (const id of Object.keys(next)) if (!liveIds.has(id)) delete next[id];
              return next;
            });
            setTaxEdits((prev) => {
              const next = { ...prev };
              for (const id of Object.keys(next)) if (!liveDocIds.has(id)) delete next[id];
              return next;
            });
          } else {
            // A fresh pull (month/filter change, or after Sync) invalidates
            // everything staged against the old data.
            setStaged(new Map());
            setTimeStaged(new Map());
            setTimeSelected(new Set());
            setEdits({});
            setTaxEdits({});
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [jobId, ym],
  );

  useEffect(() => {
    load();
  }, [load]);

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
  const leafById = useMemo(() => {
    const m = new Map<string, BudgetItem>();
    for (const b of data?.budget ?? []) m.set(b.id, b);
    return m;
  }, [data]);

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
  /** The leaf a time entry points at, staged moves winning. */
  const timeLeafOf = useCallback(
    (t: TimeEntryRow) => timeStaged.get(t.id) ?? t.costItemId ?? "",
    [timeStaged],
  );
  /** …and the cost code that puts it under. */
  const timeCodeOf = useCallback(
    (t: TimeEntryRow) => leafById.get(timeLeafOf(t))?.number ?? t.code,
    [timeLeafOf, leafById],
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
  const headroom = useMemo(() => {
    const map = new Map<string, Headroom>();
    const divisionOf = new Map<string, string>();

    for (const d of data?.costDetail?.divisions ?? []) {
      for (const c of d.codes) {
        // The NAME only. Falling back to the number here put "04" in the name
        // slot, and the rail header renders number + name — hence "04 04".
        if (d.name) divisionOf.set(c.number, d.name);
        map.set(c.number, {
          code: c.number,
          name: c.name,
          division: d.name,
          budget: c.budget,
          spent: c.bills,
          drafts: 0,
          labor: c.labor,
          droppable: (leavesByCode.get(c.number)?.length ?? 0) > 0,
        });
      }
    }
    // A code that only exists as a budget leaf (never spent) still needs a row —
    // it's usually the one WITH headroom, which is exactly what we're hunting for.
    for (const [code, leaves] of leavesByCode) {
      if (map.has(code)) continue;
      map.set(code, {
        code,
        name: leaves[0]?.name ?? "",
        // A code with a budget leaf but no spend never reaches costDetail, so
        // divisionOf can't name it — the leaf carries its own division name.
        division: divisionOf.get(code) ?? leaves.find((l) => l.division)?.division ?? "",
        budget: leaves.reduce((s, l) => s + (l.cost ?? 0), 0),
        spent: 0,
        drafts: 0,
        labor: 0,
        droppable: true,
      });
    }

    const ensure = (code: string): Headroom => {
      let h = map.get(code);
      if (!h) {
        h = {
          code,
          name: "",
          division: divisionOf.get(code) ?? "",
          budget: 0,
          spent: 0,
          drafts: 0,
          labor: 0,
          droppable: (leavesByCode.get(code)?.length ?? 0) > 0,
        };
        map.set(code, h);
      }
      return h;
    };

    for (const l of data?.lines ?? []) {
      const now = codeOf(l);
      const was = l.code;
      if (isCommitted(l.billStatus)) {
        // costDetail.bills already counts this line under its ORIGINAL code, so a
        // staged move is a transfer: take it off the old code, put it on the new.
        if (now !== was) {
          if (was) ensure(was).spent -= l.cost;
          if (now) ensure(now).spent += l.cost;
        }
      } else if (now) {
        // Drafts aren't in costDetail.bills at all, so they're added whole —
        // under wherever they currently sit.
        ensure(now).drafts += l.cost;
      }
    }

    // …and the same transfer for staged LABOR. costDetail.labor already counts
    // every entry under its ORIGINAL code, so a staged move subtracts there and
    // adds here. Without this the rail — and the budget-left chip on every time
    // row — would sit perfectly still while you recoded a week of hours, which
    // is the one moment those figures matter most.
    for (const t of data?.timeEntries ?? []) {
      const now = timeCodeOf(t);
      const was = t.code;
      if (now === was) continue;
      if (was) ensure(was).labor -= t.cost;
      if (now) ensure(now).labor += t.cost;
    }
    return map;
  }, [data, codeOf, timeCodeOf, leavesByCode]);

  const railRows = useMemo(() => {
    const q = codeQuery.trim().toLowerCase();
    // Labor-only codes count: a code with hours but no budget and no bills is
    // over budget by definition, and hiding it would hide that.
    const rows = [...headroom.values()].filter(
      (h) => h.budget !== 0 || h.spent !== 0 || h.drafts !== 0 || h.labor !== 0,
    );
    const matched = q
      ? rows.filter((h) => `${h.code} ${h.name}`.toLowerCase().includes(q))
      : rows;
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
   * run out of?"): every code with a real budget, worst headroom first. Codes
   * with no budget to divide by are excluded — an unbudgeted code is over by
   * definition and would permanently occupy the front of the row.
   */
  const tightestCodes = useMemo(
    () =>
      railRows
        .filter((h) => h.budget > 0)
        .sort((a, b) => remainingOf(a) / a.budget - remainingOf(b) / b.budget)
        .slice(0, 8),
    [railRows],
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
  }, [railGroups]);

  // ---- derived: bills + their lines ---------------------------------------
  const linesByDoc = useMemo(() => {
    const m = new Map<string, JobBillLine[]>();
    for (const l of data?.lines ?? []) {
      const arr = m.get(l.docId) ?? [];
      arr.push(l);
      m.set(l.docId, arr);
    }
    return m;
  }, [data]);

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
  const nonSunsetBills = useMemo(
    () => (data?.bills ?? []).filter((b) => !sunsetDocIds.has(b.id)),
    [data, sunsetDocIds],
  );
  const sunsetBills = useMemo(
    () => (data?.bills ?? []).filter((b) => sunsetDocIds.has(b.id)),
    [data, sunsetDocIds],
  );
  const sunsetTotal = useMemo(
    () => sunsetBills.reduce((s, b) => s + b.cost, 0),
    [sunsetBills],
  );

  // Every draft bill on screen — both panes — so "Approve" acts on exactly what
  // the office can see (Sunset drafts included; they're one tap away in the pane).
  const draftBills = useMemo(
    () => (data?.bills ?? []).filter((b) => b.status === "draft"),
    [data],
  );
  /** Nothing left to approve: the month HAS bills and not one of them is still
   *  a draft. That is the moment the row's action stops being "approve these"
   *  and becomes "create the invoice". A month with no bills at all is not
   *  approved, it is empty — so it keeps the (disabled) Approve button. */
  const allApproved = (data?.bills?.length ?? 0) > 0 && draftBills.length === 0;
  /** Does the bottom action row carry an Approve button? It needs the role AND a
   *  loaded month — the check button beside it needs neither. */
  const showApprove = canApprove && !!data && !loading;
  // Mirrors approveBill() on the bill detail page: a Bill is a payable (draft →
  // pending, "approved for payment"); an Expense is already paid (draft →
  // approved, "record payment").
  const approvalTarget = (b: BillRef) => (b.name === "Expense" ? "approved" : "pending");

  // Every time entry counts toward the month's labor, approved or not — each
  // row is tagged with its own approval state so nothing is hidden. The rail's
  // labor figure counts the same set, so the two always agree.
  const monthTime = useMemo(
    () => data?.timeEntries ?? [],
    [data],
  );
  const monthTimeTotal = useMemo(() => monthTime.reduce((s, t) => s + t.cost, 0), [monthTime]);
  /** The same set's hours, shown beside the money on the card's title line —
   *  "what did labor cost" and "how much labor was it" are one question. */
  const monthTimeHours = useMemo(() => monthTime.reduce((s, t) => s + t.hours, 0), [monthTime]);

  /* ---------------- Time & labor ----------------------------------------
     The list, its filters and its grouping are src/components/TimeEntryList —
     the SAME component Labor Review renders, so a month of hours is narrowed,
     grouped, selected and read identically wherever you meet it. What lives
     here is what this page does with it: the budget it measures against, the
     staged recodes, and the single-entry editor the Edit button opens. */

  const timeFilters = useTimeFilters(monthTime, {
    codeOf: timeCodeOf,
    resetKey: `${jobId}|${ym}`,
  });

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

  /** The entries the coding column is recoding — the selection, in month order. */
  const timeSelectedEntries = useMemo(
    () => monthTime.filter((t) => timeSelected.has(t.id)),
    [monthTime, timeSelected],
  );

  /** Stage every selected entry onto one budget leaf. */
  const stageTimeSelection = (leafId: string) => {
    if (!leafId) return;
    setTimeStaged((prev) => {
      const next = new Map(prev);
      for (const t of monthTime) {
        if (!timeSelected.has(t.id)) continue;
        // Re-picking an entry's ORIGINAL leaf is an un-stage, not a change.
        if (t.costItemId === leafId) next.delete(t.id);
        else next.set(t.id, leafId);
      }
      return next;
    });
    setSyncMsg(null);
  };

  /** Un-stage one entry from the drawer's Staged list. */
  const undoTimeStage = (id: string) =>
    setTimeStaged((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

  /**
   * "Flag for review" — the assistant-local mark, identical to Labor Review's
   * (same endpoint, same table). NOT a JobTread write, so it's independent of
   * the write gate and of Sync: flagging never syncs, and Sync never clears one.
   */
  const toggleTimeFlag = async (id: string, flagged: boolean) => {
    setData((d) =>
      d
        ? { ...d, timeEntries: d.timeEntries.map((t) => (t.id === id ? { ...t, flagged } : t)) }
        : d,
    );
    try {
      await fetch("/api/labor-review/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, jobId, flagged }),
      });
    } catch {
      /* best-effort — same as the bill list's Reviewed tag */
    }
  };

  /**
   * The drawer approved some entries in JobTread — mark them here rather than
   * re-pulling the month. A reload would be a second round trip for a change we
   * already know landed, and the staged bill work has nothing to do with it.
   */
  const markTimeApproved = (ids: string[]) => {
    const done = new Set(ids);
    setData((d) =>
      d
        ? {
            ...d,
            timeEntries: d.timeEntries.map((t) =>
              done.has(t.id) ? { ...t, isApproved: true } : t,
            ),
          }
        : d,
    );
  };

  const openTime = monthTime.find((t) => t.id === openTimeId) ?? null;

  /**
   * Coding targets for LABOR — the job's Labor-typed leaves plus any leaf an
   * entry already sits on. Deliberately NOT `codeOptions`, which excludes Labor
   * leaves because bills don't belong there; time is the other half of that
   * rule.
   */
  const timeCodeOptions = useMemo(
    () => laborOptions(data?.budget ?? [], (data?.timeEntries ?? []).map((t) => t.costItemId)),
    [data],
  );

  // A filter that hides the entry being edited would otherwise leave the coding
  // column describing a row that isn't on screen. (The filters themselves reset
  // on a job/month change inside useTimeFilters — see its `resetKey`.)
  const timeVisible = timeFilters.visible;
  useEffect(() => {
    if (openTimeId && !timeVisible.some((t) => t.id === openTimeId)) setOpenTimeId(null);
  }, [openTimeId, timeVisible]);

  // A selection is about entries in a particular month on a particular job, so
  // it can't survive a change of either — nor a fresh pull, where the staged
  // moves it belongs to are dropped too (see load()).
  useEffect(() => {
    setTimeSelected(new Set());
  }, [jobId, ym]);

  const openBill = data?.bills.find((b) => b.id === openDocId) ?? null;
  const openLines = openDocId ? (linesByDoc.get(openDocId) ?? []) : [];

  // Tax is staged the same way as edits/staged (keyed by docId, not line id) —
  // nothing writes until Sync. Previewed here so the total/subtotal below move
  // live as the office types, same as bill/[docId]'s tax field.
  const openStoredTax = openBill?.nonRecoverableTax ?? 0;
  const openTaxEdit = openBill ? taxEdits[openBill.id] : undefined;
  const openTaxView =
    openTaxEdit !== undefined && openTaxEdit !== "" ? Number(openTaxEdit) || 0 : openStoredTax;

  /** De-taxed display values + the whole-bill payload for the open bill. */
  const openMath = useMemo(
    () =>
      billLineMath({
        lines: openLines,
        storedTax: openBill?.nonRecoverableTax ?? 0,
        taxView: openTaxView,
        status: openBill?.status,
        edits,
        picked: Object.fromEntries(staged),
        budget: data?.budget ?? [],
      }),
    [openLines, openBill, openTaxView, edits, staged, data],
  );

  // ---- coding-drawer bulk actions: Apply to all + Combine ------------------
  // Ported from the bill page (/bill/[docId]) — same rules, adapted to this
  // page's staged-not-saved model.
  const [bulkCode, setBulkCode] = useState("");
  const [combineSelected, setCombineSelected] = useState<string[]>([]);
  const [combining, setCombining] = useState(false);
  const [combineMsg, setCombineMsg] = useState("");
  const [buybackId, setBuybackId] = useState("");
  const [addingLine, setAddingLine] = useState(false);
  const [newLine, setNewLine] = useState({ name: "", quantity: "1", unitCost: "0", code: "" });
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [addLineMsg, setAddLineMsg] = useState("");
  const [deletingLineId, setDeletingLineId] = useState("");
  const [deleteLineMsg, setDeleteLineMsg] = useState("");
  const [monthSaving, setMonthSaving] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [filingMsg, setFilingMsg] = useState("");
  // Vendor Bill Number (JobTread externalId) editor for the open bill. Local draft
  // synced from the bill; committed on blur so we don't write on every keystroke.
  const [billNumberDraft, setBillNumberDraft] = useState("");
  const [billNumberSaving, setBillNumberSaving] = useState(false);

  // All reset when the open bill changes — they're about the CURRENT bill's
  // lines, and stale selections/forms from a previous bill would silently
  // apply to the wrong one. taxEdits is NOT reset here: like edits/staged, a
  // tax edit stays pending across bills until Sync or Revert.
  useEffect(() => {
    setBulkCode("");
    setCombineSelected([]);
    setCombineMsg("");
    setAddingLine(false);
    setNewLine({ name: "", quantity: "1", unitCost: "0", code: "" });
    setAddLineMsg("");
    setDeleteLineMsg("");
    setFilingMsg("");
  }, [openDocId]);

  // Keep the Bill Number draft in step with the open bill — on open, and after a
  // save/reload re-reads its externalId from JobTread.
  useEffect(() => {
    setBillNumberDraft(openBill?.externalId ?? "");
  }, [openDocId, openBill?.externalId]);

  // Stage one cost code onto every line of the open bill (into `staged`, so it
  // flows through the same Sync path as a single drag/dropdown recode — nothing
  // is written until Sync). Re-coding works in any status, unlike qty/unit/
  // description, so this is available on payable/paid bills too.
  const applyCodeToAll = useCallback(
    (leafId: string) => {
      if (!leafId || openLines.length === 0) return;
      setStaged((prev) => {
        const next = new Map(prev);
        for (const l of openLines) {
          if (leafId === (l.jobCostItemId ?? "")) next.delete(l.id);
          else next.set(l.id, leafId);
        }
        return next;
      });
      setSyncMsg(null);
    },
    [openLines],
  );

  // Combine: group the open bill's lines by their EFFECTIVE code (a staged pick
  // wins over the stored one, matching leafOf everywhere else on this page), so
  // 2+ lines sharing a code can merge into one. Combining reads each line's
  // STORED name/cost — an unsaved description/qty/unit EDIT would be silently
  // dropped — so that's blocked until saved (synced) or discarded, exactly like
  // the bill page. A staged CODE pick is fine and becomes the merged line's code.
  const combineById = useMemo(() => new Map(openLines.map((l) => [l.id, l] as const)), [openLines]);
  const combineCodeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of openLines) {
      const c = leafOf(l);
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [openLines, leafOf]);
  const isCombinable = useCallback(
    (l: JobBillLine) => (combineCodeCounts.get(leafOf(l)) ?? 0) >= 2,
    [combineCodeCounts, leafOf],
  );
  const anyCombinable = useMemo(
    () => [...combineCodeCounts.values()].some((n) => n >= 2),
    [combineCodeCounts],
  );
  const combineCodeSet = useMemo(
    () =>
      new Set(
        combineSelected
          .map((id) => combineById.get(id))
          .filter((l): l is JobBillLine => !!l)
          .map((l) => leafOf(l))
          .filter(Boolean),
      ),
    [combineSelected, combineById, leafOf],
  );
  const combineHasEdit = combineSelected.some((id) => {
    const e = edits[id];
    return Boolean(e && (e.name !== undefined || e.quantity !== undefined || e.unitCost !== undefined));
  });
  const canCombine = combineSelected.length >= 2 && combineCodeSet.size === 1 && !combineHasEdit;

  const toggleCombineSel = (id: string) =>
    setCombineSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // Combine WRITES immediately (unlike a recode) — it's a structural line
  // merge (delete + sum), not a "which code" decision worth trying on and
  // reverting, and the bill page's combine has always worked this way.
  const combineRows = async () => {
    const sel = combineSelected.map((id) => combineById.get(id)).filter((l): l is JobBillLine => !!l);
    if (sel.length < 2 || !openBill) return;
    const codeId = leafOf(sel[0]);
    if (!codeId || !sel.every((l) => leafOf(l) === codeId)) return; // mixed codes
    const keep = sel[0];
    const deleteIds = sel.slice(1).map((l) => l.id);
    const extendedCost = round2(sel.reduce((s, l) => s + l.cost, 0));
    const name =
      sel
        .map((l) => (l.name || "").trim())
        .filter(Boolean)
        .join(" + ")
        .substring(0, 250) || "Line item";
    const description = descriptionForCode(codeId, data?.budget ?? []);

    setCombining(true);
    setCombineMsg("");
    try {
      const res = await fetch("/api/combine-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId: openBill.id,
          keepId: keep.id,
          deleteIds,
          name,
          extendedCost,
          jobCostItemId: codeId || undefined,
          description,
        }),
      });
      const json = await res.json();
      if (!res.ok) setCombineMsg(json.error ?? "Combine failed");
      else if (json.previewed)
        setCombineMsg("Preview only — writes are OFF. Nothing was combined in JobTread.");
      else {
        setCombineSelected([]);
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setCombineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setCombining(false);
    }
  };

  // Delete a single line from the open bill — ported from the bill page.
  // WRITES immediately (draft-only; the server gates it), same as Combine.
  const deleteLineById = async (id: string, label: string) => {
    if (
      !window.confirm(`Delete this line?\n\n${label}\n\nThis removes it from the bill in JobTread.`)
    )
      return;
    setDeletingLineId(id);
    setDeleteLineMsg("");
    try {
      const res = await fetch("/api/delete-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: openBill?.id, costItemId: id }),
      });
      const json = await res.json();
      if (!res.ok) setDeleteLineMsg(json.error ?? "Delete failed");
      else if (json.previewed)
        setDeleteLineMsg("Preview only — writes are OFF. Nothing was deleted in JobTread.");
      else {
        setCombineSelected((s) => s.filter((x) => x !== id));
        setStaged((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setEdits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setDeleteLineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setDeletingLineId("");
    }
  };

  // Add a new line to the open bill (createCostItem) — ported from the bill
  // page. Unit $ is entered PRE-TAX (matching the line editor); gross it up
  // against the bill's CURRENT previewed subtotal/tax so it lands consistent
  // with whatever's on screen, including an unsynced tax edit.
  const addLine = async () => {
    const name = newLine.name.trim();
    if (!name || !openBill) return;
    setAddLineSaving(true);
    setAddLineMsg("");
    try {
      const description = descriptionForCode(newLine.code, data?.budget ?? []);
      const qty = Number(newLine.quantity) || 0;
      const preTaxUnit = Number(newLine.unitCost) || 0;
      const newSumPreTax = openMath.subtotal + preTaxUnit * qty;
      const reTaxAdd = newSumPreTax > 0 ? (newSumPreTax + openTaxView) / newSumPreTax : 1;
      const res = await fetch("/api/add-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId: openBill.id,
          name,
          quantity: qty,
          unitCost: round2(preTaxUnit * reTaxAdd),
          jobCostItemId: newLine.code || undefined,
          description,
        }),
      });
      const json = await res.json();
      if (!res.ok) setAddLineMsg(json.error ?? "Add failed");
      else if (json.previewed)
        setAddLineMsg("Preview only — writes are OFF. Nothing was added to JobTread.");
      else {
        setAddingLine(false);
        setNewLine({ name: "", quantity: "1", unitCost: "0", code: "" });
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setAddLineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setAddLineSaving(false);
    }
  };

  // Buyback WRITES immediately (unlike a recode) — like Combine, it's a
  // structural change (the line moves onto a DIFFERENT bill entirely, not just
  // a different code on this one), not a "which code" decision worth trying on
  // and reverting. Mirrors the bill page's buyback (/bill/[docId]) — see
  // buybackLine in lib/jobtread.ts for how repeat clicks against the SAME
  // source bill land on the SAME Ascent - Shop bill instead of minting a new
  // one each time.
  const buybackLineById = async (l: JobBillLine, name: string, extended: number) => {
    if (
      !window.confirm(
        `Buy back this line to Ascent - Shop?\n\n${name} — ${money(extended)}\n\n` +
          `This moves it onto a draft bill on the Shop job (creating one if needed) and ` +
          `removes it from this bill.`,
      )
    )
      return;
    setBuybackId(l.id);
    setSyncMsg(null);
    try {
      const codeId = leafOf(l);
      const description = codeId ? descriptionForCode(codeId, data?.budget ?? []) : undefined;
      const res = await fetch("/api/buyback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDocId: l.docId,
          costItemId: l.id,
          name,
          unitCost: round2(extended),
          description,
        }),
      });
      const json = await res.json();
      if (!res.ok) setSyncMsg({ tone: "error", text: json.error ?? "Buyback failed." });
      else if (json.previewed)
        setSyncMsg({
          tone: "error",
          text: "Preview only — writes are OFF. Nothing was moved in JobTread.",
        });
      else {
        setStaged((prev) => {
          const next = new Map(prev);
          next.delete(l.id);
          return next;
        });
        setEdits((prev) => {
          const next = { ...prev };
          delete next[l.id];
          return next;
        });
        setSyncMsg({
          tone: "success",
          text: json.created ? "Moved to a new Shop bill." : "Added to the existing Shop bill.",
        });
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setSyncMsg({ tone: "error", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setBuybackId("");
    }
  };

  // ---- filing: which month the bill bills in, and which job it belongs to ---
  // Ported from the bill page's Filing card so a bill can be finished without
  // leaving the board. Both WRITE immediately — they're filing facts read off
  // the document, not "try it and see" coding choices — and both can take the
  // bill off this board entirely, which is why their success is reported in the
  // page-level banner (the drawer they were pressed in is gone by then) and
  // only their errors stay in the card.

  /** True when the open bill carries coding work that hasn't been synced yet. */
  const openBillDirty = openLines.some(
    (l) => staged.has(l.id) || edits[l.id] !== undefined,
  );

  // Re-date the bill (JobTread's issueDate = its billing month; the sheet and
  // the Drive month folder follow it via the hourly mirror). Any status — a
  // re-date is legal on a committed bill, unlike qty/description edits.
  const setBillingMonth = async (targetYm: string) => {
    if (!openBill || !targetYm) return;
    // A different month takes the bill out of the month this board is showing,
    // and the reload below prunes anything staged against it.
    const leaves = targetYm !== ym;
    if (
      leaves &&
      openBillDirty &&
      !window.confirm(
        `Move this bill to ${monthLabel(targetYm)}?\n\nIt leaves ${monthLabel(ym)} on this ` +
          `board, and its staged coding changes go with it — they haven't been synced.`,
      )
    )
      return;
    setMonthSaving(true);
    setFilingMsg("");
    try {
      const res = await fetch("/api/bill-issuedate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: openBill.id, issueDate: issueDateFor(targetYm) }),
      });
      const json = await res.json();
      if (!res.ok) setFilingMsg(json.error ?? "Couldn't set the billing month.");
      else if (json.previewed)
        setFilingMsg("Preview only — writes are OFF. The billing month wasn't changed.");
      else {
        if (leaves) {
          setOpenDocId(null);
          setSyncMsg({
            tone: "success",
            text: `Moved to ${monthLabel(targetYm)} — it's no longer in ${monthLabel(ym)}.`,
          });
        }
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setFilingMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setMonthSaving(false);
    }
  };

  // Save the Vendor Bill Number (JobTread externalId). Writes immediately, like
  // the billing-month edit, then reloads so the field reflects JobTread's truth.
  // A re-number keeps the bill on this board, so success is reported in the card.
  const saveBillNumber = async () => {
    if (!openBill) return;
    const next = billNumberDraft.trim();
    const current = (openBill.externalId ?? "").trim();
    if (next === current) return;
    setBillNumberSaving(true);
    setFilingMsg("");
    try {
      const res = await fetch("/api/bill-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: openBill.id, externalId: next }),
      });
      const json = await res.json();
      if (!res.ok) setFilingMsg(json.error ?? "Couldn't set the bill number.");
      else if (json.previewed)
        setFilingMsg("Preview only — writes are OFF. The bill number wasn't changed.");
      else {
        setFilingMsg("Bill number saved.");
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setFilingMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setBillNumberSaving(false);
    }
  };

  // Move the bill to another job. JobTread can't move bills, so Apps Script
  // delete+recreates it on the target job (draft only) and re-files the sheet
  // row + Drive folder. The recreate mints a NEW docId on a job this board
  // isn't showing, so afterwards we simply drop it from the list.
  const reassignJob = async (target: JobRef) => {
    if (!openBill || !target.id || target.id === jobId) return;
    if (
      !window.confirm(
        `Move this bill to ${jobLabel(target)}?\n\nJobTread can't move bills, so it will be ` +
          `deleted and recreated on that job. It stays a draft, keeps its PDF, and re-files ` +
          `in Drive.` +
          (openBillDirty
            ? "\n\nIts staged coding changes haven't been synced and will be lost."
            : ""),
      )
    )
      return;
    setReassigning(true);
    setFilingMsg("");
    try {
      const res = await fetch("/api/reassign-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: openBill.id, jobId: target.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFilingMsg(json.error ?? "Reassign failed");
        return;
      }
      setOpenDocId(null);
      setSyncMsg({ tone: "success", text: `Moved to ${jobLabel(target)} — it's on that job now.` });
      await load({ preserveStaged: true });
    } catch (e) {
      setFilingMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setReassigning(false);
    }
  };

  // The scanned invoice, fetched only when a bill is opened and then remembered —
  // stepping back and forth between bills is the normal motion here, and the
  // attachment doesn't change while you're coding.
  const [files, setFiles] = useState<BillFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const fileCache = useRef<Map<string, BillFile[]>>(new Map());

  useEffect(() => {
    if (!openDocId) {
      setFiles([]);
      return;
    }
    const cached = fileCache.current.get(openDocId);
    if (cached) {
      setFiles(cached);
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    setFiles([]);
    fetch(`/api/bill/files?docId=${encodeURIComponent(openDocId)}`)
      .then((r) => r.json())
      .then((j) => {
        const got: BillFile[] = j.files ?? [];
        fileCache.current.set(openDocId, got);
        if (!cancelled) setFiles(got);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openDocId]);

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
   * One bill's approve POST. The batch button below loops it; the coding card's
   * own "Approve in JT" fires it once. Returns the failure line, or the
   * write-gate's preview flag on success.
   */
  const postApproval = async (b: BillRef): Promise<{ failure?: string; previewed?: boolean }> => {
    try {
      const r = await fetch("/api/bill-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: b.id, status: approvalTarget(b) }),
      });
      const j = await r.json();
      if (!r.ok || j.error) return { failure: `${b.label}: ${j.error ?? "Approve failed"}` };
      return { previewed: Boolean(j.previewed) };
    } catch (e) {
      return { failure: `${b.label}: ${e instanceof Error ? e.message : "Request failed"}` };
    }
  };

  /**
   * Approve ONE bill — the card's button, beside the batch one at the bottom
   * of the page. Same write, same role gate, no confirmation dialog: the batch
   * dialog exists to say how many bills one press would move, and here the
   * answer is one. `dirty` blocks it for the reason it blocks the batch —
   * approving locks a draft's lines in JobTread, so staged coding syncs first.
   */
  const approveOneBill = async (docId: string) => {
    const b = data?.bills.find((x) => x.id === docId);
    if (!b || dirty || approving) return;
    setApproveMsg(null);
    setApproving(true);
    const r = await postApproval(b);
    setApproving(false);
    setApproveMsg(
      r.failure
        ? { tone: "error", text: r.failure }
        : { tone: "success", text: `${r.previewed ? "Would approve" : "Approved"} ${b.label}.` },
    );
    await load();
  };

  /**
   * The Assistant-local "reviewed" flag — not a JobTread write, so it works
   * regardless of the write gate. Optimistic: the tag flips immediately and the
   * request is best-effort, same as the bill page.
   */
  const toggleReviewed = async (docId: string, reviewed: boolean) => {
    setData((d) =>
      d
        ? { ...d, bills: d.bills.map((b) => (b.id === docId ? { ...b, reviewed } : b)) }
        : d,
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
    bill: openBill,
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
    approveBill: canApprove ? approveOneBill : undefined,
    approvingBill: approving,
    approveBlocked: dirty ? "Sync staged coding changes to JobTread first" : null,
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
    monthOptions: monthOptions(),
    setBillingMonth,
    monthSaving,
    reassignJob,
    reassigning,
    filingMsg,
  };

  const revertAll = () => {
    setStaged(new Map());
    setTimeStaged(new Map());
    setTimeSelected(new Set());
    setEdits({});
    setTaxEdits({});
    setSyncMsg(null);
    setRestoreMsg(null);
    // Revert is the one place the office says "I don't want this work" — so it
    // throws the saved draft away too, on every device. Everything else keeps it.
    if (draftKey) discardDraft(draftKey);
  };

  // ---- drag and drop -------------------------------------------------------
  // A drag carries the line ids it would move: one for a line chip, all of a
  // bill's lines for a bill chip. Dropping on a cost code re-points them at that
  // code's budget leaf.
  const [dragLineIds, setDragLineIds] = useState<string[] | null>(null);
  const [dragOverCode, setDragOverCode] = useState<string | null>(null);
  /** Set when a drop lands on a code with several distinguishable leaves. */
  const [leafPicker, setLeafPicker] = useState<{ code: string; lineIds: string[] } | null>(null);

  // ---- cost-code drill-down: which bills/time entries make up a total -----
  /** The rail code currently open in the drill-down modal, or null when closed. */
  const [codeDrill, setCodeDrill] = useState<string | null>(null);
  // The whole job's contributors come back in one fetch (see
  // getJobCostContributors) and are cached here so opening a second code is
  // instant; tagged with the jobId they belong to so switching jobs can't
  // serve a stale job's bills under the new job's codes.
  const [contributors, setContributors] = useState<{
    jobId: string;
    data: JobCostContributors;
  } | null>(null);
  const [contributorsLoading, setContributorsLoading] = useState(false);
  const [contributorsError, setContributorsError] = useState("");

  const openCodeDrill = useCallback(
    (code: string) => {
      setCodeDrill(code);
      if (!jobId || contributorsLoading || contributors?.jobId === jobId) return;
      setContributorsLoading(true);
      setContributorsError("");
      fetch(`/api/trackingsheet/contributors?jobId=${encodeURIComponent(jobId)}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.error) throw new Error(j.error);
          setContributors({ jobId, data: j as JobCostContributors });
        })
        .catch((e) => setContributorsError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setContributorsLoading(false));
    },
    [jobId, contributors, contributorsLoading],
  );

  const billsById = useMemo(() => new Map((data?.bills ?? []).map((b) => [b.id, b])), [data]);

  /**
   * Committed bills, reconciled against any staged-but-not-synced recode: a
   * contributor row is JobTread's TRUE current code (`b.code`), but if its line
   * has been dragged elsewhere in this session, `staged` already moved it in
   * the rail's own numbers (see the `headroom` memo) — so the drill-down must
   * follow the same staged code, or it would list a bill under a code the rail
   * no longer counts it toward.
   */
  const drillBills = useMemo((): DrillBillRow[] => {
    if (!codeDrill) return [];
    const committed = (contributors?.data.bills ?? [])
      .filter((b) => {
        const leaf = staged.get(b.id);
        const effective = leaf ? leafById.get(leaf)?.number ?? b.code : b.code;
        return effective === codeDrill;
      })
      .map((b): DrillBillRow => ({
        key: b.id,
        docId: b.docId,
        vendor: b.vendor,
        lineName: b.lineName,
        issueDate: b.issueDate,
        status: b.status,
        cost: b.cost,
        draft: false,
      }));
    const drafts = (data?.lines ?? [])
      .filter((l) => !isCommitted(l.billStatus) && codeOf(l) === codeDrill)
      .map((l): DrillBillRow => ({
        key: l.id,
        docId: l.docId,
        vendor: billsById.get(l.docId)?.vendor ?? l.name,
        lineName: l.name,
        issueDate: billsById.get(l.docId)?.issueDate ?? null,
        status: l.billStatus,
        cost: l.cost,
        draft: true,
      }));
    return [...committed, ...drafts].sort(
      (a, b) => String(b.issueDate ?? "").localeCompare(String(a.issueDate ?? "")) || b.cost - a.cost,
    );
  }, [contributors, codeDrill, staged, leafById, data, billsById]);

  // Labor is coded independently of any bill and never moves with a staged
  // recode (see the `usedOf` note above), so this needs no staged reconciliation.
  // Every entry counts, approved or not — the same set the rail's labor figure
  // sums — and each row carries its own approval tag.
  const drillTime = useMemo(
    () => (contributors?.data.time ?? []).filter((t) => t.code === codeDrill),
    [contributors, codeDrill],
  );

  const beginDrag = (lineIds: string[]) => (e: React.DragEvent) => {
    setDragLineIds(lineIds);
    e.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag without payload.
    e.dataTransfer.setData("text/plain", lineIds.join(","));
  };
  const endDrag = () => {
    setDragLineIds(null);
    setDragOverCode(null);
  };

  const moveLinesToLeaf = useCallback(
    (lineIds: string[], leafId: string) => {
      if (!data) return;
      setStaged((prev) => {
        const next = new Map(prev);
        for (const id of lineIds) {
          const line = data.lines.find((l) => l.id === id);
          if (!line) continue;
          if (leafId === (line.jobCostItemId ?? "")) next.delete(id);
          else next.set(id, leafId);
        }
        return next;
      });
      setSyncMsg(null);
    },
    [data],
  );

  /**
   * Resolve a dropped-on cost code to a single budget leaf. One leaf is
   * unambiguous. Several leaves under one code is normal and meaningful (Labor
   * vs Materials vs Allowance on the same code), and picking for the user would
   * be guessing at a real coding decision — so that opens a picker instead.
   */
  const dropOnCode = useCallback(
    (code: string, lineIds: string[]) => {
      const leaves = leavesByCode.get(code) ?? [];
      if (leaves.length === 0) return; // not a legal target
      if (leaves.length === 1) {
        moveLinesToLeaf(lineIds, leaves[0].id);
        return;
      }
      const distinct = new Set(
        leaves.map((l) => `${l.detail ?? ""}|${l.costType ?? ""}`.toLowerCase()),
      );
      if (distinct.size === 1) {
        // Indistinguishable rows (estimate revisions piled on one code) — take
        // the best-funded, the same rule CostCodeSelect applies.
        const best = [...leaves].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))[0];
        moveLinesToLeaf(lineIds, best.id);
        return;
      }
      setLeafPicker({ code, lineIds });
    },
    [leavesByCode, moveLinesToLeaf],
  );

  const dropHandlers = (code: string, droppable: boolean) =>
    droppable
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragOverCode !== code) setDragOverCode(code);
          },
          onDragLeave: () => setDragOverCode((c) => (c === code ? null : c)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const ids =
              dragLineIds ?? (e.dataTransfer.getData("text/plain") || "").split(",").filter(Boolean);
            if (ids.length) dropOnCode(code, ids);
            endDrag();
          },
        }
      : {};

  // ---- sync ---------------------------------------------------------------
  const sync = async () => {
    if (!data) return;

    // NOTHING STAGED — the button is the Tracking Sheet push on its own.
    // The two halves are one step from the office's point of view, but the
    // coding half is the only one that can be "dirty", so gating the whole
    // button on staged changes meant a job whose coding was already settled had
    // no way to refresh its sheet from this page short of inventing an edit.
    if (!dirty) {
      if (!trackingTarget) return;
      const [y, m] = ym.split("-").map(Number);
      runTrackingSync(trackingTarget.projectId, m, y, setTrackingSync);
      return;
    }

    setSyncing(true);
    setSyncMsg(null);

    // WHOLE-BILL PUSH, the same pattern the bill page uses. Every touched bill
    // sends ALL of its lines, not just the edited ones: JobTread stores costs
    // tax-inclusive, so editing one line shifts the bill's shared gross-up
    // factor and the untouched lines would otherwise appear to drift. On a
    // tax-free bill this is idempotent, and /api/code drops lines with nothing
    // to write. One POST per bill keeps that route's per-docId "saved" marker
    // correct without changing it.
    const touched = new Set<string>();
    for (const lineId of staged.keys()) {
      const l = data.lines.find((x) => x.id === lineId);
      if (l) touched.add(l.docId);
    }
    for (const lineId of Object.keys(edits)) {
      const l = data.lines.find((x) => x.id === lineId);
      if (l) touched.add(l.docId);
    }

    const pickedAll = Object.fromEntries(staged);
    const byDoc = new Map<string, { changes: LineChange[]; codingLog: RecodeEntry[] }>();
    for (const docId of touched) {
      const bill = data.bills.find((b) => b.id === docId);
      if (!bill) continue;
      const docLines = linesByDoc.get(docId) ?? [];
      const { wholeBillChanges } = billLineMath({
        lines: docLines,
        storedTax: bill.nonRecoverableTax,
        status: bill.status,
        edits,
        picked: pickedAll,
        budget: data.budget,
      });
      byDoc.set(docId, {
        changes: wholeBillChanges,
        codingLog: recodeLog(docLines, pickedAll, data.budget),
      });
    }

    let ok = 0;
    const failures: string[] = [];
    for (const [docId, { changes, codingLog }] of byDoc) {
      try {
        const r = await fetch("/api/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, changes, codingLog }),
        });
        const j = await r.json();
        if (j.error) failures.push(j.error);
        else if (j.wrote === false) failures.push(j.message ?? "Writes are disabled.");
        else {
          for (const res of j.results ?? []) {
            if (res.ok) ok++;
            else failures.push(res.error ?? "Unknown error");
          }
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Request failed");
      }
    }

    // Push staged LABOR recodes — one POST for the lot, to the same endpoint
    // Labor Review uses, so a week of hours moved from this board and a week
    // moved from that page write the identical thing.
    let timeOk = 0;
    if (timeStaged.size > 0) {
      const changes = [...timeStaged.entries()].map(([id, costItemId]) => ({ id, costItemId }));
      try {
        const r = await fetch("/api/labor-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
        });
        const j = await r.json();
        if (j.error) failures.push(j.error);
        else if (j.previewed) failures.push(j.message ?? "Writes are disabled.");
        else {
          for (const res of (j.results ?? []) as { ok: boolean; error?: string }[]) {
            if (res.ok) timeOk++;
            else failures.push(res.error ?? "Unknown error");
          }
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Time recode request failed");
      }
    }

    // Push any staged document-level tax edits — a separate loop since tax
    // isn't a line change (see taxEdits above).
    let taxOk = 0;
    for (const [docId, v] of Object.entries(taxEdits)) {
      if (v === "") continue;
      const bill = data.bills.find((b) => b.id === docId);
      if (!bill) continue;
      const amount = round2(Number(v) || 0);
      if (amount === round2(bill.nonRecoverableTax)) continue; // unchanged
      try {
        const r = await fetch("/api/bill-tax", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, taxAmount: amount }),
        });
        const j = await r.json();
        if (j.error) failures.push(j.error);
        else if (j.wrote === false) failures.push(j.message ?? "Writes are disabled.");
        else taxOk++;
      } catch (e) {
        failures.push(e instanceof Error ? e.message : "Tax request failed");
      }
    }

    setSyncing(false);
    // Same step, in order: the coding just landed in JobTread, so pull the
    // month into the Tracking Sheet too — it reads costCode off each bill
    // line and wants the coding settled first.
    // Gated on ANY successful write, not just line recodes: a tax-only sync
    // still changes what the sheet should report, and gating on `ok` alone
    // silently skipped it.
    if (trackingTarget && (ok > 0 || taxOk > 0 || timeOk > 0)) {
      const [y, m] = ym.split("-").map(Number);
      runTrackingSync(trackingTarget.projectId, m, y, setTrackingSync);
    }
    const parts = [];
    if (ok > 0) parts.push(`${ok} line${ok === 1 ? "" : "s"}`);
    if (timeOk > 0) parts.push(`${timeOk} time ${timeOk === 1 ? "entry" : "entries"}`);
    if (taxOk > 0) parts.push(`${taxOk} tax edit${taxOk === 1 ? "" : "s"}`);
    const summary = parts.length ? parts.join(" + ") : "0 changes";
    if (failures.length === 0) {
      setSyncMsg({ tone: "success", text: `Synced ${summary} to JobTread.` });
      setRestoreMsg(null);
      if (draftKey) discardDraft(draftKey); // it's in JobTread now — nothing left to hold
      await load(); // load() clears staged
    } else {
      setSyncMsg({
        tone: "error",
        text: `Synced ${summary}, ${failures.length} failed: ${[...new Set(failures)].slice(0, 2).join("; ")}`,
      });
      // A PARTLY failed sync is the worst moment to drop the draft: load() is
      // about to empty the staged state, and the changes that didn't land would
      // go with it. Re-arm the restore instead — reconcileDraft drops everything
      // JobTread has now taken, so what comes back is exactly what failed.
      restoreStartedRef.current = "";
      autosaveArmedRef.current = "";
      setRestoreMsg(null);
      await load();
    }
  };

  // Batch-approve every draft bill currently on screen (see draftBills above —
  // same filters as the visible list). One /api/bill-status POST per bill,
  // sequentially, same loop shape as sync()'s per-doc /api/code calls.
  const approveDraftBills = async () => {
    setApproving(true);
    let ok = 0;
    let previewed = false;
    const failures: string[] = [];
    for (const b of draftBills) {
      const r = await postApproval(b);
      if (r.failure) failures.push(r.failure);
      else {
        if (r.previewed) previewed = true;
        ok++;
      }
    }
    setApproving(false);
    setApproveOpen(false);
    const verb = previewed ? "Would approve" : "Approved";
    if (failures.length === 0) {
      setApproveMsg({ tone: "success", text: `${verb} ${ok} bill${ok === 1 ? "" : "s"}.` });
    } else {
      setApproveMsg({
        tone: "error",
        text: `${verb} ${ok} bill(s), ${failures.length} failed: ${[...new Set(failures)].slice(0, 2).join("; ")}`,
      });
    }
    await load();
  };

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
  // customer). The GlobalJobBar still carries the picker + address below it.
  const customerName = data?.job?.customer ?? "";
  const headerTitle = jobTitle
    ? customerName
      ? `${customerName} - ${jobTitle}`
      : jobTitle
    : c("page.recode.title");

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
    // Drives the red edge stripe: this bill is charging at least
    // one code that has already gone past its budget.
    const overBudget = [...codes.keys()].some((c) => {
      const h = headroom.get(c);
      return !!h && remainingOf(h) < 0;
    });
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
          className={`flex items-stretch transition ${
            isOpen ? "bg-accent/10" : ""
          } ${
            lines.length > 0 && !b.invoiced ? "cursor-grab active:cursor-grabbing" : ""
          }`}
        >
          {/* Status as an edge stripe, so a month can be triaged by
              colour down the left margin before a word is read: a
              wide red = flagged for review (the thing to act on,
              outranks all else), red = its coding is over budget,
              blue = already invoiced (read-only), amber = still a
              draft, none = nothing to look at. The chips below still
              spell each state out; the stripe is what makes the list
              scannable at scrolling speed. */}
          <span
            aria-hidden
            className={`shrink-0 ${b.needsReview ? "w-1 bg-red-500" : "w-0.5"} ${
              b.needsReview
                ? ""
                : b.invoiced
                  ? "bg-sky-500"
                  : overBudget
                    ? "bg-red-500"
                    : b.status === "draft"
                      ? "bg-amber-500"
                      : "bg-transparent"
            }`}
          />
          <button
            type="button"
            onClick={() => {
              // Side-panel dual navigation — see the note on the
              // cost-code lane's chips above.
              if (isMobile || !isOpen) driveMainWindowToDoc(jobId, b.id);
              if (isMobile) openBillDetail();
              else {
                setOpenTimeId(null);
                setOpenDocId(isOpen ? null : b.id);
              }
            }}
            aria-expanded={isMobile ? undefined : isOpen}
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
              <span className="shrink-0 text-base font-semibold tabular-nums">
                {money(b.cost)}
              </span>
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
                  <Chip key="nofile" tone="warning" title="No file attached to this bill in JobTread">
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
              <span className="mt-1 block truncate text-[11.5px] tabular-nums text-neutral-500 dark:text-neutral-400">
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
                          {code || "uncoded"} {money0(amt)}
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
   * is never wrong. Shared by the desktop toolbar and the mobile action drawer,
   * so `cls` carries the width each context wants.
   */
  const trackingSheetAction = (cls: string) => {
    if (!canTrack || !trackingChecked) return null;
    if (trackingTarget) {
      return (
        <Button
          variant="secondary"
          size="sm"
          className={cls}
          disabled={syncing || trackingBusy}
          title={`Push ${monthLabel(ym)} into ${trackingTarget.label}`}
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
      <Link href="/tracking-sheet" className={btn("secondary", "sm", `text-center ${cls}`)}>
        Link Google tracking sheet
      </Link>
    );
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 lg:max-w-[110rem]">
      {/* The job and its address used to be printed here — once as a phone-only
          line above the title and again as the header description from lg up.
          The GlobalJobBar carries both now (picker + address line), so this page
          says what it's FOR instead of repeating where you are. */}
      <PageHeader
        title={headerTitle}
        actionsClassName="w-full min-w-0 items-center lg:w-auto"
        actions={
          // On a phone the toolbar is a stack of clearly separated groups —
          // month, then filters, then actions — rather than one wrapping row
          // of eleven controls at mixed sizes. From lg up it collapses back to
          // the single inline row the desktop workbench has always had.
          <div className="flex w-full min-w-0 flex-col gap-3 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
            {/* The month is the control changed most often here, so on mobile
                it gets a label and the full width instead of being an
                unlabelled box wedged between the title and four toggles. */}
            <div className="min-w-0">
              <Label htmlFor="recode-month" className="lg:hidden">
                Billing month
              </Label>
              {/* The month selector and, docked to it, the per-job Tracking
                  Sheet push: it writes the SELECTED month's sub/vendor invoices
                  into the SELECTED job's own Google tracking sheet. It sits by
                  the month because that is the one thing it acts on. Stacked
                  under the selector on a phone, inline beside it from lg up. */}
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <Select
                  id="recode-month"
                  value={ym}
                  onChange={(e) => setYm(e.target.value)}
                  className="!h-11 lg:!h-auto lg:w-52"
                  aria-label="Billing month"
                >
                  {monthOptions().map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                {trackingSheetAction("!h-11 w-full shrink-0 lg:!h-auto lg:w-auto")}
              </div>
            </div>
            {/* The list always shows every bill in the month — draft,
                uninvoiced, and invoiced, each tagged with its state — and every
                time entry counts toward the figures, approved or not, each row
                tagged with its own approval state. No view filter to set. */}
            {/* Bill lines AND labor — both ride the same Sync, so a chip that
                counted only the lines read "0 staged changes" next to an armed
                Sync button after a week of hours had been moved. */}
            {dirty && (
              <span className="inline-flex shrink-0 items-center self-start rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {stagedCount} staged change{stagedCount === 1 ? "" : "s"}
              </span>
            )}
            {/* The three actions share ONE full-width row on mobile — button
                labels are nowrap, so the long ones are shortened below the lg
                breakpoint to make three fit across a phone. `lg:contents`
                dissolves this wrapper from lg up, putting the buttons back as
                direct children of the toolbar exactly as before. `min-h-11`
                gives them a thumb-sized hit area on touch and is dropped again
                at lg so the desktop toolbar keeps its density. */}
            <div className="flex w-full items-center gap-2 lg:contents">
              {/* Revert and Sync are the page's commit actions, so on a phone
                  they ride the sticky bar at the bottom of the screen (near the
                  thumb, and in view wherever you've scrolled to) instead of the
                  toolbar at the top, which is the one place you are NOT looking
                  after dragging a line. The desktop toolbar keeps them inline. */}
              <Button
                variant="secondary"
                size="sm"
                onClick={revertAll}
                disabled={!dirty || syncing}
                className="hidden lg:inline-flex"
              >
                Revert
              </Button>
              {/* The coding commit: it writes staged coding to JobTread and
                  then pushes the month into the Tracking Sheet in the same step
                  (coding must settle before the sheet reads costCode off each
                  line). The standalone sheet push, with nothing staged, is the
                  Tracking Sheet button beside the month selector above, so this
                  one is purely the JobTread write and stays greyed out until
                  dirty. */}
              <Button
                size="sm"
                onClick={sync}
                disabled={!dirty || syncing || trackingBusy}
                className="hidden lg:inline-flex"
              >
                {syncing ? "Saving…" : trackingBusy ? "Syncing sheet…" : "Save Changes"}
              </Button>
            </div>
          </div>
        }
      />

      {/* This job's ingested bills that never reached JobTread — the green
          "all in JobTread" all-clear, or the amber "Not in JobTread" queue.
          Placed directly beneath the title: it's the first thing to know about
          the job before reading any of its numbers. They're absent from every
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

      {data && !loading && (
        // All three columns share the row equally.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {/* ─────────── LEFT: cost-code reference rail ─────────── */}
          {/* Docked: the rail is the reference you're constantly checking while
              scrolling a long bill list, so it stays put. `self-start` is what
              makes sticky work in a grid — items stretch to the row height by
              default, leaving nothing to scroll within. */}
          <section className="min-w-0 lg:sticky sticky-below-header lg:self-start">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              {/* On mobile the label itself is the toggle for the whole rail;
                  on desktop the rail is always docked, so the tap is disabled
                  and the chevron hidden. */}
              <button
                type="button"
                onClick={() => setRailCollapsed((v) => !v)}
                aria-expanded={!railCollapsed}
                className="-ml-1 flex min-h-11 min-w-0 items-center gap-1.5 px-1 text-left lg:pointer-events-none lg:ml-0 lg:min-h-0 lg:px-0"
              >
                <span
                  aria-hidden
                  className={`shrink-0 text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 lg:hidden ${
                    railCollapsed ? "" : "rotate-90"
                  }`}
                >
                  ▶
                </span>
                <SectionLabel>Budget</SectionLabel>
              </button>
              <button
                type="button"
                onClick={() =>
                  setCollapsedDivs((prev) =>
                    prev.size > 0 ? new Set() : new Set(railGroups.map((g) => g.code)),
                  )
                }
                className={`-mr-1 inline-flex min-h-11 shrink-0 items-center px-1 text-[11px] text-neutral-500 transition hover:text-accent dark:text-neutral-400 lg:mr-0 lg:min-h-0 lg:px-0 ${
                  railCollapsed ? "hidden lg:inline-flex" : ""
                }`}
              >
                {collapsedDivs.size > 0 ? "Expand all" : "Collapse all"}
              </button>
            </div>
            <Card
              pad={false}
              className={`overflow-hidden ${railCollapsed ? "hidden lg:block" : ""}`}
            >
              <input
                type="search"
                value={codeQuery}
                onChange={(e) => setCodeQuery(e.target.value)}
                placeholder={c("recode.placeholder.filterCodes")}
                className="h-11 w-full border-b border-line bg-transparent px-3 text-xs outline-none dark:border-white/10 lg:h-auto lg:px-2 lg:py-1.5"
              />
              {/* Sized off the viewport, not a %, so the docked rail (label +
                  card + footnote) always fits on screen and scrolls internally.
                  `dvh` rather than `vh`, so a phone's collapsing address bar
                  doesn't leave the rail taller than the screen it's in. */}
              <div className="max-h-[calc(100dvh-16rem)] overflow-y-auto">
                {railRows.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-neutral-500">No cost codes match.</p>
                ) : (
                  railGroups.map((g) => {
                    // A filter term force-opens the divisions it matched —
                    // otherwise searching a collapsed rail looks like it found
                    // nothing.
                    const open = !collapsedDivs.has(g.code) || codeQuery.trim() !== "";
                    return (
                      <div key={g.code}>
                        <button
                          type="button"
                          onClick={() => toggleDiv(g.code)}
                          aria-expanded={open}
                          // A collapsed division hides its codes, and with them
                          // their drop targets — so dragging onto the header
                          // opens it instead of dead-ending the drag.
                          onDragOver={() => {
                            if (dragLineIds && collapsedDivs.has(g.code)) toggleDiv(g.code);
                          }}
                          // Division headers and code rows are tap targets that
                          // open a drill-down, so on touch they get real height
                          // (they were ~26px); `lg` restores the dense rail the
                          // desktop workbench scans dozens of codes in.
                          className="w-full border-b border-line bg-neutral-50/80 px-3 py-2.5 text-left transition hover:bg-accent/5 dark:border-neutral-800 dark:bg-white/[0.04] dark:hover:bg-white/[0.07] lg:px-2 lg:py-1"
                        >
                          <div className="flex items-center gap-1.5 lg:items-baseline">
                            <span
                              aria-hidden
                              className={`shrink-0 text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${open ? "rotate-90" : ""}`}
                            >
                              ▶
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                              <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                                {g.code}
                              </span>{" "}
                              {g.name}
                            </span>
                            <span className="shrink-0 text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
                              {g.rows.length}
                            </span>
                            <span
                              className={`shrink-0 text-xs font-semibold tabular-nums ${
                                g.remaining < 0 ? "text-red-600 dark:text-red-400" : ""
                              }`}
                            >
                              {money0(g.remaining)}
                            </span>
                          </div>
                          {/* The whole sentence, on every division and every
                              code: what's been used, of what, and what's left.
                              Reading one number and having to open a tooltip
                              for the other two is what made the rail hard to
                              trust. */}
                          <BudgetLine used={g.used} budget={g.budget} remaining={g.remaining} />
                        </button>

                        {/* Rolled up, the division still shows its own bar, so a
                            tidy rail is still a readable one. */}
                        {!open && (
                          <div className="border-b border-line-soft px-2 pb-1 dark:border-neutral-800">
                            <Meter budget={g.budget} used={g.used} label={`Division ${g.code}`} />
                          </div>
                        )}

                        {open && (
                          <ul>
                            {g.rows.map((h) => {
                              const left = remainingOf(h);
                              const over = left < 0;
                              // Remaining ÷ budget — undefined without a real budget to
                              // divide by (a labor-only or bills-only code), same guard
                              // the Meter's own percentage uses.
                              const pct = h.budget > 0 ? Math.round((left / h.budget) * 100) : null;
                              return (
                                // Two lines, not four: the spent/budget breakdown
                                // moves into the tooltip so the rail shows ~2× the
                                // codes per screen. Scanning for headroom means
                                // comparing many codes at once — density is the
                                // feature.
                                <li
                                  key={h.code}
                                  {...dropHandlers(h.code, h.droppable)}
                                  title={
                                    `${h.code} ${h.name}\n` +
                                    `${money(h.spent)} committed` +
                                    (h.drafts > 0 ? ` + ${money(h.drafts)} draft` : "") +
                                    (h.labor > 0 ? ` + ${money(h.labor)} labor` : "") +
                                    ` of ${money(h.budget)} budget\n${money(left)} remaining` +
                                    (pct !== null ? ` (${pct}% of budget)` : "") +
                                    (h.droppable ? "" : "\nNo budget line — can't code to this")
                                  }
                                  className={`border-b border-line-soft transition dark:border-neutral-800 ${
                                    dragOverCode === h.code
                                      ? "bg-accent/10 ring-1 ring-inset ring-accent"
                                      : dragLineIds && !h.droppable
                                        ? "opacity-40"
                                        : ""
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => openCodeDrill(h.code)}
                                    className="w-full px-3 py-2 pl-5 text-left transition hover:opacity-70 lg:px-2 lg:py-1 lg:pl-4"
                                  >
                                    <div className="flex items-baseline justify-between gap-2">
                                      <span className="min-w-0 truncate text-xs">
                                        <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                                          {h.code}
                                        </span>{" "}
                                        <span
                                          className={
                                            h.droppable
                                              ? ""
                                              : "text-neutral-500 dark:text-neutral-400"
                                          }
                                        >
                                          {h.name}
                                        </span>
                                      </span>
                                      <span
                                        className={`shrink-0 text-xs font-semibold tabular-nums ${
                                          over ? "text-red-600 dark:text-red-400" : ""
                                        }`}
                                      >
                                        {money0(left)}
                                        {pct !== null && (
                                          <span className="ml-1 font-normal text-neutral-500 dark:text-neutral-400">
                                            {pct}%
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                    <BudgetLine
                                      used={usedOf(h)}
                                      budget={h.budget}
                                      remaining={left}
                                    />
                                    <Meter budget={h.budget} used={usedOf(h)} label={h.code} />
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
            <p
              className={`mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400 ${
                railCollapsed ? "hidden lg:block" : ""
              }`}
            >
              Remaining = budget − committed − this month&apos;s drafts − labor. Committed is
              approved and pending bills across all time; drafts aren&apos;t committed spend yet;
              labor is logged time entries, which a customer invoice bills alongside the bills —
              every entry counts, approved or not, and each is tagged with its approval state.
              Hover a code for the breakdown. Bars and remaining update as you recode.
            </p>
          </section>

          {/* ─────────── CENTRE: the month's bills ─────────── */}
          <section className="min-w-0">
            {/* The month's headline figure, over the ochre rule. It's what the
                whole page is working toward, and on a phone it's the one number
                worth reading from arm's length. The footnote carries the
                distinction that matters at invoicing time: JobTread won't pull a
                draft onto an invoice, so the figure above is what the month WILL
                bill and the footnote is what it can bill today. */}
            <StatementBlock
              className="mb-4"
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
              footnote={
                recon
                  ? `${money(recon.uninvoicedBillsCost)} uninvoiced bills + ${money(
                      recon.uninvoicedTimeCost,
                    )} uninvoiced time.` +
                    (recon.draftBillCount > 0
                      ? " Drafts join the invoiceable total once approved in JobTread."
                      : "")
                  : undefined
              }
            />

            {/* Budget headroom on the phone — the desktop rail is a docked
                column, which below lg is collapsed behind a tap, so this is
                where the budget becomes visible on the device the month is
                actually reviewed on. Swipeable, tightest code first; tapping one
                opens the same drill-down the rail's rows do. */}
            {tightestCodes.length > 0 && (
              <div className="mb-4 lg:hidden">
                <SectionHeading
                  className="mb-2"
                  trailing={
                    <span className="text-[11px] text-neutral-500">tightest first</span>
                  }
                >
                  Budget headroom
                </SectionHeading>
                <ChipScroller bleed="1rem">
                  {tightestCodes.map((h) => {
                    const left = remainingOf(h);
                    const pct = Math.round((left / h.budget) * 100);
                    return (
                      <button
                        key={h.code}
                        type="button"
                        onClick={() => openCodeDrill(h.code)}
                        className="w-[170px] shrink-0 rounded-xl border border-line bg-white p-2.5 text-left transition hover:border-accent dark:bg-ink-raised"
                      >
                        <div className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
                          {h.code}
                        </div>
                        <div className="truncate text-[12.5px] font-semibold">{h.name}</div>
                        <div
                          className={`mt-0.5 text-[15px] font-bold tabular-nums tracking-tight ${
                            left < 0 ? "text-red-600 dark:text-red-400" : ""
                          }`}
                        >
                          {money0(left)}
                        </div>
                        <Meter budget={h.budget} used={usedOf(h)} label={h.code} className="mt-1.5 h-1" />
                        <div className="mt-1 text-[10.5px] text-neutral-500 dark:text-neutral-400">
                          {left < 0 ? `over by ${-pct}%` : `${pct}% of budget left`}
                        </div>
                      </button>
                    );
                  })}
                </ChipScroller>
              </div>
            )}

            <SectionHeading
              // Wraps, because the label and a three-way switch do not fit on
              // one 375px line: the switch drops to its own right-aligned row
              // on a phone and sits inline again as soon as there is room.
              className="mb-2 flex-wrap gap-y-2"
              trailing={
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
            >
              {`${data.bills.length} bill${data.bills.length === 1 ? "" : "s"}`} ·{" "}
              {money(data.billTotal)}
            </SectionHeading>

            {mode !== "summary" && (
              <p className="mb-2 hidden text-[11px] text-neutral-400 lg:block">
                Drag a line — or a whole bill — onto a cost code (here or in the rail) to recode it.
                Nothing is written until you Sync.
              </p>
            )}

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
                    Time &amp; labor ({monthTime.length}{" "}
                    {monthTime.length === 1 ? "entry" : "entries"})
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
                {/* The month's COMPANY-WIDE Labor Report, on its own hairline row
                    rather than in the header above: it is the one control in
                    this card that is NOT about this job. It takes only the
                    selected month and reports every job's hours, which is why
                    it says so beside itself. Outside the collapse, because a
                    month with the list shut is exactly when payroll wants it. */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line-soft px-3 py-2">
                  <span className="min-w-0 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                    Every job&apos;s hours this month, filed in the Drive Labor folder.
                  </span>
                  <LaborReportButton ym={ym} className="items-end text-right" />
                </div>
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
                      monthEntries={monthTime}
                      codeOf={timeCodeOf}
                      headroomFor={timeHeadroomFor}
                      isMoved={(t) => timeStaged.has(t.id)}
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
                          codeOptions={timeCodeOptions}
                          leafOf={timeLeafOf}
                          onPick={stageTimeSelection}
                          isStaged={(t) => timeStaged.has(t.id)}
                          onUndo={undoTimeStage}
                          jtHref={`https://app.jobtread.com/jobs/${jobId}/time`}
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
                          {monthLabel(ym)} already {recon.invoices.length === 1 ? "exists" : "exist"}
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
                      <>
                        <JtLink
                          href={`https://app.jobtread.com/jobs/${jobId}/documents`}
                          className={btn("primary", "md", "mt-3 w-full")}
                        >
                          Create invoice in JobTread ↗
                        </JtLink>
                        <p className="mt-2 text-xs text-neutral-500">
                          Open this job in JobTread, then <b>New → Customer Invoice</b> — its builder
                          pulls exactly these uninvoiced bills (and any uninvoiced time). Date it{" "}
                          {issueDateFor(ym)}, review &amp; send.
                        </p>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {/* ---- grouped by cost code: the drag surface ---- */}
            {mode === "code" &&
              (laneRows.length === 0 ? (
                <EmptyState>{c("recode.empty.noCodedLines")}</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {laneRows.map(({ code, h, stacks, total }) => (
                    <li key={code}>
                      <Card
                        pad={false}
                        {...dropHandlers(code, h?.droppable ?? false)}
                        className={`transition ${
                          dragOverCode === code ? "ring-2 ring-accent" : ""
                        } ${dragLineIds && !h?.droppable ? "opacity-40" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-2 border-b border-line-soft px-3 py-2 dark:border-neutral-800">
                          <span className="min-w-0 truncate">
                            <span className="text-xs tabular-nums text-neutral-500">{code}</span>{" "}
                            <span className="text-sm font-semibold">{h?.name ?? ""}</span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums">
                            {money0(total)} here ·{" "}
                            <span
                              className={
                                h && remainingOf(h) < 0
                                  ? "font-semibold text-red-600 dark:text-red-400"
                                  : "text-neutral-500"
                              }
                            >
                              {h ? money0(remainingOf(h)) : "—"} left
                            </span>
                          </span>
                        </div>
                        <ul className="flex flex-wrap gap-1.5 p-2">
                          {stacks.map((s) => {
                            const moved = s.lines.some((l) => staged.has(l.id));
                            return (
                              <li key={s.key}>
                                <div
                                  draggable={!s.invoiced}
                                  onDragStart={beginDrag(s.lines.map((l) => l.id))}
                                  onDragEnd={endDrag}
                                  // Same rule the bill list follows: on a phone
                                  // the coding drawer is hidden, so setOpenDocId
                                  // would open nothing and the tap would read as
                                  // dead. Send it to the bill's detail page
                                  // instead, carrying the same back-context.
                                  onClick={() => {
                                    // In the Chrome side panel this app runs in
                                    // an iframe beside a JobTread tab; opening a
                                    // bill here drives that window to the same
                                    // document. No-op when unframed.
                                    driveMainWindowToDoc(jobId, s.docId);
                                    if (isMobile) {
                                      router.push(
                                        `/bill/${s.docId}?jobId=${encodeURIComponent(jobId)}` +
                                          `&from=recode&ym=${encodeURIComponent(ym)}`,
                                      );
                                    } else {
                                      // The coding column shows one thing —
                                      // claiming it for a bill releases the
                                      // time entry that had it.
                                      setOpenTimeId(null);
                                      setOpenDocId(s.docId);
                                    }
                                  }}
                                  title={s.lines.map((l) => l.name).join("\n")}
                                  className={`rounded-md border px-2 py-1.5 text-[11px] transition lg:py-1 ${
                                    s.invoiced ? "" : "cursor-grab active:cursor-grabbing"
                                  } ${
                                    moved
                                      ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
                                      : "border-line bg-white hover:border-accent dark:border-neutral-700 dark:bg-ink-overlay"
                                  }`}
                                >
                                  <span className="block max-w-[16rem] truncate font-medium">
                                    {s.label}
                                    {/* Several lines of ONE bill in one lane stack into a single chip. */}
                                    {s.lines.length > 1 && (
                                      <span className="ml-1 rounded bg-neutral-200 px-1 text-[10px] tabular-nums dark:bg-neutral-700">
                                        ×{s.lines.length}
                                      </span>
                                    )}
                                  </span>
                                  <span className="block tabular-nums text-neutral-500">
                                    {money0(s.cost)}
                                    {s.status === "draft" && " · draft"}
                                    {s.invoiced && " · invoiced"}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </Card>
                    </li>
                  ))}
                </ul>
              ))}

            {mode === "bill" && data.bills.length === 0 ? (
              <EmptyState>{c("recode.empty.noBills")}</EmptyState>
            ) : mode === "bill" ? (
              <>
                {nonSunsetBills.length > 0 && (
                  <Card pad={false} className="overflow-hidden">
                    <ul className="divide-y divide-line-soft">
                      {nonSunsetBills.map(renderBillCard)}
                    </ul>
                  </Card>
                )}

                {/* Sunset bills, folded into their own collapsible pane — the
                    same treatment as the Time & labor block above. Sunset's high
                    invoice count is noise when you're deciding where to move
                    money, so it's pushed to the bottom of the list and collapsed
                    by default; its cost is already in every figure on the page,
                    so folding it away never changes a number. */}
                {sunsetBills.length > 0 && (
                  <Card pad={false} className="mt-2 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSunsetBlockOpen((v) => !v)}
                      aria-expanded={sunsetBlockOpen}
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5 lg:py-2"
                    >
                      <span className="min-w-0 truncate text-sm font-semibold">
                        <span
                          aria-hidden
                          className={`mr-1.5 inline-block text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${
                            sunsetBlockOpen ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                        Sunset ({sunsetBills.length} bill{sunsetBills.length === 1 ? "" : "s"})
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {money(sunsetTotal)}
                      </span>
                    </button>
                    {sunsetBlockOpen && (
                      <ul className="divide-y divide-line-soft border-t border-line-soft bg-neutral-50 dark:bg-ink-raised/50">
                        {sunsetBills.map(renderBillCard)}
                      </ul>
                    )}
                  </Card>
                )}
              </>
            ) : null}
          </section>

          {/* ─────────── RIGHT: coding drawer ─────────── */}
          {/* `sticky` + `top` live on the SECTION itself (the actual grid
              item), not on a card nested inside it — a sticky descendant is
              bounded by its own immediate containing block, and a plain
              wrapper div only grows to fit its own (short) content, so a
              sticky child inside one runs out of room to travel almost
              immediately and just scrolls away past that point. Putting it on
              the grid item gives it the full row height to stick within,
              same as the rail. Confirmed with an isolated repro 2026-08-06 —
              the nested-Card version measurably stopped sticking after
              ~460px of scroll. `self-start` keeps this item from stretching
              to the row's height in the first place. Opens level with the top
              of the screen (not the clicked bill) — simpler and more
              predictable than tracking the click position. */}
          <section className="hidden min-w-0 xl:block xl:sticky sticky-below-header xl:self-start">
            {/* One column, three subjects, in order of how specific the claim
                is: ONE entry being edited (a row clicked), then a SELECTION
                being recoded, then the bills. The office codes labor exactly where it
                codes a bill instead of learning a second layout — and the
                recode drawer is the same component Labor Review shows, so the
                two pages move a week of hours identically. */}
            {openTime && !belowXl ? (
              <>
                <SectionLabel className="mb-2">Time &amp; labor</SectionLabel>
                <TimeCodingCard
                  entry={openTime}
                  jobId={jobId}
                  codeOptions={timeCodeOptions}
                  writes={Boolean(data?.writesEnabled)}
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
                  codeOptions={timeCodeOptions}
                  leafOf={timeLeafOf}
                  onPick={stageTimeSelection}
                  isStaged={(t) => timeStaged.has(t.id)}
                  onUndo={undoTimeStage}
                  jtHref={`https://app.jobtread.com/jobs/${jobId}/time`}
                  onApproved={markTimeApproved}
                  writes={Boolean(data?.writesEnabled)}
                />
              </>
            ) : (
              <BillCodingCard ctl={codingCtl} />
            )}
          </section>
        </div>
      )}

      {/* The month's closing actions, docked at the bottom of the page: check
          the job, then approve its drafts. Both are last steps — you check what
          the invoice will say, and you approve the drafts once their coding is
          settled — so they share one row after the bills rather than sitting up
          in the toolbar. Once every bill in the month is approved the Approve
          button becomes "Create Invoice in JobTread", which opens the job's
          documents page — approving IS the last thing this page does, and the
          invoice itself is built in JobTread. `order-last` drops the block
          below the columns on a phone. The check's result card sits directly
          above the row it was run from, and only once there is a result to
          show; the check itself is independent of the board's own loading,
          since it fetches on demand. The check button is lg-only — on a phone
          the action drawer carries it, so this row holds the full-width action
          button alone, exactly as before. Either button is dead while there's
          staged coding to sync first. */}
      {jobId && (
        <div
          className={`order-last mt-4 border-t border-line pt-4 lg:order-none ${
            // Nothing visible below lg until there's a result or an Approve
            // button — without this the phone would show a bare divider.
            showApprove || preSend || preSendError || preSendRunning ? "" : "hidden lg:block"
          }`}
        >
          {(preSend || preSendError || preSendRunning) && (
            <PreSendCheck result={preSend} error={preSendError} />
          )}
          <div className="mx-auto flex max-w-2xl items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={runPreSend}
              disabled={preSendRunning}
              className="hidden min-h-11 lg:inline-flex"
            >
              {preSendRunning ? "Checking…" : preSend ? "Check again" : "Check this job"}
            </Button>
            {showApprove &&
              (allApproved ? (
                /* Every bill is approved, so the next step is JobTread's own
                   invoice builder — New → Customer Invoice on the job's
                   documents page pulls exactly these uninvoiced bills. Same
                   destination and same wording as /stage's button. Staged
                   coding still blocks it: an invoice built now would carry the
                   OLD cost codes, so sync first. A disabled <a> is not a
                   thing, hence the button/link swap. */
                dirty ? (
                  <Button
                    disabled
                    title="Sync staged coding changes to JobTread first"
                    className="min-h-11 w-full lg:w-auto"
                  >
                    Create Invoice in JobTread ↗
                  </Button>
                ) : (
                  <JtLink
                    href={`https://app.jobtread.com/jobs/${jobId}/documents`}
                    className={btn("primary", "md", "min-h-11 w-full lg:w-auto")}
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
                  title={dirty ? "Sync staged coding changes to JobTread first" : undefined}
                  className="min-h-11 w-full lg:w-auto"
                >
                  Approve Draft Bills{draftBills.length > 0 ? ` (${draftBills.length})` : ""}
                </Button>
              ))}
          </div>
        </div>
      )}

      {/* The phone's commit bar — the action drawer. With staged coding it
          carries Revert + Save Changes; with nothing staged it holds the
          "Check this job" trigger for the Before-you-send card, so that action
          is under the thumb rather than up in the card header. It pins above the
          tab bar, so the action is in reach wherever you've scrolled to.
          `order-last` keeps it at the bottom of the flex column even though the
          reconcile block above also claims that order on a phone; both are last
          in DOM order here, so they stack in source order. From lg up the
          toolbar and the card's own button take over and this is hidden. */}
      {(dirty || !!jobId) && (
        <StickyActionBar className="order-last mt-4 lg:hidden">
          {dirty ? (
            <>
              <span className="flex-1 text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">
                {stagedCount} staged change{stagedCount === 1 ? "" : "s"}
                <span className="block text-[10.5px] font-medium text-neutral-500 dark:text-neutral-400">
                  Nothing is written until you sync
                </span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={revertAll}
                disabled={syncing}
                className="min-h-11"
              >
                Revert
              </Button>
              <Button size="sm" onClick={sync} disabled={syncing} className="min-h-11">
                {syncing ? "Saving…" : "Save Changes"}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={runPreSend}
              disabled={preSendRunning || !jobId}
              className="min-h-11 w-full"
            >
              {preSendRunning ? "Checking…" : preSend ? "Check again" : "Check this job"}
            </Button>
          )}
        </StickyActionBar>
      )}

      {/* The Time & labor panel, where the coding column doesn't fit. Same
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

      {/* Cost-code drill-down: every bill and time entry behind a rail row's
          total, so "why is this over budget" doesn't require a trip to the
          Tracking Sheet. */}
      {codeDrill && (
        // Bottom sheet on a phone, centred dialog from sm up: anchored to the
        // bottom edge it opens inside the thumb's reach and its Close button
        // lands where the hand already is, instead of at the top of a box
        // floating mid-screen. `dvh` keeps it inside the visible viewport when
        // the browser chrome collapses, and the safe-area pad keeps the last
        // row clear of the home indicator.
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setCodeDrill(null)}
        >
          <Card
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-b-none pb-[max(0.75rem,env(safe-area-inset-bottom))] !p-4 sm:rounded-b-xl sm:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const h = headroom.get(codeDrill);
              return (
                <>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold">
                      <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                        {codeDrill}
                      </span>{" "}
                      {h?.name ?? ""}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="min-h-11 shrink-0 sm:min-h-0"
                      onClick={() => setCodeDrill(null)}
                    >
                      Close
                    </Button>
                  </div>
                  {h && (
                    <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
                      {money(h.spent)} committed
                      {h.drafts > 0 ? ` + ${money(h.drafts)} draft` : ""}
                      {h.labor > 0 ? ` + ${money(h.labor)} labor` : ""}
                      {` of ${money(h.budget)} budget · `}
                      <span
                        className={
                          remainingOf(h) < 0 ? "font-semibold text-red-600 dark:text-red-400" : ""
                        }
                      >
                        {money(remainingOf(h))} remaining
                      </span>
                    </p>
                  )}

                  {contributorsLoading ? (
                    <Loading label={c("recode.loading.billsAndTime")} />
                  ) : contributorsError ? (
                    <Banner tone="error">{contributorsError}</Banner>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <SectionLabel className="mb-1.5">
                          Bills ({drillBills.length})
                        </SectionLabel>
                        {drillBills.length === 0 ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            No bills coded to this code.
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {drillBills.map((b) => (
                              <li
                                key={b.key}
                                className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs dark:border-neutral-800"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-medium">{b.vendor}</span>
                                  {b.lineName && b.lineName !== b.vendor ? ` · ${b.lineName}` : ""}
                                  <span className="ml-1 text-neutral-500 dark:text-neutral-400">
                                    {b.issueDate ?? ""}
                                    {b.draft ? " · draft, not yet synced" : b.status ? ` · ${b.status}` : ""}
                                  </span>
                                </span>
                                <span className="shrink-0 tabular-nums font-semibold">
                                  {money(b.cost)}
                                </span>
                                {!b.draft && (
                                  <JtLink
                                    href={`https://app.jobtread.com/jobs/${jobId}/documents/${b.docId}`}
                                    className="-my-2 inline-flex min-h-11 shrink-0 items-center px-1 font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
                                  >
                                    JT ↗
                                  </JtLink>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div>
                        <SectionLabel className="mb-1.5">
                          Time entries ({drillTime.length})
                        </SectionLabel>
                        {drillTime.length === 0 ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            No time logged to this code.
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {drillTime.map((t) => (
                              <li
                                key={t.id}
                                className="rounded-lg border border-line px-2.5 py-2 text-xs dark:border-neutral-800"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate">
                                    <span className="font-medium">{t.employee}</span>
                                    <span className="ml-1 text-neutral-500 dark:text-neutral-400">
                                      {t.startedAt ? t.startedAt.slice(0, 10) : ""}
                                    </span>
                                  </span>
                                  <Chip
                                    tone={t.isApproved ? "success" : "warning"}
                                    className="shrink-0"
                                    title={
                                      t.isApproved
                                        ? "This time entry is approved in JobTread"
                                        : "This time entry is not yet approved in JobTread"
                                    }
                                  >
                                    {t.isApproved ? "approved" : "unapproved"}
                                  </Chip>
                                  {/* Hours read alongside the amount they cost —
                                      "1.0h · $85" — matching the Time & labor list. */}
                                  <span className="shrink-0 tabular-nums font-semibold">
                                    {t.hours.toFixed(1)}h · {money(t.cost)}
                                  </span>
                                </div>
                                {/* Same treatment as the "Time & labor" block's
                                    entries — the note is what the crew typed
                                    about the hours, so it wraps in full rather
                                    than truncating. Reaching an entry by cost
                                    code shouldn't show less than reaching it
                                    down the bills list. */}
                                {t.notes && (
                                  <p className="mt-0.5 whitespace-pre-line text-[11px] leading-snug text-neutral-600 dark:text-neutral-400">
                                    {t.notes}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </Card>
        </div>
      )}

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
              {leafPicker.lineIds.length === 1
                ? "1 line"
                : `${leafPicker.lineIds.length} lines`}
              .
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
              {monthOptions().find((o) => o.value === ym)?.label ?? ym}
              {jobTitle ? ` · ${jobTitle}` : ""}. Bills move to Pending (approved for payment);
              Expenses move straight to Approved (paid).
            </p>
            <ul className="max-h-[40dvh] space-y-2 overflow-y-auto">
              {draftBills.map((b) => {
                const target = approvalTarget(b);
                const taxOn = (b.nonRecoverableTax ?? 0) > 0;
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
                        {b.nonRecoverableTaxName || "Tax"}: {taxOn ? money(b.nonRecoverableTax) : "Off"}
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
    </main>
  );
}
