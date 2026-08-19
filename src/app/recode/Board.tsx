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
  FilterChip,
  Label,
  Loading,
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
  billLineMath,
  descriptionForCode,
  recodeLog,
  round2,
  type LineChange,
  type LineEdit,
  type RecodeEntry,
} from "@/lib/billLineMath";
import { InvoiceReconcile, type Recon } from "@/components/InvoiceReconcile";
import { UncapturedBills } from "@/components/UncapturedBills";
import {
  Breakdown,
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
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

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
 * Everything the board reads comes from /api/recode in one fetch.
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
  saved: boolean;
  reviewed: boolean;
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
interface MonthTimeEntry {
  id: string;
  employee: string;
  startedAt: string | null;
  hours: number;
  cost: number;
  code: string;
  codeName: string;
  notes: string;
  isApproved: boolean;
}
interface BudgetItem {
  id: string;
  number: string;
  name: string;
  detail?: string;
  costType?: string;
  cost?: number;
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
  job: { id: string; name: string; address: string } | null;
  bills: BillRef[];
  billTotal: number;
  lines: JobBillLine[];
  timeEntries: MonthTimeEntry[];
  budget: BudgetItem[];
  costDetail: { divisions: CostDivisionRow[]; budgetBasis: string };
  writesEnabled: boolean;
  error?: string;
}

/** One vendor-bill line behind a cost code's "bills" total — from /api/recode/contributors. */
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
/** One time entry behind a cost code's "labor" total — from /api/recode/contributors. */
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

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** Draft bills are coded but not yet committed spend — JobTread's own budget math excludes them. */
const isCommitted = (status: string) => status === "pending" || status === "approved";

interface BillFile {
  id: string;
  name?: string;
  type?: string;
  url?: string;
}
/** Same test the bill page uses — images embed, everything else gets an iframe. */
const isImageFile = (f: BillFile) =>
  /^image\//i.test(f.type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");

/**
 * Sunset Builders Supply, matched the same way the rest of the codebase does
 * (`/sunset/i` on the vendor name — see getUninvoicedBills / getMonthlyInvoiceJobs).
 * The high invoice count makes it noise when you're deciding where to move money,
 * so it can be hidden — but ONLY from the list. Its cost stays in every budget
 * figure on this page; see the note where hideSunset is applied.
 */
const isSunsetVendor = (vendor: string) => /sunset/i.test(vendor);

/**
 * The "Hide Sunset" toggle is a personal display preference, so it persists in
 * localStorage and survives navigating away and back. Same-device only — it's a
 * view convenience, not shared/authoritative state.
 */
const LS_HIDE_SUNSET = "recode:hideSunset";

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

export function Board() {
  // Office-edited wording (Admin → Page Text); see src/lib/copy.ts.
  const c = useCopy();
  const params = useSearchParams();
  const router = useRouter();
  const isMobile = useIsMobile();
  const jobId = params.get("jobId") ?? "";

  const [ym, setYm] = useState(() => params.get("ym") || defaultYm());
  const [includeDrafts, setIncludeDrafts] = useState(true);
  // Off shows a past, fully-invoiced month's bills too (read-only — see
  // BillRef.invoiced gating below), matching the "Uninvoiced only" toggle on
  // /stage. Defaults on so the live coding month's behavior is unchanged.
  const [uninvoicedOnly, setUninvoicedOnly] = useState(true);
  // Display-only filter. Defaults OFF: hiding bills by default would mean the
  // list silently disagrees with the totals until someone noticed the toggle.
  // The choice persists per-device (LS_HIDE_SUNSET) so it survives navigation —
  // loaded from localStorage on mount, written back whenever it changes below.
  const [hideSunset, setHideSunset] = useState(false);
  // Display-only filter, computed client-side from costDetail's two labor
  // figures (no refetch on toggle). Defaults ON so the existing behavior —
  // every time entry counts, approved or not — doesn't change until someone
  // deliberately narrows it.
  const [includeUnapprovedTime, setIncludeUnapprovedTime] = useState(true);
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

  // Restore the persisted "Hide Sunset" choice on mount. Read in an effect (not
  // a lazy useState initializer) so SSR and the first client render agree — no
  // hydration mismatch — then reconcile to the saved value. Runs once.
  const hideSunsetLoaded = useRef(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_HIDE_SUNSET);
      if (saved != null) setHideSunset(saved === "1");
    } catch {
      /* localStorage unavailable (private mode, etc.) — fall back to the default */
    }
    hideSunsetLoaded.current = true;
  }, []);
  // Persist changes, but not the pre-restore default write (which would clobber
  // a saved value before the load effect above has a chance to apply it).
  useEffect(() => {
    if (!hideSunsetLoaded.current) return;
    try {
      localStorage.setItem(LS_HIDE_SUNSET, hideSunset ? "1" : "0");
    } catch {
      /* ignore write failures */
    }
  }, [hideSunset]);

  // The Tracking Sheet push rides along with "Sync to JobTread" — one button,
  // one step from the office's point of view — so it needs its own target
  // resolution and result state the way /stage drives TrackingSheetSync,
  // rather than the self-contained TrackingSheetSyncFor this page used before.
  const { can } = useAccess();
  const canTrack = can("tracking-sheet");
  const canApprove = can("bill-approve");
  const canLaborReview = can("labor-review");
  const [trackingTarget, setTrackingTarget] = useState<TrackingTarget | null>(null);
  const [trackingSync, setTrackingSync] = useState<TrackingSyncState | undefined>(undefined);
  // The sheet push runs on its own task runner, so `syncing` (the JobTread write
  // loop) is already false while it's still going. Without this the button would
  // re-enable mid-push and a second click would queue a duplicate sync.
  const trackingBusy =
    trackingSync?.status === "queued" || trackingSync?.status === "running";

  useEffect(() => {
    if (!canTrack || !jobId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tracking-sheet", { cache: "no-store" });
        if (!res.ok) return; // non-fatal — the tracking sync just doesn't fire
        const b = await res.json();
        if (!alive) return;
        const hit = (
          (b.jobs ?? []) as { id: string; label: string; jtJobId: string; url: string }[]
        ).find((j) => j.jtJobId === jobId);
        if (hit) setTrackingTarget({ projectId: hit.id, label: hit.label, url: hit.url });
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      alive = false;
    };
  }, [canTrack, jobId]);

  // A month change invalidates the result on screen — it describes another
  // billing period.
  useEffect(() => setTrackingSync(undefined), [ym]);
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

  const taxDirty = Object.entries(taxEdits).some(([docId, v]) => {
    if (v === "") return false;
    const bill = data?.bills.find((b) => b.id === docId);
    if (!bill) return false;
    return round2(Number(v) || 0) !== round2(bill.nonRecoverableTax);
  });
  const dirty = staged.size > 0 || Object.keys(edits).length > 0 || taxDirty;
  useUnsavedChanges(
    dirty,
    "You have staged coding changes that haven't been synced to JobTread. Leave and lose them?",
  );

  const load = useCallback(
    async (opts?: { preserveStaged?: boolean }) => {
      if (!jobId) return;
      setLoading(true);
      setError("");
      const [y, m] = ym.split("-");
      try {
        const r = await fetch(
          `/api/recode?jobId=${encodeURIComponent(jobId)}&year=${y}&month=${Number(m)}` +
            `&includeDrafts=${includeDrafts ? "1" : "0"}` +
            (uninvoicedOnly ? "" : "&includeInvoiced=1"),
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
    [jobId, ym, includeDrafts, uninvoicedOnly],
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
        if (!uninvoicedOnly) p.set("includeInvoiced", "1");
        if (includeDrafts) p.set("includeDrafts", "1");
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
  }, [mode, jobId, ym, uninvoicedOnly, includeDrafts, data]);

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
        divisionOf.set(c.number, d.name || d.division);
        map.set(c.number, {
          code: c.number,
          name: c.name,
          division: d.name || d.division,
          budget: c.budget,
          spent: c.bills,
          drafts: 0,
          labor: includeUnapprovedTime ? c.labor : c.laborApproved,
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
        division: divisionOf.get(code) ?? "",
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
    return map;
  }, [data, codeOf, leavesByCode, includeUnapprovedTime]);

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
      const e = g.get(dc) ?? { code: dc, name: h.division || "", rows: [] };
      if (!e.name && h.division) e.name = h.division;
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
   * The Sunset hide is a VIEW filter and nothing more. It is applied here —
   * below the `headroom` useMemo, which reads `data.lines` directly — so every
   * budget figure on the page (rail meters, per-bill chips, remaining, the
   * committed/draft split) still counts Sunset in full. Hiding it must never
   * change a number, only what's listed.
   */
  const sunsetDocIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of data?.bills ?? []) if (isSunsetVendor(b.vendor)) s.add(b.id);
    return s;
  }, [data]);

  const visibleBills = useMemo(
    () => (data?.bills ?? []).filter((b) => !hideSunset || !sunsetDocIds.has(b.id)),
    [data, hideSunset, sunsetDocIds],
  );

  // Exactly the draft bills on screen right now — same filters (hideSunset,
  // includeDrafts, uninvoicedOnly) as the list itself, so "Approve" never acts
  // on a bill the office can't currently see.
  const draftBills = useMemo(
    () => visibleBills.filter((b) => b.status === "draft"),
    [visibleBills],
  );
  // Mirrors approveBill() on the bill detail page: a Bill is a payable (draft →
  // pending, "approved for payment"); an Expense is already paid (draft →
  // approved, "record payment").
  const approvalTarget = (b: BillRef) => (b.name === "Expense" ? "approved" : "pending");

  const hiddenSunset = useMemo(() => {
    if (!hideSunset) return { count: 0, cost: 0, staged: 0 };
    const bills = (data?.bills ?? []).filter((b) => sunsetDocIds.has(b.id));
    const stagedHidden = (data?.lines ?? []).filter(
      (l) => sunsetDocIds.has(l.docId) && staged.has(l.id),
    ).length;
    return {
      count: bills.length,
      cost: bills.reduce((s, b) => s + b.cost, 0),
      staged: stagedHidden,
    };
  }, [data, hideSunset, sunsetDocIds, staged]);

  // Don't leave the drawer open on a bill the filter just hid.
  useEffect(() => {
    if (openDocId && hideSunset && sunsetDocIds.has(openDocId)) setOpenDocId(null);
  }, [openDocId, hideSunset, sunsetDocIds]);

  // Same "Include unapproved time" toggle the rail uses — the block's total
  // has to agree with what the rail is counting, or the two disagree about
  // "how much labor this month."
  const monthTime = useMemo(
    () => (data?.timeEntries ?? []).filter((t) => includeUnapprovedTime || t.isApproved),
    [data, includeUnapprovedTime],
  );
  const monthTimeTotal = useMemo(() => monthTime.reduce((s, t) => s + t.cost, 0), [monthTime]);

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
        // `total` is deliberately summed over ALL stacks, not the visible ones:
        // the lane header reports what's actually coded here, hidden or not.
        const total = all.reduce((s, x) => s + x.cost, 0);
        const stacks = hideSunset ? all.filter((s) => !sunsetDocIds.has(s.docId)) : all;
        return {
          code,
          h: headroom.get(code),
          stacks,
          hiddenCount: all.length - stacks.length,
          total,
        };
      })
      // A lane whose chips are ALL hidden still renders. Dropping it would take
      // the cost code off the board — losing both its headroom readout and its
      // drop target, and a code carrying only Sunset spend is often exactly the
      // one with room to move money into. It shows as an empty lane with a
      // "+N Sunset hidden" note instead.
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [data, codeOf, headroom, hideSunset, sunsetDocIds]);

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

  const revertAll = () => {
    setStaged(new Map());
    setEdits({});
    setTaxEdits({});
    setSyncMsg(null);
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
      fetch(`/api/recode/contributors?jobId=${encodeURIComponent(jobId)}`)
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
  // recode (see the `usedOf` note above), so this needs no staged reconciliation
  // — but it DOES need the same approved-only filter as the rail's total, or
  // this list wouldn't sum to the number that opened it.
  const drillTime = useMemo(
    () =>
      (contributors?.data.time ?? []).filter(
        (t) => t.code === codeDrill && (includeUnapprovedTime || t.isApproved),
      ),
    [contributors, codeDrill, includeUnapprovedTime],
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
    if (trackingTarget && (ok > 0 || taxOk > 0)) {
      const [y, m] = ym.split("-").map(Number);
      runTrackingSync(trackingTarget.projectId, m, y, setTrackingSync);
    }
    const parts = [];
    if (ok > 0) parts.push(`${ok} line${ok === 1 ? "" : "s"}`);
    if (taxOk > 0) parts.push(`${taxOk} tax edit${taxOk === 1 ? "" : "s"}`);
    const summary = parts.length ? parts.join(" + ") : "0 changes";
    if (failures.length === 0) {
      setSyncMsg({ tone: "success", text: `Synced ${summary} to JobTread.` });
      await load(); // load() clears staged
    } else {
      setSyncMsg({
        tone: "error",
        text: `Synced ${summary}, ${failures.length} failed: ${[...new Set(failures)].slice(0, 2).join("; ")}`,
      });
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
      try {
        const r = await fetch("/api/bill-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: b.id, status: approvalTarget(b) }),
        });
        const j = await r.json();
        if (!r.ok || j.error) failures.push(`${b.label}: ${j.error ?? "Approve failed"}`);
        else {
          if (j.previewed) previewed = true;
          ok++;
        }
      } catch (e) {
        failures.push(`${b.label}: ${e instanceof Error ? e.message : "Request failed"}`);
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
          <Link href="/recode" className="text-accent underline">
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 lg:max-w-[110rem]">
      {/* The job and its address used to be printed here — once as a phone-only
          line above the title and again as the header description from lg up.
          The GlobalJobBar carries both now (picker + address line), so this page
          says what it's FOR instead of repeating where you are. */}
      <PageHeader
        title={c("page.recode.title")}
        description={c("recode.header.description")}
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
            </div>
            {/* The filters, on a phone, as a swipeable row of pills. The 2×2 box
                of switches this replaces was honest but expensive: four 44px
                rows plus its border owned roughly a quarter of the screen above
                the list, permanently, to show four settings that are mostly left
                alone. As chips they take one row, the ON ones are legible at a
                glance from the accent fill, and the row scrolls rather than
                wrapping. From lg up this is hidden and the original switch row
                below takes over — a desktop toolbar has the width for labels,
                and a switch states on/off more precisely than a filled pill. */}
            <ChipScroller bleed="1rem" className="lg:hidden">
              <FilterChip
                on={uninvoicedOnly}
                onClick={() => setUninvoicedOnly(!uninvoicedOnly)}
                title={c("recode.help.uninvoicedOnly")}
              >
                Uninvoiced only
              </FilterChip>
              <FilterChip
                on={includeDrafts}
                onClick={() => setIncludeDrafts(!includeDrafts)}
                title={c("recode.help.includeDrafts")}
              >
                Drafts shown
              </FilterChip>
              <FilterChip on={hideSunset} onClick={() => setHideSunset(!hideSunset)}>
                Sunset hidden
              </FilterChip>
              <FilterChip
                on={includeUnapprovedTime}
                onClick={() => setIncludeUnapprovedTime(!includeUnapprovedTime)}
                title={c("recode.help.approvedTime")}
              >
                Unapproved time
              </FilterChip>
            </ChipScroller>
            {/* The same four settings as switches, from lg up. */}
            <div className="hidden lg:flex lg:w-auto lg:items-center lg:gap-3">
              {/* Governs the LIST only. Drafts are never invoiceable — JobTread
                  won't pull one onto a customer invoice — so this can't move the
                  "To be invoiced" figure, and the title says so. */}
              <Toggle
                checked={includeDrafts}
                onChange={setIncludeDrafts}
                label={<span title={c("recode.help.includeDrafts")}>{c("recode.toggle.includeDrafts")}</span>}
                className="min-h-11 shrink-0 text-left lg:min-h-0"
              />
              <Toggle
                checked={hideSunset}
                onChange={setHideSunset}
                label={c("recode.toggle.hideSunset")}
                className="min-h-11 shrink-0 text-left lg:min-h-0"
              />
              <Toggle
                checked={uninvoicedOnly}
                onChange={setUninvoicedOnly}
                label={
                  <span title={c("recode.help.uninvoicedOnly")}>
                    Uninvoiced only
                  </span>
                }
                className="min-h-11 shrink-0 text-left lg:min-h-0"
              />
              <Toggle
                checked={includeUnapprovedTime}
                onChange={setIncludeUnapprovedTime}
                label={
                  <span title={c("recode.help.approvedTime")}>
                    Include unapproved time
                  </span>
                }
                className="min-h-11 shrink-0 text-left lg:min-h-0"
              />
            </div>
            {dirty && (
              <span className="inline-flex shrink-0 items-center self-start rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {staged.size} staged change{staged.size === 1 ? "" : "s"}
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
              {/* One button, both destinations. With staged coding it writes to
                  JobTread and then pushes the month into the Tracking Sheet;
                  with nothing staged there is nothing to send to JobTread, so it
                  is the sheet push alone — and says so rather than sitting
                  greyed out with the sheet quietly out of date. */}
              <Button
                size="sm"
                onClick={sync}
                disabled={syncing || trackingBusy || (!dirty && !trackingTarget)}
                title={
                  !dirty && trackingTarget
                    ? `Push ${monthLabel(ym)} into ${trackingTarget.label}`
                    : undefined
                }
                className="hidden lg:inline-flex"
              >
                {syncing
                  ? "Syncing…"
                  : trackingBusy
                    ? "Syncing sheet…"
                    : dirty
                      ? "Sync to JobTread"
                      : "Sync Tracking Sheet"}
              </Button>
              {canApprove && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setApproveMsg(null);
                    setApproveOpen(true);
                  }}
                  disabled={draftBills.length === 0 || dirty || syncing || approving}
                  title={dirty ? "Sync staged coding changes to JobTread first" : undefined}
                  className="min-h-11 flex-1 lg:min-h-0 lg:flex-none"
                >
                  {/* The count rides inside each label rather than sitting
                      beside them — a bare text node would pick up the
                      button's flex gap and read as "Approve  (3)". */}
                  <span className="lg:hidden">
                    Approve{draftBills.length > 0 ? ` (${draftBills.length})` : ""}
                  </span>
                  <span className="hidden lg:inline">
                    Approve Draft Bills{draftBills.length > 0 ? ` (${draftBills.length})` : ""}
                  </span>
                </Button>
              )}
            </div>
          </div>
        }
      />
      {data && !data.writesEnabled && (
        <p className="mb-4 text-[11px] text-amber-600 dark:text-amber-400">
          Writes are disabled on this deployment — Sync will preview only.
        </p>
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
                whitespaceOnly={trackingSync.result.whitespaceOnly}
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

      {/* This job's ingested bills that never reached JobTread. They are absent
          from every number on this page — not in the budget rail, not in "to be
          invoiced", not in the coding queue — because none of it is in JobTread
          yet. Scoped to this job here (the all-jobs view lists the rest), and
          placed directly under the reconcile line, which is where the money that
          should be on the invoice is already being counted. */}
      {jobId && !loading && <UncapturedBills jobId={jobId} />}

      {data && !loading && (
        // All three columns share the row equally.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {/* ─────────── LEFT: cost-code reference rail ─────────── */}
          {/* Docked: the rail is the reference you're constantly checking while
              scrolling a long bill list, so it stays put. `self-start` is what
              makes sticky work in a grid — items stretch to the row height by
              default, leaving nothing to scroll within. */}
          <section className="min-w-0 lg:sticky lg:top-16 lg:self-start">
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
                          className="flex w-full items-center gap-1.5 border-b border-line bg-neutral-50/80 px-3 py-2.5 text-left transition hover:bg-accent/5 dark:border-neutral-800 dark:bg-white/[0.04] dark:hover:bg-white/[0.07] lg:items-baseline lg:px-2 lg:py-1"
                        >
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
              toggle &quot;Include unapproved time&quot; above to count only approved entries.
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

            <div className="mb-2 flex items-baseline justify-between gap-3">
              <SectionLabel>
                {/* The total stays whole even when the list is filtered — hiding
                    Sunset must not make the month look smaller than it is. */}
                {hiddenSunset.count > 0
                  ? `${visibleBills.length} of ${data.bills.length} bills`
                  : `${visibleBills.length} bill${visibleBills.length === 1 ? "" : "s"}`}{" "}
                · {money(data.billTotal)}
                {hiddenSunset.count > 0 && " (all bills)"}
              </SectionLabel>
              {/* Grouping switch, as a segmented control: one bordered track so
                  the two options read as a pair, with 44px-tall segments on
                  touch (they were 26px) and the desktop density restored at
                  lg. */}
              <div className="flex shrink-0 gap-1 rounded-lg border border-line p-0.5 text-xs lg:border-0 lg:p-0">
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
            </div>

            {mode !== "summary" && (
              <p className="mb-2 hidden text-[11px] text-neutral-400 lg:block">
                Drag a line — or a whole bill — onto a cost code (here or in the rail) to recode it.
                Nothing is written until you Sync.
              </p>
            )}

            {mode !== "summary" && hiddenSunset.count > 0 && (
              <Banner tone="info" className="mb-2">
                {hiddenSunset.count} Sunset bill{hiddenSunset.count === 1 ? "" : "s"} hidden ·{" "}
                {money(hiddenSunset.cost)}. Still counted in every budget figure on this page —
                only the list is filtered.
                {hiddenSunset.staged > 0 && (
                  <>
                    {" "}
                    <b>
                      {hiddenSunset.staged} staged change
                      {hiddenSunset.staged === 1 ? "" : "s"} on hidden bills will still sync.
                    </b>
                  </>
                )}
              </Banner>
            )}

            {/* ---- this month's time entries — read-only, not a drop target;
                a time entry is coded independently of any bill and this board
                only recodes bill lines, so it's shown for reference, not
                dragged. Recoding it is Labor Review's job, linked at the foot
                of the list. ---- */}
            {mode !== "summary" && monthTime.length > 0 && (
              <Card pad={false} className="mb-2 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setTimeBlockOpen((v) => !v)}
                  aria-expanded={timeBlockOpen}
                  className="flex w-full items-baseline justify-between gap-2 px-3 py-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5 lg:py-2"
                >
                  <span className="min-w-0 truncate text-sm font-semibold">
                    <span
                      aria-hidden
                      className={`mr-1.5 inline-block text-[9px] text-neutral-500 transition-transform dark:text-neutral-400 ${
                        timeBlockOpen ? "rotate-90" : ""
                      }`}
                    >
                      ▶
                    </span>
                    Time & labor ({monthTime.length}{" "}
                    {monthTime.length === 1 ? "entry" : "entries"})
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {money(monthTimeTotal)}
                  </span>
                </button>
                {timeBlockOpen && (
                  <>
                    <ul className="border-t border-line-soft">
                      {monthTime.map((t) => (
                        <li
                          key={t.id}
                          className="flex items-baseline gap-2 border-b border-line-soft px-3 py-1.5 text-xs last:border-0 dark:border-neutral-800"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-medium">{t.employee}</span>
                            <span className="ml-1 text-neutral-500 dark:text-neutral-400">
                              {t.startedAt ? t.startedAt.slice(0, 10) : ""} · {t.hours.toFixed(1)}h
                              {t.code ? ` · ${t.code} ${t.codeName}` : " · uncoded"}
                              {!t.isApproved ? " · unapproved" : ""}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums font-semibold">
                            {money(t.cost)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {/* This list is reference only. Labor Review is the same
                        month, same job, with the coding drawer that can move
                        these hours between cost codes. */}
                    {canLaborReview && (
                      <Link
                        href={`/labor-review?jobId=${encodeURIComponent(jobId)}&ym=${ym}`}
                        className="block border-t border-line-soft px-3 py-2.5 text-xs font-semibold text-accent transition hover:bg-accent/5 dark:border-neutral-800 dark:hover:bg-white/5"
                      >
                        Recode this labor in Labor Review →
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

            {/* ---- grouped by cost code: the drag surface ---- */}
            {mode === "code" &&
              (laneRows.length === 0 ? (
                <EmptyState>{c("recode.empty.noCodedLines")}</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {laneRows.map(({ code, h, stacks, total, hiddenCount }) => (
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
                          {hiddenCount > 0 && (
                            <li className="self-center px-1 text-[11px] italic text-neutral-500 dark:text-neutral-400">
                              +{hiddenCount} Sunset hidden
                            </li>
                          )}
                        </ul>
                      </Card>
                    </li>
                  ))}
                </ul>
              ))}

            {mode === "bill" && visibleBills.length === 0 ? (
              <EmptyState>
                {data.bills.length === 0
                  ? c("recode.empty.noBills")
                  : c("recode.empty.allSunset")}
              </EmptyState>
            ) : mode === "bill" ? (
              <ul className="space-y-2">
                {visibleBills.map((b) => {
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
                  return (
                    <li key={b.id} id={`bill-${b.id}`} className="scroll-mt-20">
                      <Card
                        pad={false}
                        draggable={lines.length > 0 && !b.invoiced}
                        onDragStart={beginDrag(lines.map((l) => l.id))}
                        onDragEnd={endDrag}
                        className={`flex items-stretch overflow-hidden ${
                          isOpen ? "ring-1 ring-accent" : ""
                        } ${
                          lines.length > 0 && !b.invoiced ? "cursor-grab active:cursor-grabbing" : ""
                        }`}
                      >
                        {/* Status as a 3px edge stripe, so a month can be
                            triaged by colour down the left margin before a word
                            is read: amber = still a draft, blue = already
                            invoiced (read-only), red = its coding is over
                            budget, none = nothing to look at. The chips below
                            still spell each state out; the stripe is what makes
                            the list scannable at scrolling speed. */}
                        <span
                          aria-hidden
                          className={`w-[3px] shrink-0 ${
                            b.invoiced
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
                            else setOpenDocId(isOpen ? null : b.id);
                          }}
                          aria-expanded={isMobile ? undefined : isOpen}
                          className="min-w-0 flex-1 p-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
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

                          <span className="mt-1.5 flex flex-wrap gap-1.5 empty:mt-0">
                            {b.status === "draft" && <Chip tone="neutral">draft</Chip>}
                            {b.fileCount === 0 && (
                              <Chip tone="warning" title="No file attached to this bill in JobTread">
                                No file
                              </Chip>
                            )}
                            {b.invoiced && (
                              <Chip tone="info" title="Already on a customer invoice — read-only">
                                invoiced
                              </Chip>
                            )}
                            {movedHere > 0 && <Chip tone="warning">{movedHere} moved</Chip>}
                            {/* Same pair the coding queue shows. */}
                            {b.reviewed ? (
                              <Chip tone="success" title="Marked reviewed in the Assistant">
                                ✓ Reviewed
                              </Chip>
                            ) : b.saved ? (
                              <Chip tone="success" title="Save has been clicked on this bill">
                                ✓ Saved
                              </Chip>
                            ) : null}
                          </span>

                          {/* Per-code chips: what this bill is charging, and what's left there. */}
                          <span className="mt-2 flex flex-wrap gap-1.5">
                            {[...codes.entries()]
                              .sort((x, y) => y[1] - x[1])
                              .map(([code, amt]) => {
                                const h = headroom.get(code);
                                const left = h ? remainingOf(h) : 0;
                                const over = left < 0;
                                return (
                                  <span
                                    key={code}
                                    className={`inline-flex items-baseline gap-1.5 rounded-md px-2 py-1 text-[11px] ${
                                      over
                                        ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                                        : "bg-neutral-100 text-neutral-600 dark:bg-white/10 dark:text-neutral-300"
                                    }`}
                                    title={`${h?.name ?? ""} — ${money(left)} remaining`}
                                  >
                                    <span className="tabular-nums">{code || "uncoded"}</span>
                                    <span className="tabular-nums">{money0(amt)}</span>
                                    <span className="opacity-60">·</span>
                                    <span className="tabular-nums">{money0(left)} left</span>
                                  </span>
                                );
                              })}
                          </span>
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
                          className="flex shrink-0 items-start border-l border-line-soft"
                        >
                          <JtLink
                            href={`https://app.jobtread.com/jobs/${jobId}/documents/${b.id}`}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-xs font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
                          >
                            JT ↗
                          </JtLink>
                        </span>
                      </Card>
                    </li>
                  );
                })}
              </ul>
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
          <section className="hidden min-w-0 xl:block xl:sticky xl:top-16 xl:self-start">
            <SectionLabel className="mb-2">Coding</SectionLabel>
            {!openBill ? (
              <EmptyState>{c("recode.empty.selectBill")}</EmptyState>
            ) : (
              // Height-capped to the room left below the sticky top-16 so a
              // long bill still scrolls (within the card) instead of running
              // off-screen — independent of the section's own sticky position.
              <Card className="max-h-[calc(100vh-5rem)] overflow-y-auto">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold">{openBill.label}</p>
                  <JtLink
                    href={`https://app.jobtread.com/jobs/${jobId}/documents/${openBill.id}`}
                    className="shrink-0 text-xs font-semibold text-neutral-400 transition hover:text-accent"
                  >
                    JT ↗
                  </JtLink>
                </div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs text-neutral-500">
                    {money(openMath.isDraft ? openMath.total : openBill.cost)} ·{" "}
                    {openLines.length} line{openLines.length === 1 ? "" : "s"}
                    {openBill.status ? ` · ${openBill.status}` : ""}
                  </p>
                  <Button
                    variant={openBill.reviewed ? "primary" : "secondary"}
                    size="sm"
                    className="shrink-0 !px-2 !py-1 !text-[11px]"
                    onClick={() => toggleReviewed(openBill.id, !openBill.reviewed)}
                  >
                    {openBill.reviewed ? "✓ Reviewed" : "Mark reviewed"}
                  </Button>
                </div>

                {/* Document-level sales tax = JobTread's "Tax" (nonRecoverableTax),
                    a fixed dollar. Staged like a line edit — nothing writes until
                    Sync — so typing here moves openMath.total live. */}
                {openMath.isDraft && data?.writesEnabled && !openBill.invoiced && (
                  <div className="mb-1 flex items-center justify-end gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                      {openBill.nonRecoverableTaxName || "Tax"}
                    </span>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                        $
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={openTaxEdit ?? String(openStoredTax)}
                        onChange={(e) =>
                          setTaxEdits((p) => ({ ...p, [openBill.id]: e.target.value }))
                        }
                        aria-label="Sales tax"
                        className="w-24 rounded border border-neutral-300 bg-white py-1 pl-4 pr-1.5 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                      />
                    </div>
                  </div>
                )}
                {openTaxView > 0 && (
                  <p className="mb-3 text-right text-[10px] text-neutral-400">
                    subtotal {money(openMath.subtotal)} + {money(openTaxView)}{" "}
                    {(openBill.nonRecoverableTaxName || "tax").toLowerCase()}
                  </p>
                )}

                {openBill.invoiced && (
                  <Banner tone="info" className="mb-3 !py-1.5 !text-[11px]">
                    Already on a customer invoice — coding is read-only here so recoding can&apos;t
                    change numbers already sent to the client.
                  </Banner>
                )}

                {!openBill.invoiced && data && data.budget.length > 0 && openLines.length > 1 && (
                  <div className="mb-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-ink-raised/60">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                      Apply one code to all {openLines.length} lines
                    </span>
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <CostCodeSelect options={codeOptions} value={bulkCode} onChange={setBulkCode} />
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0 !py-1.5 !text-xs"
                        onClick={() => applyCodeToAll(bulkCode)}
                        disabled={!bulkCode}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                )}

                <ul className="space-y-3">
                  {openLines.map((l, i) => {
                    const current = leafOf(l);
                    const moved = staged.has(l.id);
                    const code = codeOf(l);
                    const h = headroom.get(code);
                    const t = openMath.targets[i];
                    const extended = t ? round2(t.qty * t.preTaxUnit) : openMath.deTax(l.cost);
                    const setEdit = (patch: LineEdit) => {
                      setEdits((prev) => ({ ...prev, [l.id]: { ...prev[l.id], ...patch } }));
                      setSyncMsg(null);
                    };
                    return (
                      <li
                        key={l.id}
                        className="border-t border-line-soft pt-3 first:border-0 first:pt-0 dark:border-neutral-800"
                      >
                        {/* Description. JobTread locks it (with qty/amount) once a
                            bill leaves draft, so those inputs only appear on
                            drafts; re-coding still works in any status. */}
                        <div className="flex items-start gap-1.5">
                          {!openBill.invoiced && data?.writesEnabled && isCombinable(l) && (
                            <input
                              type="checkbox"
                              checked={combineSelected.includes(l.id)}
                              onChange={() => toggleCombineSel(l.id)}
                              aria-label="Select line to combine"
                              title="Combine with other lines that share this code"
                              className="mt-1.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            {openMath.isDraft ? (
                              <input
                                value={edits[l.id]?.name ?? l.name ?? ""}
                                onChange={(e) => setEdit({ name: e.target.value })}
                                placeholder="Description"
                                className="mb-1 w-full rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                              />
                            ) : (
                              <div className="mb-1 flex items-baseline justify-between gap-2">
                                <span className="min-w-0 truncate text-xs">
                                  {l.name || "(unnamed line)"}
                                </span>
                                <span className="shrink-0 text-xs font-semibold tabular-nums">
                                  {money(l.cost)}
                                </span>
                              </div>
                            )}
                          </div>
                          {/* Buyback: move this line onto a draft bill on Ascent -
                              Shop instead of billing it to the client (see
                              buybackLineById). Draft-only + writes-gated, like
                              Combine. Repeat clicks against other lines of THIS
                              bill land on the same Shop bill. */}
                          {openMath.isDraft && data?.writesEnabled && (
                            <button
                              type="button"
                              onClick={() =>
                                buybackLineById(l, edits[l.id]?.name ?? l.name ?? "Line item", extended)
                              }
                              disabled={buybackId === l.id}
                              aria-label="Buy back to Ascent - Shop"
                              title="Move this line to a draft bill on Ascent - Shop"
                              className="mt-0.5 shrink-0 rounded p-1 text-neutral-400 transition hover:bg-accent/10 hover:text-accent disabled:opacity-40 dark:hover:bg-accent/20 dark:hover:text-accent-soft"
                            >
                              {buybackId === l.id ? (
                                <span className="block h-3.5 w-3.5 text-center text-[10px] leading-[14px]">
                                  …
                                </span>
                              ) : (
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                >
                                  <path d="M4 12h13" />
                                  <path d="M12 6l7 6-7 6" />
                                </svg>
                              )}
                            </button>
                          )}
                          {/* Delete: removes this line from the bill entirely —
                              ported from the bill page. Draft-only + writes-gated,
                              like Buyback/Combine/Add line. */}
                          {openMath.isDraft && data?.writesEnabled && (
                            <button
                              type="button"
                              onClick={() =>
                                deleteLineById(l.id, edits[l.id]?.name ?? l.name ?? "Line item")
                              }
                              disabled={deletingLineId === l.id}
                              aria-label="Delete line"
                              title="Delete this line"
                              className="mt-0.5 shrink-0 rounded p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                            >
                              {deletingLineId === l.id ? (
                                <span className="block h-3.5 w-3.5 text-center text-[10px] leading-[14px]">
                                  …
                                </span>
                              ) : (
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5"
                                >
                                  <path
                                    fillRule="evenodd"
                                    clipRule="evenodd"
                                    d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 13.07a3 3 0 0 1-2.991 2.77H8.084a3 3 0 0 1-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 0 1 3.369 0c1.603.051 2.815 1.387 2.815 2.951Zm-6.136-1.452a51.196 51.196 0 0 1 3.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 0 0-6 0v-.113c0-.794.609-1.428 1.364-1.452Zm-.355 5.945a.75.75 0 1 0-1.5.058l.347 9a.75.75 0 1 0 1.499-.058l-.346-9Zm5.48.058a.75.75 0 1 0-1.498-.058l-.347 9a.75.75 0 0 0 1.5.058l.345-9Z"
                                  />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>
                        {openBill.invoiced ? (
                          <p className="rounded-md border border-line bg-neutral-50 px-2 py-1.5 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-ink-raised/60">
                            {code || "uncoded"}
                          </p>
                        ) : (
                          <CostCodeSelect
                            options={codeOptions}
                            value={current}
                            onChange={(leafId) => stageLine(l.id, leafId, l.jobCostItemId)}
                          />
                        )}
                        {openMath.isDraft && t && (
                          /* Qty × pre-tax unit cost. The office types what
                             JobTread SHOWS (de-taxed); the save grosses every
                             line back up together. */
                          <div className="mt-1 flex items-center gap-1.5">
                            <input
                              inputMode="decimal"
                              value={edits[l.id]?.quantity ?? String(l.quantity ?? 0)}
                              onChange={(e) => setEdit({ quantity: e.target.value })}
                              aria-label="Quantity"
                              className="w-14 rounded border border-neutral-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                            />
                            <span className="text-[11px] text-neutral-400">×</span>
                            <input
                              inputMode="decimal"
                              value={edits[l.id]?.unitCost ?? t.curPreTaxUnit.toFixed(2)}
                              onChange={(e) => setEdit({ unitCost: e.target.value })}
                              aria-label="Unit cost (pre-tax)"
                              className="w-24 rounded border border-neutral-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                            />
                            <span className="flex-1 text-right text-xs font-semibold tabular-nums">
                              {money(t.qty * t.preTaxUnit)}
                            </span>
                          </div>
                        )}
                        <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
                          <span className={moved ? "text-amber-600 dark:text-amber-400" : "text-neutral-400"}>
                            {moved ? `moved from ${l.code || "uncoded"}` : "unchanged"}
                          </span>
                          {h && (
                            <span
                              className={
                                remainingOf(h) < 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-neutral-400"
                              }
                            >
                              {money0(remainingOf(h))} left on {code}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {deleteLineMsg && (
                  <Banner tone="neutral" className="mt-2 !px-2 !py-1.5 !text-[11px]">
                    {deleteLineMsg}
                  </Banner>
                )}

                {/* Combine rows: appears once 2+ of this bill's lines share a
                    code. Sits below the list, alongside Add line, since both
                    are structural edits rather than per-line coding decisions.
                    Unlike a recode, this writes to JobTread immediately — it's
                    a structural merge, not a trial-and-error choice. */}
                {!openBill.invoiced && data?.writesEnabled && anyCombinable && (
                  <div className="mt-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-ink-raised/60">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                      Combine lines sharing a code
                    </span>
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 text-[11px] text-neutral-500">
                        {combineSelected.length < 2
                          ? "Check 2+ lines with the same code."
                          : combineCodeSet.size > 1
                            ? "Different codes selected."
                            : combineHasEdit
                              ? "Sync or discard edits first."
                              : `Merging ${combineSelected.length} lines.`}
                      </p>
                      <Button
                        size="sm"
                        className="shrink-0 !py-1.5 !text-xs"
                        onClick={combineRows}
                        disabled={!canCombine || combining}
                      >
                        {combining
                          ? "Combining…"
                          : `Combine${combineSelected.length >= 2 ? ` (${combineSelected.length})` : ""}`}
                      </Button>
                    </div>
                    {combineMsg && (
                      <Banner tone="neutral" className="mt-1.5 !px-2 !py-1.5 !text-[11px]">
                        {combineMsg}
                      </Banner>
                    )}
                  </div>
                )}

                {/* Add a new line (createCostItem) — ported from the bill page.
                    Draft-only + writes-gated, like Delete/Combine/Buyback. */}
                {openMath.isDraft && data?.writesEnabled && (
                  <div className="mt-3">
                    {!addingLine ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAddLineMsg("");
                          setAddingLine(true);
                        }}
                        className="w-full rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/5 dark:border-neutral-700 dark:text-accent-soft"
                      >
                        + Add line
                      </button>
                    ) : (
                      <div className="rounded-lg border border-line bg-white p-2 dark:bg-ink-raised">
                        <input
                          type="text"
                          value={newLine.name}
                          onChange={(e) => setNewLine((n) => ({ ...n, name: e.target.value }))}
                          placeholder={c("recode.placeholder.lineDescription")}
                          className="w-full rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                        />
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={newLine.quantity}
                            onChange={(e) => setNewLine((n) => ({ ...n, quantity: e.target.value }))}
                            aria-label="Quantity"
                            className="w-14 rounded border border-neutral-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                          />
                          <span className="text-[11px] text-neutral-400">×</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={newLine.unitCost}
                            onChange={(e) => setNewLine((n) => ({ ...n, unitCost: e.target.value }))}
                            aria-label="Unit cost (pre-tax)"
                            className="w-24 rounded border border-neutral-300 bg-white px-1.5 py-1 text-right text-xs tabular-nums transition focus:border-accent focus:outline-none dark:border-neutral-600 dark:bg-ink-raised"
                          />
                        </div>
                        <div className="mt-1.5">
                          <CostCodeSelect
                            options={codeOptions}
                            value={newLine.code}
                            onChange={(id) => setNewLine((n) => ({ ...n, code: id }))}
                          />
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Button
                            size="sm"
                            className="!py-1.5 !text-xs"
                            onClick={addLine}
                            disabled={addLineSaving || !newLine.name.trim()}
                          >
                            {addLineSaving ? "Adding…" : "Add line"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="!py-1.5 !text-xs"
                            onClick={() => {
                              setAddingLine(false);
                              setAddLineMsg("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    {addLineMsg && (
                      <Banner tone="neutral" className="mt-1.5 !px-2 !py-1.5 !text-[11px]">
                        {addLineMsg}
                      </Banner>
                    )}
                  </div>
                )}

                {/* The scanned invoice, in the panel where the coding decision is
                    made — otherwise you're recoding a line from its description
                    alone, or bouncing to the bill page to see what it was for. */}
                <div className="mt-4 border-t border-line-soft pt-3 dark:border-neutral-800">
                  <SectionLabel className="mb-1.5">Invoice</SectionLabel>
                  {filesLoading && <p className="text-xs text-neutral-400">Loading…</p>}
                  {!filesLoading && files.length === 0 && (
                    <p className="text-xs text-neutral-400">No file attached to this bill.</p>
                  )}
                  <div className="space-y-2">
                    {files.map((f) =>
                      f.url && isImageFile(f) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a key={f.id} href={f.url} target="_blank" rel="noreferrer" title="Open full size">
                          <img
                            src={f.url}
                            alt={f.name ?? "invoice"}
                            className="max-h-[32rem] w-full rounded-lg border border-line object-contain dark:border-neutral-800"
                          />
                        </a>
                      ) : f.url ? (
                        <div key={f.id}>
                          <iframe
                            src={f.url}
                            title={f.name ?? "invoice"}
                            className="h-[32rem] w-full rounded-lg border border-line dark:border-neutral-800"
                          />
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-xs font-semibold text-accent"
                          >
                            Open {f.name || "attachment"} ↗
                          </a>
                        </div>
                      ) : (
                        <span key={f.id} className="text-xs text-neutral-500">
                          {f.name}
                        </span>
                      ),
                    )}
                  </div>
                </div>

                {/* Filing — the bill page's Filing card, in the panel where the
                    invoice is already on screen: both answers are read off the
                    document, so they sit AFTER it, same as on /bill. Writes-
                    gated like the rest of the card, and hidden on an invoiced
                    bill, whose month and job are fixed by what the client was
                    already sent. */}
                {data?.writesEnabled && !openBill.invoiced && (
                  <div className="mt-4 border-t border-line-soft pt-3 dark:border-neutral-800">
                    <SectionLabel className="mb-1.5">Filing</SectionLabel>
                    {/* Vendor Bill Number (JobTread externalId) — the invoice/bill
                        number, editable here; commits on blur. JobTread's own
                        document number shows as the placeholder when it's unset. */}
                    <Label htmlFor="filing-bill-number">Bill number</Label>
                    <input
                      id="filing-bill-number"
                      type="text"
                      value={billNumberDraft}
                      maxLength={32}
                      disabled={billNumberSaving || monthSaving || reassigning}
                      onChange={(e) => setBillNumberDraft(e.target.value)}
                      onBlur={saveBillNumber}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      placeholder={openBill.number ? `#${openBill.number}` : "Invoice / bill number"}
                      className="mb-3 h-9 w-full rounded-lg border border-neutral-300 bg-white px-2.5 font-mono text-xs transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-50 dark:border-neutral-600 dark:bg-ink"
                    />
                    <Label htmlFor="filing-billing-month">Billing month</Label>
                    <Select
                      id="filing-billing-month"
                      className="!py-1.5 !text-xs"
                      disabled={monthSaving || reassigning}
                      value={(openBill.issueDate ?? "").slice(0, 7)}
                      onChange={(e) => setBillingMonth(e.target.value)}
                    >
                      <option value="">— set billing month —</option>
                      {monthOptions().map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>

                    {/* Draft-only, like the bill page: JobTread locks a
                        committed bill, and the move is a delete+recreate. */}
                    {openMath.isDraft && (
                      <div className="mt-3">
                        <Label>Move to job</Label>
                        {/* The picker is an action here, not a selection — what
                            it displays stays this board's job — so the move runs
                            off onSelect, which also hands back the label the
                            confirm and the banner name. */}
                        <JobPicker
                          value={jobId}
                          includeAll={false}
                          placeholder={c("recode.placeholder.chooseJob")}
                          onChange={() => {}}
                          onSelect={(j) => {
                            if (j) reassignJob(j);
                          }}
                        />
                      </div>
                    )}

                    {(monthSaving || reassigning) && (
                      <p className="mt-1.5 text-[11px] text-neutral-400">
                        {reassigning ? "Moving…" : "Saving…"}
                      </p>
                    )}
                    {filingMsg && (
                      <Banner tone="neutral" className="mt-1.5 !px-2 !py-1.5 !text-[11px]">
                        {filingMsg}
                      </Banner>
                    )}
                  </div>
                )}
              </Card>
            )}
          </section>
        </div>
      )}

      {/* The phone's commit bar. It appears only once there IS something staged
          — a bar that is always docked spends the screen's most valuable strip
          on a disabled button — and it pins above the tab bar, so Sync is under
          the thumb wherever you've scrolled to. `order-last` keeps it at the
          bottom of the flex column even though the reconcile block above also
          claims that order on a phone; both are last in DOM order here, so they
          stack in source order. From lg up the toolbar's own buttons take over
          and this is hidden. */}
      {dirty && (
        <StickyActionBar className="order-last mt-4 lg:hidden">
          <span className="flex-1 text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">
            {staged.size} staged change{staged.size === 1 ? "" : "s"}
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
            {syncing ? "Syncing…" : "Sync to JT"}
          </Button>
        </StickyActionBar>
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
                                className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs dark:border-neutral-800"
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-medium">{t.employee}</span>
                                  <span className="ml-1 text-neutral-500 dark:text-neutral-400">
                                    {t.startedAt ? t.startedAt.slice(0, 10) : ""} ·{" "}
                                    {t.hours.toFixed(1)}h
                                    {!t.isApproved ? " · unapproved" : ""}
                                  </span>
                                </span>
                                <span className="shrink-0 tabular-nums font-semibold">
                                  {money(t.cost)}
                                </span>
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
