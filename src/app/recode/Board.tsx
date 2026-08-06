"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  SectionLabel,
  Select,
  Toggle,
  btn,
} from "@/components/ui";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JtLink } from "@/components/JtLink";
import {
  billLineMath,
  descriptionForCode,
  round2,
  type LineChange,
  type LineEdit,
} from "@/lib/billLineMath";
import { InvoiceReconcile, type Recon } from "@/components/InvoiceReconcile";
import { TrackingSheetSyncFor } from "@/components/TrackingSheetSync";
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
  vendor: string;
  cost: number;
  status: string;
  issueDate: string | null;
  createdAt: string | null;
  nonRecoverableTax: number;
  saved: boolean;
  reviewed: boolean;
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
  budget: BudgetItem[];
  costDetail: { divisions: CostDivisionRow[]; budgetBasis: string };
  writesEnabled: boolean;
  error?: string;
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

/** Budget-usage meter. Amber past 90%, red past 100% — the whole point of the rail. */
function Meter({
  budget,
  used,
  label,
  className = "mt-0.5 h-1",
}: {
  budget: number;
  used: number;
  label: string;
  className?: string;
}) {
  const pct = budget > 0 ? used / budget : used > 0 ? 1 : 0;
  const over = budget > 0 && used > budget;
  const near = !over && pct >= 0.9;
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800 ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label} budget used`}
    >
      <div
        className={`h-full rounded-full transition-all ${
          over ? "bg-red-500" : near ? "bg-amber-500" : "bg-accent"
        }`}
        style={{ width: `${Math.min(pct, 1) * 100}%` }}
      />
    </div>
  );
}

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
  const params = useSearchParams();
  const router = useRouter();
  const isMobile = useIsMobile();
  const jobId = params.get("jobId") ?? "";

  const [ym, setYm] = useState(() => params.get("ym") || defaultYm());
  const [includeDrafts, setIncludeDrafts] = useState(true);
  // Display-only filter. Defaults OFF: hiding bills by default would mean the
  // list silently disagrees with the totals until someone noticed the toggle.
  const [hideSunset, setHideSunset] = useState(false);
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** costItemId → the budget leaf it's been staged onto. */
  const [staged, setStaged] = useState<Map<string, string>>(new Map());
  /** costItemId → in-flight description / qty / unit-cost text, draft bills only. */
  const [edits, setEdits] = useState<Record<string, LineEdit | undefined>>({});
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [mode, setMode] = useState<"bill" | "code">("bill");
  // Lifted out of the reconcile rectangle so the header can show the same
  // authoritative "to be invoiced" figure without fetching it twice.
  const [recon, setRecon] = useState<Recon | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [codeQuery, setCodeQuery] = useState("");
  // Divisions the user has rolled up. Empty = all open, so the rail keeps
  // showing every code until it's deliberately tidied.
  const [collapsedDivs, setCollapsedDivs] = useState<Set<string>>(new Set());
  // Mobile-only: roll the whole cost-code rail away. On a phone it stacks on
  // top of the bills, so it starts collapsed to land you on the list — tap the
  // header to open it. The desktop sidebar ignores this (it's always docked,
  // via the `lg:` overrides), so defaulting to collapsed is a mobile-only cost.
  const [railCollapsed, setRailCollapsed] = useState(true);

  const dirty = staged.size > 0 || Object.keys(edits).length > 0;
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
            `&includeDrafts=${includeDrafts ? "1" : "0"}`,
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
          } else {
            // A fresh pull (month/filter change, or after Sync) invalidates
            // everything staged against the old data.
            setStaged(new Map());
            setEdits({});
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [jobId, ym, includeDrafts],
  );

  useEffect(() => {
    load();
  }, [load]);

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
  }, [data, codeOf, leavesByCode]);

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

  const openBill = data?.bills.find((b) => b.id === openDocId) ?? null;
  const openLines = openDocId ? (linesByDoc.get(openDocId) ?? []) : [];

  /** De-taxed display values + the whole-bill payload for the open bill. */
  const openMath = useMemo(
    () =>
      billLineMath({
        lines: openLines,
        storedTax: openBill?.nonRecoverableTax ?? 0,
        status: openBill?.status,
        edits,
        picked: Object.fromEntries(staged),
        budget: data?.budget ?? [],
      }),
    [openLines, openBill, edits, staged, data],
  );

  // ---- coding-drawer bulk actions: Apply to all + Combine ------------------
  // Ported from the bill page (/bill/[docId]) — same rules, adapted to this
  // page's staged-not-saved model.
  const [bulkCode, setBulkCode] = useState("");
  const [combineSelected, setCombineSelected] = useState<string[]>([]);
  const [combining, setCombining] = useState(false);
  const [combineMsg, setCombineMsg] = useState("");
  const [buybackId, setBuybackId] = useState("");

  // Both reset when the open bill changes — they're about the CURRENT bill's
  // lines, and stale selections from a previous bill would silently apply to
  // the wrong one.
  useEffect(() => {
    setBulkCode("");
    setCombineSelected([]);
    setCombineMsg("");
  }, [openDocId]);

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

  /** Options for the coding dropdown — every budget leaf on the job. */
  const codeOptions: Option[] = useMemo(
    () =>
      (data?.budget ?? []).map((b) => ({
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
    if (!data || !dirty) return;
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

    const byDoc = new Map<string, LineChange[]>();
    for (const docId of touched) {
      const bill = data.bills.find((b) => b.id === docId);
      if (!bill) continue;
      const { wholeBillChanges } = billLineMath({
        lines: linesByDoc.get(docId) ?? [],
        storedTax: bill.nonRecoverableTax,
        status: bill.status,
        edits,
        picked: Object.fromEntries(staged),
        budget: data.budget,
      });
      byDoc.set(docId, wholeBillChanges);
    }

    let ok = 0;
    const failures: string[] = [];
    for (const [docId, changes] of byDoc) {
      try {
        const r = await fetch("/api/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, changes }),
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

    setSyncing(false);
    if (failures.length === 0) {
      setSyncMsg({ tone: "success", text: `Synced ${ok} line${ok === 1 ? "" : "s"} to JobTread.` });
      await load(); // load() clears staged
    } else {
      setSyncMsg({
        tone: "error",
        text: `${ok} line(s) synced, ${failures.length} failed: ${[...new Set(failures)].slice(0, 2).join("; ")}`,
      });
      await load();
    }
  };

  if (!jobId) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <PageHeader title="Client Invoicing" />
        <EmptyState>
          No job selected. Open this from a job card on{" "}
          <Link href="/stage" className="text-accent underline">
            Invoicing
          </Link>
          .
        </EmptyState>
      </main>
    );
  }

  const jobTitle = data?.job?.name ?? "";
  const jobAddress = (data?.job?.address ?? "").replace(/,\s*USA$/i, "").trim();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 lg:max-w-[110rem]">
      <PageHeader
        title="Client Invoicing"
        description={
          jobTitle
            ? `${jobTitle}${jobAddress ? ` · ${jobAddress}` : ""}`
            : "Move expenditure between cost codes against live budget headroom."
        }
        actions={
          <Link href="/stage" className={btn("secondary", "sm")}>
            ← Invoicing
          </Link>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
          <Select
            value={ym}
            onChange={(e) => setYm(e.target.value)}
            className="lg:w-52"
            aria-label="Billing month"
          >
            {monthOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {/* Governs the LIST only. Drafts are never invoiceable — JobTread
              won't pull one onto a customer invoice — so this can't move the
              "To be invoiced" figure, and the title says so. */}
          <Toggle
            checked={includeDrafts}
            onChange={setIncludeDrafts}
            label={<span title="Shows draft bills below so you can code them. Drafts are never invoiceable until approved in JobTread, so this doesn't change the To be invoiced total.">Include drafts</span>}
            className="shrink-0"
          />
          <Toggle
            checked={hideSunset}
            onChange={setHideSunset}
            label="Hide Sunset"
            className="shrink-0"
          />
          <div className="flex-1" />
          {dirty && (
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              {staged.size} staged change{staged.size === 1 ? "" : "s"}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={revertAll} disabled={!dirty || syncing}>
            Revert
          </Button>
          <Button size="sm" onClick={sync} disabled={!dirty || syncing}>
            {syncing ? "Syncing…" : "Sync to JobTread"}
          </Button>
          {/* The two syncs sit together because they're the same step of the
              job, in order: push the coding to JobTread, then push the month to
              the tracking sheet (which reads costCode off each bill line, so it
              wants the coding settled first). Compact so its result wraps onto
              its own line instead of stretching this row. */}
          <TrackingSheetSyncFor
            jtJobId={jobId}
            ym={ym}
            monthLabel={monthOptions().find((o) => o.value === ym)?.label ?? ym}
            compact
          />
        </div>
        {data && !data.writesEnabled && (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            Writes are disabled on this deployment — Sync will preview only.
          </p>
        )}
      </Card>

      {syncMsg && (
        <Banner tone={syncMsg.tone} className="mb-4">
          {syncMsg.text}
        </Banner>
      )}
      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      <p className="mb-4 text-[11px] text-neutral-400 lg:hidden">
        Recoding needs a wider window — this is a read-only view on a narrow screen.
      </p>

      {loading && <Loading label="Loading bills and budget…" />}

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
      {jobId && !loading && (
        <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
          <Card
            className="lg:w-72"
            title={
              recon
                ? `${money(recon.uninvoicedBillsCost)} uninvoiced bills + ${money(recon.uninvoicedTimeCost)} uninvoiced time` +
                  (recon.draftBillCount > 0
                    ? `\n+ ${money(recon.draftBillsCost)} in ${recon.draftBillCount} draft bill(s)`
                    : "")
                : undefined
            }
          >
            <SectionLabel>To be invoiced</SectionLabel>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums">
              {recon ? money(recon.remaining + recon.draftBillsCost) : "—"}
            </p>
            {!recon ? (
              <p className="mt-0.5 text-[11px] text-neutral-400">checking JobTread…</p>
            ) : recon.draftBillCount === 0 ? (
              <p className="mt-0.5 text-[11px] text-neutral-400">
                All approved in JobTread — invoiceable now.
              </p>
            ) : recon.remaining < 0.01 ? (
              <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                None of it is invoiceable yet — all {recon.draftBillCount} bill
                {recon.draftBillCount === 1 ? "" : "s"} are still draft in JobTread. Approve them
                to bill.
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                {money(recon.remaining)} approved and invoiceable now ·{" "}
                {money(recon.draftBillsCost)} in {recon.draftBillCount} draft
                {recon.draftBillCount === 1 ? "" : "s"} awaiting approval in JobTread.
              </p>
            )}
          </Card>
          <InvoiceReconcile jobId={jobId} ym={ym} onData={setRecon} />
        </div>
      )}

      {data && !loading && (
        // The rail is dense enough now to give width back to the invoice pane —
        // every bill's attachment is a PDF, and a PDF in a narrow iframe is
        // unreadable.
        // Rail and coding panel are fixed; the bills list takes 1fr so it grows
        // into whatever the window has left, rather than being pinned narrow.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_36rem]">
          {/* ─────────── LEFT: cost-code reference rail ─────────── */}
          {/* Docked: the rail is the reference you're constantly checking while
              scrolling a long bill list, so it stays put. `self-start` is what
              makes sticky work in a grid — items stretch to the row height by
              default, leaving nothing to scroll within. */}
          <section className="min-w-0 lg:sticky lg:top-4 lg:self-start">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              {/* On mobile the label itself is the toggle for the whole rail;
                  on desktop the rail is always docked, so the tap is disabled
                  and the chevron hidden. */}
              <button
                type="button"
                onClick={() => setRailCollapsed((v) => !v)}
                aria-expanded={!railCollapsed}
                className="flex min-w-0 items-baseline gap-1.5 text-left lg:pointer-events-none"
              >
                <span
                  aria-hidden
                  className={`shrink-0 text-[9px] text-neutral-400 transition-transform lg:hidden ${
                    railCollapsed ? "" : "rotate-90"
                  }`}
                >
                  ▶
                </span>
                <SectionLabel>Cost codes · budget remaining</SectionLabel>
              </button>
              <button
                type="button"
                onClick={() =>
                  setCollapsedDivs((prev) =>
                    prev.size > 0 ? new Set() : new Set(railGroups.map((g) => g.code)),
                  )
                }
                className={`shrink-0 text-[11px] text-neutral-500 transition hover:text-accent ${
                  railCollapsed ? "hidden lg:block" : ""
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
                placeholder="Filter cost codes…"
                className="w-full border-b border-neutral-200 bg-transparent px-2 py-1.5 text-xs outline-none dark:border-white/10"
              />
              {/* Sized off the viewport, not a %, so the docked rail (label +
                  card + footnote) always fits on screen and scrolls internally. */}
              <div className="max-h-[calc(100vh-13rem)] overflow-y-auto">
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
                          className="flex w-full items-baseline gap-1.5 border-b border-neutral-200 bg-neutral-50/80 px-2 py-1 text-left transition hover:bg-accent/5 dark:border-neutral-800 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
                        >
                          <span
                            aria-hidden
                            className={`shrink-0 text-[9px] text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}
                          >
                            ▶
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                            <span className="tabular-nums text-neutral-500">{g.code}</span> {g.name}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
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
                          <div className="border-b border-neutral-100 px-2 pb-1 dark:border-neutral-800">
                            <Meter budget={g.budget} used={g.used} label={`Division ${g.code}`} />
                          </div>
                        )}

                        {open && (
                          <ul>
                            {g.rows.map((h) => {
                              const left = remainingOf(h);
                              const over = left < 0;
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
                                    (h.droppable ? "" : "\nNo budget line — can't code to this")
                                  }
                                  className={`border-b border-neutral-100 px-2 py-1 pl-4 transition dark:border-neutral-800 ${
                                    dragOverCode === h.code
                                      ? "bg-accent/10 ring-1 ring-inset ring-accent"
                                      : dragLineIds && !h.droppable
                                        ? "opacity-40"
                                        : ""
                                  }`}
                                >
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="min-w-0 truncate text-xs">
                                      <span className="tabular-nums text-neutral-500">
                                        {h.code}
                                      </span>{" "}
                                      <span className={h.droppable ? "" : "text-neutral-400"}>
                                        {h.name}
                                      </span>
                                    </span>
                                    <span
                                      className={`shrink-0 text-xs font-semibold tabular-nums ${
                                        over ? "text-red-600 dark:text-red-400" : ""
                                      }`}
                                    >
                                      {money0(left)}
                                    </span>
                                  </div>
                                  <Meter budget={h.budget} used={usedOf(h)} label={h.code} />
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
              className={`mt-2 text-[11px] leading-relaxed text-neutral-400 ${
                railCollapsed ? "hidden lg:block" : ""
              }`}
            >
              Remaining = budget − committed − this month&apos;s drafts − labor. Committed is
              approved and pending bills across all time; drafts aren&apos;t committed spend yet;
              labor is logged time entries, which a customer invoice bills alongside the bills.
              Hover a code for the breakdown. Bars and remaining update as you recode.
            </p>
          </section>

          {/* ─────────── CENTRE: the month's bills ─────────── */}
          <section className="min-w-0">
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
              <div className="flex gap-1 text-xs">
                {(["bill", "code"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded-md px-2 py-1 transition ${
                      mode === m
                        ? "bg-accent text-accent-fg font-semibold"
                        : "text-neutral-500 hover:text-accent"
                    }`}
                  >
                    {m === "bill" ? "By bill" : "By cost code"}
                  </button>
                ))}
              </div>
            </div>

            <p className="mb-2 hidden text-[11px] text-neutral-400 lg:block">
              Drag a line — or a whole bill — onto a cost code (here or in the rail) to recode it.
              Nothing is written until you Sync.
            </p>

            {hiddenSunset.count > 0 && (
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

            {/* ---- grouped by cost code: the drag surface ---- */}
            {mode === "code" &&
              (laneRows.length === 0 ? (
                <EmptyState>No coded lines in this month.</EmptyState>
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
                        <div className="flex items-baseline justify-between gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
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
                                  draggable
                                  onDragStart={beginDrag(s.lines.map((l) => l.id))}
                                  onDragEnd={endDrag}
                                  onClick={() => setOpenDocId(s.docId)}
                                  title={s.lines.map((l) => l.name).join("\n")}
                                  className={`cursor-grab rounded-md border px-2 py-1 text-[11px] transition active:cursor-grabbing ${
                                    moved
                                      ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
                                      : "border-neutral-200 bg-white hover:border-accent dark:border-neutral-700 dark:bg-ink-overlay"
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
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                          {hiddenCount > 0 && (
                            <li className="self-center px-1 text-[11px] italic text-neutral-400">
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
                  ? "No uninvoiced bills dated in this month."
                  : "Every bill this month is from Sunset — turn off Hide Sunset to see them."}
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
                    <li key={b.id} id={`bill-${b.id}`} className="scroll-mt-4">
                      <Card
                        pad={false}
                        draggable={lines.length > 0}
                        onDragStart={beginDrag(lines.map((l) => l.id))}
                        onDragEnd={endDrag}
                        className={`flex items-stretch ${isOpen ? "ring-1 ring-accent" : ""} ${
                          lines.length > 0 ? "cursor-grab active:cursor-grabbing" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => (isMobile ? openBillDetail() : setOpenDocId(isOpen ? null : b.id))}
                          aria-expanded={isMobile ? undefined : isOpen}
                          className="min-w-0 flex-1 p-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
                        >
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate text-sm font-semibold">
                              {b.label}
                              {b.status === "draft" && (
                                <span className="ml-2 rounded bg-neutral-200 px-1.5 py-px text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                                  draft
                                </span>
                              )}
                              {movedHere > 0 && (
                                <span className="ml-2 rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                                  {movedHere} moved
                                </span>
                              )}
                              {/* Same pair the coding queue shows. */}
                              {b.reviewed ? (
                                <span
                                  title="Marked reviewed in the Assistant"
                                  className="ml-2 rounded bg-emerald-600 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white"
                                >
                                  ✓ Reviewed
                                </span>
                              ) : b.saved ? (
                                <span
                                  title="Save has been clicked on this bill"
                                  className="ml-2 rounded bg-emerald-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                >
                                  ✓ Saved
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums">
                              {money(b.cost)}
                            </span>
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
                                    className={`inline-flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] ${
                                      over
                                        ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                                        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
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
                          className="flex shrink-0 items-start border-l border-neutral-100 dark:border-neutral-800"
                        >
                          <JtLink
                            href={`https://app.jobtread.com/jobs/${jobId}/documents/${b.id}`}
                            className="p-3 text-xs font-semibold text-neutral-400 transition hover:text-accent"
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
          <section className="hidden min-w-0 xl:block">
            <SectionLabel className="mb-2">Coding</SectionLabel>
            {!openBill ? (
              <EmptyState>Select a bill to edit its coding.</EmptyState>
            ) : (
              // Scrolls internally: with the invoice embedded the panel is taller
              // than the viewport, and a sticky element that overflows can't be
              // scrolled to its bottom.
              <Card className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold">{openBill.label}</p>
                  <JtLink
                    href={`https://app.jobtread.com/jobs/${jobId}/documents/${openBill.id}`}
                    className="shrink-0 text-xs font-semibold text-neutral-400 transition hover:text-accent"
                  >
                    JT ↗
                  </JtLink>
                </div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs text-neutral-500">
                    {money(openMath.isDraft ? openMath.total : openBill.cost)} ·{" "}
                    {openLines.length} line{openLines.length === 1 ? "" : "s"}
                    {openBill.status ? ` · ${openBill.status}` : ""}
                    {openBill.nonRecoverableTax > 0
                      ? ` · incl. ${money(openBill.nonRecoverableTax)} tax`
                      : ""}
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

                {data && data.budget.length > 0 && openLines.length > 1 && (
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

                {/* Combine rows: appears once 2+ of this bill's lines share a
                    code. Unlike a recode, this writes to JobTread immediately —
                    it's a structural merge, not a trial-and-error choice. */}
                {data?.writesEnabled && anyCombinable && (
                  <div className="mb-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-ink-raised/60">
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
                        className="border-t border-neutral-100 pt-3 first:border-0 first:pt-0 dark:border-neutral-800"
                      >
                        {/* Description. JobTread locks it (with qty/amount) once a
                            bill leaves draft, so those inputs only appear on
                            drafts; re-coding still works in any status. */}
                        <div className="flex items-start gap-1.5">
                          {data?.writesEnabled && isCombinable(l) && (
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
                        </div>
                        <CostCodeSelect
                          options={codeOptions}
                          value={current}
                          onChange={(leafId) => stageLine(l.id, leafId, l.jobCostItemId)}
                        />
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

                {/* The scanned invoice, in the panel where the coding decision is
                    made — otherwise you're recoding a line from its description
                    alone, or bouncing to the bill page to see what it was for. */}
                <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
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
                            className="max-h-[32rem] w-full rounded-lg border border-neutral-200 object-contain dark:border-neutral-800"
                          />
                        </a>
                      ) : f.url ? (
                        <div key={f.id}>
                          <iframe
                            src={f.url}
                            title={f.name ?? "invoice"}
                            className="h-[32rem] w-full rounded-lg border border-neutral-200 dark:border-neutral-800"
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
              </Card>
            )}
          </section>
        </div>
      )}

      {/* A dropped-on code with several MEANINGFUL budget rows (Labor vs
          Materials vs Allowance) is a real coding decision — ask, don't guess. */}
      {leafPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLeafPicker(null)}
        >
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">
              Which budget line under {leafPicker.code}?
            </p>
            <p className="mb-3 text-xs text-neutral-500">
              This cost code has several budget rows. Moving{" "}
              {leafPicker.lineIds.length === 1
                ? "1 line"
                : `${leafPicker.lineIds.length} lines`}
              .
            </p>
            <ul className="space-y-1.5">
              {(leavesByCode.get(leafPicker.code) ?? []).map((leaf) => (
                <li key={leaf.id}>
                  <button
                    type="button"
                    onClick={() => {
                      moveLinesToLeaf(leafPicker.lineIds, leaf.id);
                      setLeafPicker(null);
                    }}
                    className="flex w-full items-baseline justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm transition hover:border-accent dark:border-neutral-700"
                  >
                    <span className="min-w-0 truncate">
                      {leaf.detail || leaf.name}
                      {leaf.costType && (
                        <span className="ml-1.5 text-xs text-neutral-400">{leaf.costType}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                      {money0(leaf.cost ?? 0)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setLeafPicker(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}
