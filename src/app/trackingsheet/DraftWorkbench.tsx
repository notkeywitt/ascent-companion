"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jobLabel, type JobRef } from "@/components/JobPicker";
import { type Option } from "@/components/CostCodeSelect";
import { useCopy } from "@/components/CopyProvider";
import {
  BillCodingCard,
  money,
  money0,
  type BillFile,
  type CodingCardCtl,
  type CodingLine,
} from "./BillCodingCard";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Label,
  Loading,
  Meter,
  SectionLabel,
} from "@/components/ui";
import {
  billLineMath,
  descriptionForCode,
  recodeLog,
  round2,
  type BillMath,
  type LineEdit,
} from "@/lib/billLineMath";
import { markBillTouched } from "@/lib/billTouch";
import {
  billDraftKey,
  discardDraft,
  draftSavedAtLabel,
  loadDraft,
  reconcileDraft,
  saveDraft,
} from "@/lib/codingDraft";
import { SALES_TAX_LINE_NAME, splitSalesTax } from "@/lib/salesTax";

/**
 * The two side columns of the needs-coding workbench — the budget rail and the
 * coding panel — plus the state that feeds both.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE WORKBENCH IN Board.tsx
 * The job workbench (`?jobId=`) is scoped to ONE job and ONE month, so it can
 * load a single budget and hold every bill's lines in one payload. The
 * needs-coding queue is scoped by STATUS across EVERY job, so the budget on
 * screen has to follow whichever bill is selected — a different job on almost
 * every row. That inverts the data flow, which is why these columns read
 * `/api/bill?docId&jobId` (one bill, its job's budget, its job's cost-to-
 * complete) rather than `/api/trackingsheet`.
 *
 * What they DON'T do is diverge on the money: the de-tax / edit-pre-tax /
 * gross-up model comes from `src/lib/billLineMath.ts` and the save goes to the
 * same `/api/code` + `/api/bill-tax` pair the bill page uses, so a save made
 * here and a save made there write the same thing.
 *
 * Everything structural — adding or deleting a line, combining lines, buyback,
 * approving, re-filing to another job or month, the invoice scan at full size —
 * stays on the full bill page, one click away from the panel's header.
 */

// ---------------------------------------------------------------------------
// TYPES — the shape of /api/bill
// ---------------------------------------------------------------------------

export interface WorkbenchLine {
  id: string;
  name?: string;
  cost?: number;
  quantity?: number;
  unitCost?: number;
  costCode?: { number?: string; name?: string } | null;
  jobCostItem?: { id?: string } | null;
}

export interface WorkbenchHeader {
  id: string;
  name?: string;
  subject?: string;
  fromName?: string;
  number?: string;
  externalId?: string;
  status?: string;
  cost?: number;
  issueDate?: string;
  nonRecoverableTax?: number;
}

/** One cost code's budget vs. approved+pending spend, from getCostToComplete. */
interface Ctc {
  budget: number;
  actual: number;
  remaining: number;
}

interface BillPayload {
  header?: WorkbenchHeader | null;
  lines?: WorkbenchLine[];
  budget?: Option[];
  costToComplete?: Record<string, Ctc>;
  files?: BillFile[];
  /** The bill's job Phase — what decides whether its sales tax is recoverable. */
  jobPhase?: string;
  writesEnabled?: boolean;
  reviewed?: boolean;
  saved?: boolean;
  error?: string;
}

/** The bill the workbench is pointed at — carried from the queue row. */
export interface Selection {
  docId: string;
  jobId: string;
  /** Vendor (or "Vendor · invoice id"), as the queue row shows it. */
  label: string;
  jobName: string;
}

/**
 * True from the `xl` breakpoint up — the width at which the three columns fit
 * and a queue row selects a bill instead of navigating to it. Starts false so
 * the server and the first client render agree, then corrects in the effect.
 */
export function useIsWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
}

/**
 * Billing-month options for the card's Filing section.
 *
 * Value is a `ym` ("2026-07"), NOT a date — the card's Select compares it
 * against `bill.issueDate.slice(0, 7)`, so anything else leaves the control
 * showing nothing selected. Same list and same convention as the board's.
 */
function billingMonthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 18; i++) {
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
    });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/**
 * The issueDate that files a bill in `ym`: the last day of that month, the
 * convention /api/bill-issuedate expects and the board writes.
 */
function issueDateFor(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// THE EDITOR — one bill's payload plus the edits staged against it
// ---------------------------------------------------------------------------

export interface BillEditor {
  loading: boolean;
  error: string;
  header: WorkbenchHeader | null;
  lines: WorkbenchLine[];
  budget: Option[];
  ctc: Record<string, Ctc>;
  files: BillFile[];
  /** COMPANION_WRITES_ENABLED, as the server reports it for this request. */
  writes: boolean;
  reviewed: boolean;
  toggleReviewed: () => void;
  picked: Record<string, string>;
  setPicked: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  edits: Record<string, LineEdit | undefined>;
  setEdits: React.Dispatch<React.SetStateAction<Record<string, LineEdit | undefined>>>;
  taxEdit: string | null;
  setTaxEdit: (v: string | null) => void;
  storedTax: number;
  /** The bill's job Phase — decides whether its sales tax is recoverable. */
  jobPhase: string;
  taxView: number;
  taxChanged: boolean;
  taxName: string;
  math: BillMath;
  /** Lines differing from JobTread, plus the tax if it's been retyped. */
  changeCount: number;
  /**
   * Set when unsynced work for this bill was offered back on open — how much
   * came back, and how much was dropped as already-applied or stale. See
   * src/lib/codingDraft.ts.
   */
  restored: { kept: number; dropped: number; savedAt: string } | null;
  dismissRestored: () => void;
  saving: boolean;
  saveMsg: string;
  save: () => Promise<void>;
  /** Cost-code number → pre-tax dollars THIS bill currently puts on it. */
  pendingByCode: Map<string, number>;
  /** Re-read this bill from JobTread — what every structural write calls. */
  reload: () => Promise<void>;
}

/**
 * Loads the selected bill and holds the edits staged against it.
 *
 * `handlers` is read through a ref, so a caller can pass fresh closures every
 * render without churning this hook's dependencies.
 */
export function useBillEditor(
  sel: Selection | null,
  handlers: { onSaved?: (docId: string) => void; onReviewed?: (docId: string, v: boolean) => void } = {},
): BillEditor {
  const hRef = useRef(handlers);
  hRef.current = handlers;

  const docId = sel?.docId ?? "";
  const jobId = sel?.jobId ?? "";

  const [payload, setPayload] = useState<BillPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, LineEdit | undefined>>({});
  const [taxEdit, setTaxEdit] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [restored, setRestored] = useState<{
    kept: number;
    dropped: number;
    savedAt: string;
  } | null>(null);

  // Which bill the state on screen belongs to. Stepping down the queue fires a
  // request per bill; only the one for the CURRENT selection may apply its
  // result, or a slow earlier response lands on top of a later bill.
  const keyRef = useRef("");

  const fetchInto = useCallback(async (key: string, d: string, j: string) => {
    const res = await fetch(
      `/api/bill?docId=${encodeURIComponent(d)}&jobId=${encodeURIComponent(j)}`,
    );
    const json = (await res.json()) as BillPayload;
    if (keyRef.current !== key) return; // selection moved on while this was in flight
    if (!res.ok) {
      setError(json.error ?? "Request failed");
      return;
    }
    setPayload(json);
    setReviewed(Boolean(json.reviewed));
  }, []);

  useEffect(() => {
    const key = `${docId}|${jobId}`;
    keyRef.current = key;
    // Edits belong to the bill they were typed on, so the screen is cleared for
    // the incoming one — but they are no longer THROWN AWAY by that: the
    // autosave below has already written the outgoing bill's work under its own
    // key, and stepping back to it offers the work straight back. Stepping down
    // the queue is now free.
    setPicked({});
    setEdits({});
    setTaxEdit(null);
    setSaveMsg("");
    setRestored(null);
    setError("");
    setPayload(null);
    if (!docId || !jobId) return;
    setLoading(true);
    fetchInto(key, docId, jobId)
      .catch((e) => {
        if (keyRef.current === key) setError(e instanceof Error ? e.message : "Network error");
      })
      .finally(() => {
        if (keyRef.current === key) setLoading(false);
      });
  }, [docId, jobId, fetchInto]);

  const header = payload?.header ?? null;
  const lines = useMemo(() => payload?.lines ?? [], [payload]);
  const budget = useMemo(() => payload?.budget ?? [], [payload]);
  const ctc = useMemo(() => payload?.costToComplete ?? {}, [payload]);
  const files = useMemo(() => payload?.files ?? [], [payload]);
  const jobPhase = payload?.jobPhase ?? "";
  const writes = Boolean(payload?.writesEnabled);

  // Sales tax is its own 88 80 00 cost item, so it leaves the codeable line list
  // and drives the Tax row instead. See the note in bill/[docId]/page.tsx.
  const legacyTaxField = header?.nonRecoverableTax ?? 0;
  const { lines: codeableLines, taxAmount: storedTax } = useMemo(
    () =>
      splitSalesTax(
        lines.map((l) => ({ ...l, jobCostItemId: l.jobCostItem?.id ?? null })),
        legacyTaxField,
      ),
    [lines, legacyTaxField],
  );
  const taxName = SALES_TAX_LINE_NAME;
  const taxView = taxEdit !== null && taxEdit !== "" ? Number(taxEdit) || 0 : storedTax;
  const taxChanged = taxEdit !== null && round2(taxView) !== round2(storedTax);
  // A bill still carrying tax in the document field is migrated by any save: the
  // line write sends de-taxed costs, so the tax must move onto its own 88 80 00
  // line in the same save or the bill's total falls by the tax amount.
  const needsTaxMigration = legacyTaxField > 0;

  const math = useMemo(
    () =>
      billLineMath({
        lines: codeableLines,
        storedTax,
        legacyTaxField,
        taxView,
        status: header?.status,
        edits,
        picked,
        budget,
      }),
    [codeableLines, storedTax, legacyTaxField, taxView, header?.status, edits, picked, budget],
  );

  const changeCount = math.pendingCount + (taxChanged ? 1 : 0);

  // ---- durable drafts -----------------------------------------------------
  /**
   * Coding staged against ONE bill is saved continuously under that bill's own
   * key and offered back when it is next opened — which is what makes stepping
   * down the queue, or leaving the page entirely, cost nothing. It is not sent
   * to JobTread: Save is still the only thing that writes. See
   * src/lib/codingDraft.ts.
   */
  const draftKey = docId ? billDraftKey(docId) : "";
  /**
   * TWO refs, not one. Opening a bill empties the staged state and the restore
   * that follows is async, so arming the autosave when the restore STARTS would
   * fire it on that emptiness — deleting the draft still being read. The restore
   * marks itself started, and arms the autosave only once it has finished.
   */
  const restoreStartedRef = useRef("");
  const autosaveArmedRef = useRef("");

  useEffect(() => {
    if (!draftKey || !payload || !header) return;
    if (restoreStartedRef.current === draftKey) return;
    restoreStartedRef.current = draftKey;
    let alive = true;
    (async () => {
      try {
        const draft = await loadDraft(draftKey);
        if (!alive || !draft) return;
        const r = reconcileDraft(draft, {
          lines: lines.map((l) => ({ id: l.id, jobCostItemId: l.jobCostItem?.id ?? null })),
          bills: [{ id: header.id, salesTax: storedTax }],
          budgetIds: budget.map((b) => b.id),
        });
        if (r.kept === 0) {
          if (r.dropped > 0) discardDraft(draftKey);
          return;
        }
        // Only ever ADD to an empty state — the read is async, and anything typed
        // while it was in flight outranks what was stored earlier.
        setPicked((prev) => (Object.keys(prev).length > 0 ? prev : r.staged));
        setEdits((prev) => (Object.keys(prev).length > 0 ? prev : r.edits));
        setTaxEdit((prev) => (prev !== null ? prev : (r.taxEdits[header.id] ?? null)));
        setRestored({ kept: r.kept, dropped: r.dropped, savedAt: draft.savedAt });
      } finally {
        if (alive) autosaveArmedRef.current = draftKey;
      }
    })();
    return () => {
      alive = false;
    };
    // `lines`/`budget`/`header` all come from `payload`, which is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, payload]);

  useEffect(() => {
    if (!draftKey || autosaveArmedRef.current !== draftKey) return;
    const compactEdits: Record<string, LineEdit> = {};
    for (const [id, e] of Object.entries(edits)) if (e) compactEdits[id] = e;
    saveDraft(
      draftKey,
      {
        staged: picked,
        edits: compactEdits,
        taxEdits: taxEdit !== null && taxEdit !== "" ? { [docId]: taxEdit } : {},
      },
      // What the "unfinished work" list on the landing page calls this row: the
      // bill as the queue names it, and the job it is on.
      [sel?.label, sel?.jobName].filter(Boolean).join(" · "),
    );
  }, [draftKey, docId, picked, edits, taxEdit, sel?.label, sel?.jobName]);

  /**
   * What this bill would add to each cost code once saved.
   *
   * A DRAFT bill is invisible to cost-to-complete (it only counts approved and
   * pending vendor bills), so without this the rail would sit perfectly still
   * while you coded — the one moment its numbers matter most. Keyed by cost-code
   * NUMBER, because that's what cost-to-complete is keyed by.
   */
  const pendingByCode = useMemo(() => {
    const numberOf = new Map(budget.map((o) => [o.id, o.number]));
    const m = new Map<string, number>();
    for (const t of math.targets) {
      const id = picked[t.line.id] ?? t.line.jobCostItemId ?? "";
      const num = id ? numberOf.get(id) : undefined;
      if (!num) continue;
      m.set(num, round2((m.get(num) ?? 0) + t.qty * t.preTaxUnit));
    }
    return m;
  }, [math, picked, budget]);

  const save = useCallback(async () => {
    if (!docId) return;
    if (math.wholeBillChanges.length === 0 && !taxChanged && !needsTaxMigration) {
      setSaveMsg("Nothing to save.");
      return;
    }
    setSaving(true);
    setSaveMsg("");
    try {
      let failed = 0;
      // 1) Every line, not just the touched ones — the tax-inclusive costs are
      //    mutually dependent (see billLineMath).
      if (math.wholeBillChanges.length) {
        const codingLog = recodeLog(
          lines.map((l) => ({
            id: l.id,
            name: l.name,
            jobCostItemId: l.jobCostItem?.id ?? null,
          })),
          picked,
          budget,
        );
        const res = await fetch("/api/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes: math.wholeBillChanges, docId, codingLog }),
        });
        const json = await res.json();
        if (!res.ok) {
          setSaveMsg(json.error ?? "Save failed");
          return;
        }
        if (json.previewed) {
          setSaveMsg("Preview only — writes are OFF. The bill would be re-sent to JobTread.");
          return;
        }
        failed = ((json.results ?? []) as { ok: boolean }[]).filter((r) => !r.ok).length;
      }
      // 2) The document-level sales tax rides along in the same Save.
      if (taxChanged || needsTaxMigration) {
        const res = await fetch("/api/bill-tax", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, taxAmount: round2(taxView) }),
        });
        const json = await res.json();
        if (!res.ok) {
          setSaveMsg(json.error ?? "Tax save failed");
          return;
        }
        if (json.previewed) {
          setSaveMsg("Preview only — writes are OFF. Nothing saved to JobTread.");
          return;
        }
      }
      setPicked({});
      setEdits({});
      setTaxEdit(null);
      setRestored(null);
      if (failed) {
        // Some lines didn't land. The state on screen is about to be emptied and
        // re-read from JobTread, so re-arm the restore rather than dropping the
        // draft: reconcileDraft removes everything JobTread has now taken, which
        // leaves exactly the changes that failed.
        restoreStartedRef.current = "";
        autosaveArmedRef.current = "";
      } else if (draftKey) {
        discardDraft(draftKey); // it's in JobTread now — nothing left to hold
      }
      setSaveMsg(failed ? `Saved, ${failed} line(s) failed.` : "Saved.");
      markBillTouched(docId);
      hRef.current.onSaved?.(docId);
      // Re-read JobTread's truth, so the rail and the totals reflect the write.
      await fetchInto(`${docId}|${jobId}`, docId, jobId).catch(() => {
        /* the save landed; a failed re-read leaves the old numbers on screen */
      });
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }, [docId, jobId, draftKey, math, taxChanged, needsTaxMigration, taxView, lines, picked, budget, fetchInto]);

  /** Re-read this bill from JobTread, keeping the staged edits on screen. */
  const reload = useCallback(async () => {
    if (!docId || !jobId) return;
    await fetchInto(`${docId}|${jobId}`, docId, jobId).catch(() => {
      /* best-effort — a failed re-read leaves the last known bill on screen */
    });
  }, [docId, jobId, fetchInto]);

  const toggleReviewed = useCallback(() => {
    if (!docId) return;
    const next = !reviewed;
    setReviewed(next); // optimistic
    hRef.current.onReviewed?.(docId, next);
    fetch("/api/bill-reviewed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId, reviewed: next }),
    })
      .then((res) => {
        if (!res.ok) {
          setReviewed(!next);
          hRef.current.onReviewed?.(docId, !next);
        }
      })
      .catch(() => {
        setReviewed(!next);
        hRef.current.onReviewed?.(docId, !next);
      });
  }, [docId, reviewed]);

  return {
    loading,
    error,
    header,
    lines,
    budget,
    ctc,
    files,
    writes,
    reviewed,
    toggleReviewed,
    picked,
    setPicked,
    edits,
    setEdits,
    taxEdit,
    setTaxEdit,
    storedTax,
    jobPhase,
    taxView,
    taxChanged,
    taxName,
    math,
    changeCount,
    restored,
    dismissRestored: () => setRestored(null),
    saving,
    saveMsg,
    save,
    pendingByCode,
    reload,
  };
}

// ---------------------------------------------------------------------------
// LEFT COLUMN — the budget rail for the selected bill's job
// ---------------------------------------------------------------------------

interface RailRow {
  code: string;
  name: string;
  division: string;
  budget: number;
  actual: number;
  pending: number;
}

/**
 * Is this cost code the DIVISION itself ("04 00 00", "26 00 00")? Everything
 * after the first two digits is zero. JobTread leaves these without a
 * parentCostCode — they ARE the parent — so their own name names the division.
 */
function isDivisionLevelCode(number: string): boolean {
  const digits = String(number ?? "").replace(/\D/g, "");
  return digits.length >= 4 && /^0+$/.test(digits.slice(2));
}

const railRemaining = (r: RailRow) => r.budget - r.actual - r.pending;

/**
 * The selected bill's job budget, grouped into collapsible CSI divisions.
 *
 * Deliberately a narrower instrument than the job workbench's rail: it has no
 * labor and no other job's drafts in it, because `/api/bill` carries only the
 * job's cost-to-complete (budget from approved customer orders, actual from
 * approved + pending vendor bills). What it adds is the bill in front of you —
 * a draft counts toward nothing in JobTread's numbers, so the coding you are
 * doing right now would otherwise move nothing on screen.
 */
export function DraftBudgetRail({ editor, sel }: { editor: BillEditor; sel: Selection | null }) {
  const { budget, ctc, pendingByCode, loading } = editor;
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    // A cost code's display name and division come from the budget leaves; the
    // money comes from cost-to-complete, which is keyed by the same number.
    const meta = new Map<string, { name: string; division: string }>();
    for (const o of budget) {
      if (!o.number || meta.has(o.number)) continue;
      meta.set(o.number, { name: o.name || "", division: o.division || "" });
    }
    const codes = new Set<string>([
      ...Object.keys(ctc),
      ...budget.map((o) => o.number).filter(Boolean),
      ...pendingByCode.keys(),
    ]);
    const out: RailRow[] = [];
    for (const code of codes) {
      const c = ctc[code];
      const row: RailRow = {
        code,
        name: meta.get(code)?.name ?? "",
        division: meta.get(code)?.division ?? "",
        budget: c?.budget ?? 0,
        actual: c?.actual ?? 0,
        pending: pendingByCode.get(code) ?? 0,
      };
      // A code with no budget, no spend and nothing from this bill has nothing
      // to say — the picker still offers it, the rail doesn't list it.
      if (row.budget === 0 && row.actual === 0 && row.pending === 0) continue;
      out.push(row);
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }, [budget, ctc, pendingByCode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.code} ${r.name}`.toLowerCase().includes(q));
  }, [rows, query]);

  const groups = useMemo(() => {
    const g = new Map<string, { code: string; name: string; rows: RailRow[] }>();
    for (const r of filtered) {
      const dc = r.code.replace(/\D/g, "").slice(0, 2) || "—";
      const e = g.get(dc) ?? { code: dc, name: "", rows: [] };
      // Same rule the job rail uses: a code that IS its division
      // ("04 00 00 Masonry") has no parentCostCode in JobTread, so its own name
      // names the division — otherwise the header shows a bare number.
      if (!e.name) e.name = r.division || (isDivisionLevelCode(r.code) ? r.name : "");
      e.rows.push(r);
      g.set(dc, e);
    }
    return [...g.values()]
      .map((e) => ({
        ...e,
        budget: e.rows.reduce((s, r) => s + r.budget, 0),
        used: e.rows.reduce((s, r) => s + r.actual + r.pending, 0),
        remaining: e.rows.reduce((s, r) => s + railRemaining(r), 0),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [filtered]);

  // Divisions this bill touches open themselves; everything else starts rolled
  // up, so the rail lands as a scannable index with your codes already showing.
  // Re-seeded per bill (not per render), so collapsing one by hand sticks.
  const seededFor = useRef("");
  useEffect(() => {
    const docId = sel?.docId ?? "";
    if (!docId || rows.length === 0 || seededFor.current === docId) return;
    seededFor.current = docId;
    const touched = new Set(
      [...pendingByCode.keys()].map((c) => c.replace(/\D/g, "").slice(0, 2) || "—"),
    );
    const all = new Set(rows.map((r) => r.code.replace(/\D/g, "").slice(0, 2) || "—"));
    setCollapsed(new Set([...all].filter((d) => !touched.has(d))));
  }, [sel?.docId, rows, pendingByCode]);

  const toggleDiv = (code: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <SectionLabel>Budget</SectionLabel>
        {groups.length > 0 && (
          <button
            type="button"
            onClick={() =>
              setCollapsed((prev) =>
                prev.size > 0 ? new Set() : new Set(groups.map((g) => g.code)),
              )
            }
            className="shrink-0 text-[11px] text-neutral-500 transition hover:text-accent dark:text-neutral-400"
          >
            {collapsed.size > 0 ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>

      {!sel ? (
        <EmptyState>Pick a bill to see its job&apos;s budget.</EmptyState>
      ) : loading && rows.length === 0 ? (
        <Loading label="Loading budget…" />
      ) : rows.length === 0 ? (
        <EmptyState>No budget on this job yet.</EmptyState>
      ) : (
        <>
          <Card pad={false} className="overflow-hidden">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter cost codes…"
              className="w-full border-b border-line bg-transparent px-2 py-1.5 text-xs outline-none"
            />
            {/* Sized off the viewport so the docked rail always fits on screen
                and scrolls inside itself. */}
            <div className="max-h-[calc(100dvh-16rem)] overflow-y-auto">
              {groups.length === 0 ? (
                <p className="px-3 py-4 text-xs text-neutral-500">No cost codes match.</p>
              ) : (
                groups.map((g) => {
                  // A filter term force-opens what it matched — searching a
                  // collapsed rail otherwise looks like it found nothing.
                  const open = !collapsed.has(g.code) || query.trim() !== "";
                  return (
                    <div key={g.code}>
                      <button
                        type="button"
                        onClick={() => toggleDiv(g.code)}
                        aria-expanded={open}
                        className="flex w-full items-baseline gap-1.5 border-b border-line bg-neutral-50/80 px-2 py-1 text-left transition hover:bg-accent/5 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
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

                      {!open && (
                        <div className="border-b border-line-soft px-2 pb-1">
                          <Meter budget={g.budget} used={g.used} label={`Division ${g.code}`} />
                        </div>
                      )}

                      {open && (
                        <ul>
                          {g.rows.map((r) => {
                            const left = railRemaining(r);
                            const pct = r.budget > 0 ? Math.round((left / r.budget) * 100) : null;
                            return (
                              <li
                                key={r.code}
                                title={
                                  `${r.code} ${r.name}\n` +
                                  `${money(r.actual)} committed` +
                                  (r.pending > 0 ? ` + ${money(r.pending)} from this bill` : "") +
                                  ` of ${money(r.budget)} budget\n${money(left)} remaining` +
                                  (pct !== null ? ` (${pct}% of budget)` : "")
                                }
                                className={`border-b border-line-soft px-2 py-1 pl-4 ${
                                  r.pending > 0 ? "bg-accent/5" : ""
                                }`}
                              >
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="min-w-0 truncate text-xs">
                                    <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                                      {r.code}
                                    </span>{" "}
                                    {r.name}
                                  </span>
                                  <span
                                    className={`shrink-0 text-xs font-semibold tabular-nums ${
                                      left < 0 ? "text-red-600 dark:text-red-400" : ""
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
                                <Meter
                                  budget={r.budget}
                                  used={r.actual + r.pending}
                                  label={r.code}
                                />
                                {r.pending > 0 && (
                                  <div className="mt-0.5 text-[10px] font-semibold text-accent dark:text-accent-soft">
                                    + {money(r.pending)} this bill
                                  </div>
                                )}
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
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {sel.jobName ? <span className="font-semibold">{sel.jobName}. </span> : null}
            Remaining = budget − approved and pending bills − whatever the bill on the right is
            coded to right now. Labor and other jobs&apos; drafts aren&apos;t counted here — open
            the job in Tracking Sheets for the full picture.
          </p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// RIGHT COLUMN — coding the selected bill
// ---------------------------------------------------------------------------

/**
 * The needs-coding queue's right column.
 *
 * The card itself is BillCodingCard — the SAME component the job workbench
 * renders, so the two can't drift again. What this builds is the controller
 * behind it: the queue's own coding state (which is saved a bill at a time,
 * not staged for a page-level Sync) and the structural writes the card offers.
 *
 * Those writes go to the same endpoints the board uses — /api/combine-lines,
 * /api/delete-line, /api/add-line, /api/buyback, /api/bill-issuedate,
 * /api/bill-number, /api/reassign-job — with the same confirms. What differs
 * is what happens afterwards: the board reloads a month, this reloads one bill
 * and tells the queue its row may have changed.
 */
export function DraftCodingPanel({
  editor,
  sel,
  position,
  count,
  onPrev,
  onNext,
  onBillMoved,
}: {
  editor: BillEditor;
  sel: Selection | null;
  /** 1-based place in the visible queue, for the ‹ n / total › readout. */
  position: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
  /** The bill left this queue (re-filed to another job) — drop its row. */
  onBillMoved: (docId: string) => void;
}) {
  const c = useCopy();
  const {
    loading,
    error,
    header,
    lines,
    budget,
    ctc,
    files,
    writes,
    reviewed,
    toggleReviewed,
    picked,
    setPicked,
    edits,
    setEdits,
    taxEdit,
    setTaxEdit,
    storedTax,
    jobPhase,
    taxView,
    math,
    changeCount,
    restored,
    dismissRestored,
    saving,
    saveMsg,
    save,
    pendingByCode,
    reload,
  } = editor;

  const docId = sel?.docId ?? "";
  const jobId = sel?.jobId ?? "";

  // ---- the card's own transient state ------------------------------------
  const [bulkCode, setBulkCode] = useState("");
  const [combineSelected, setCombineSelected] = useState<string[]>([]);
  const [combining, setCombining] = useState(false);
  const [combineMsg, setCombineMsg] = useState("");
  const [buybackId, setBuybackId] = useState("");
  const [deletingLineId, setDeletingLineId] = useState("");
  const [deleteLineMsg, setDeleteLineMsg] = useState("");
  const [addingLine, setAddingLine] = useState(false);
  const [newLine, setNewLine] = useState({ name: "", quantity: "1", unitCost: "0", code: "" });
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [addLineMsg, setAddLineMsg] = useState("");
  const [billNumberDraft, setBillNumberDraft] = useState("");
  const [billNumberSaving, setBillNumberSaving] = useState(false);
  const [monthSaving, setMonthSaving] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [filingMsg, setFilingMsg] = useState("");

  // Every one of these belongs to the bill it was opened on.
  useEffect(() => {
    setBulkCode("");
    setCombineSelected([]);
    setCombineMsg("");
    setDeleteLineMsg("");
    setAddingLine(false);
    setNewLine({ name: "", quantity: "1", unitCost: "0", code: "" });
    setAddLineMsg("");
    setFilingMsg("");
  }, [docId]);

  // The Bill Number field is a draft over JobTread's value, re-seeded whenever
  // JobTread's own answer changes (a different bill, or a save that reloaded).
  useEffect(() => {
    setBillNumberDraft((header?.externalId ?? "").trim());
  }, [header?.externalId, docId]);

  // ---- coding ------------------------------------------------------------

  /** The card's CodingLine shape — the same one Board's JobBillLine satisfies. */
  const cardLines: CodingLine[] = useMemo(
    () =>
      lines.map((l) => ({
        id: l.id,
        docId,
        billStatus: header?.status ?? "draft",
        name: l.name ?? "",
        cost: l.cost ?? 0,
        quantity: l.quantity,
        unitCost: l.unitCost,
        code: (l.costCode?.number ?? "").trim(),
        codeName: l.costCode?.name ?? "",
        jobCostItemId: l.jobCostItem?.id ?? null,
      })),
    [lines, docId, header?.status],
  );

  const leafOf = useCallback(
    (l: CodingLine) => picked[l.id] ?? l.jobCostItemId ?? "",
    [picked],
  );
  const numberOf = useMemo(() => new Map(budget.map((o) => [o.id, o.number])), [budget]);
  const codeOf = useCallback(
    (l: CodingLine) => {
      const leaf = leafOf(l);
      return (leaf ? numberOf.get(leaf) : undefined) ?? l.code;
    },
    [leafOf, numberOf],
  );

  /**
   * Which lines have been moved off the code JobTread holds — the card's
   * "moved from" mark. The board keeps a Map for this; here the picks ARE the
   * record, so a line counts as moved when its pick differs from the stored
   * leaf.
   */
  const staged = useMemo(
    () => ({
      has: (lineId: string) => {
        const p = picked[lineId];
        if (p === undefined) return false;
        const l = cardLines.find((x) => x.id === lineId);
        return p !== (l?.jobCostItemId ?? "");
      },
    }),
    [picked, cardLines],
  );

  const applyCodeToAll = useCallback(
    (leafId: string) => {
      if (!leafId || cardLines.length === 0) return;
      setPicked((p) => {
        const next = { ...p };
        for (const l of cardLines) next[l.id] = leafId;
        return next;
      });
    },
    [cardLines, setPicked],
  );

  /**
   * Dollars left on a code. Budget minus approved+pending bills, minus what
   * this bill is coded to right now — a draft counts toward nothing in
   * JobTread, so without the last term the figure wouldn't move as you code.
   */
  const remainingFor = useCallback(
    (code: string) => {
      const row = ctc[code];
      if (!row) return null;
      return row.budget - row.actual - (pendingByCode.get(code) ?? 0);
    },
    [ctc, pendingByCode],
  );

  // ---- combine (same rules as the board) ---------------------------------
  const combineById = useMemo(
    () => new Map(cardLines.map((l) => [l.id, l] as const)),
    [cardLines],
  );
  const combineCodeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cardLines) {
      const code = leafOf(l);
      if (code) m.set(code, (m.get(code) ?? 0) + 1);
    }
    return m;
  }, [cardLines, leafOf]);
  const isCombinable = useCallback(
    (l: CodingLine) => (combineCodeCounts.get(leafOf(l)) ?? 0) >= 2,
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
          .filter((l): l is CodingLine => !!l)
          .map((l) => leafOf(l))
          .filter(Boolean),
      ),
    [combineSelected, combineById, leafOf],
  );
  const combineHasEdit = combineSelected.some((id) => {
    const e = edits[id];
    return Boolean(
      e && (e.name !== undefined || e.quantity !== undefined || e.unitCost !== undefined),
    );
  });
  const canCombine =
    combineSelected.length >= 2 && combineCodeSet.size === 1 && !combineHasEdit;

  const toggleCombineSel = (id: string) =>
    setCombineSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const combineRows = async () => {
    const chosen = combineSelected
      .map((id) => combineById.get(id))
      .filter((l): l is CodingLine => !!l);
    if (chosen.length < 2 || !header) return;
    const codeId = leafOf(chosen[0]);
    if (!codeId || !chosen.every((l) => leafOf(l) === codeId)) return; // mixed codes
    const keep = chosen[0];
    const name =
      chosen
        .map((l) => l.name.trim())
        .filter(Boolean)
        .join(" + ")
        .substring(0, 250) || "Line item";
    setCombining(true);
    setCombineMsg("");
    try {
      const res = await fetch("/api/combine-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          keepId: keep.id,
          deleteIds: chosen.slice(1).map((l) => l.id),
          name,
          extendedCost: round2(chosen.reduce((s, l) => s + l.cost, 0)),
          jobCostItemId: codeId || undefined,
          description: descriptionForCode(codeId, budget),
        }),
      });
      const json = await res.json();
      if (!res.ok) setCombineMsg(json.error ?? "Combine failed");
      else if (json.previewed)
        setCombineMsg("Preview only — writes are OFF. Nothing was combined in JobTread.");
      else {
        setCombineSelected([]);
        await reload();
      }
    } catch (e) {
      setCombineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setCombining(false);
    }
  };

  // ---- delete / add / buyback --------------------------------------------

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
        body: JSON.stringify({ docId, costItemId: id }),
      });
      const json = await res.json();
      if (!res.ok) setDeleteLineMsg(json.error ?? "Delete failed");
      else if (json.previewed)
        setDeleteLineMsg("Preview only — writes are OFF. Nothing was deleted in JobTread.");
      else {
        setCombineSelected((s) => s.filter((x) => x !== id));
        setPicked((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
        setEdits((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
        await reload();
      }
    } catch (e) {
      setDeleteLineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setDeletingLineId("");
    }
  };

  const addLine = async () => {
    const name = newLine.name.trim();
    if (!name || !header) return;
    setAddLineSaving(true);
    setAddLineMsg("");
    try {
      // Unit $ is entered PRE-TAX, like the line editor; gross it up against
      // the bill's CURRENT previewed subtotal so it lands consistent with
      // what's on screen, including an unsaved tax edit.
      const qty = Number(newLine.quantity) || 0;
      const preTaxUnit = Number(newLine.unitCost) || 0;
      const newSumPreTax = math.subtotal + preTaxUnit * qty;
      const reTaxAdd = newSumPreTax > 0 ? (newSumPreTax + taxView) / newSumPreTax : 1;
      const res = await fetch("/api/add-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          name,
          quantity: qty,
          unitCost: round2(preTaxUnit * reTaxAdd),
          jobCostItemId: newLine.code || undefined,
          description: descriptionForCode(newLine.code, budget),
        }),
      });
      const json = await res.json();
      if (!res.ok) setAddLineMsg(json.error ?? "Add failed");
      else if (json.previewed)
        setAddLineMsg("Preview only — writes are OFF. Nothing was added to JobTread.");
      else {
        setAddingLine(false);
        setNewLine({ name: "", quantity: "1", unitCost: "0", code: "" });
        await reload();
      }
    } catch (e) {
      setAddLineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setAddLineSaving(false);
    }
  };

  const buybackLineById = async (l: CodingLine, name: string, extended: number) => {
    if (
      !window.confirm(
        `Buy back this line to Ascent - Shop?\n\n${name} — ${money(extended)}\n\n` +
          `This moves it onto a draft bill on the Shop job (creating one if needed) and ` +
          `removes it from this bill.`,
      )
    )
      return;
    setBuybackId(l.id);
    setDeleteLineMsg("");
    try {
      const codeId = leafOf(l);
      const res = await fetch("/api/buyback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDocId: docId,
          costItemId: l.id,
          name,
          unitCost: round2(extended),
          description: codeId ? descriptionForCode(codeId, budget) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) setDeleteLineMsg(json.error ?? "Buyback failed.");
      else if (json.previewed)
        setDeleteLineMsg("Preview only — writes are OFF. Nothing was moved in JobTread.");
      else {
        setPicked((p) => {
          const next = { ...p };
          delete next[l.id];
          return next;
        });
        setEdits((p) => {
          const next = { ...p };
          delete next[l.id];
          return next;
        });
        setDeleteLineMsg(
          json.created ? "Moved to a new Shop bill." : "Added to the existing Shop bill.",
        );
        await reload();
      }
    } catch (e) {
      setDeleteLineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setBuybackId("");
    }
  };

  // ---- filing -------------------------------------------------------------
  // Unlike the board, this queue is scoped by STATUS rather than by month, so
  // re-dating a bill never takes it off the list — there's no "it leaves this
  // month" case to warn about. Moving it to another job does remove it, since
  // the recreate mints a new document.

  const setBillingMonth = async (targetYm: string) => {
    if (!header || !targetYm) return;
    setMonthSaving(true);
    setFilingMsg("");
    try {
      const res = await fetch("/api/bill-issuedate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, issueDate: issueDateFor(targetYm) }),
      });
      const json = await res.json();
      if (!res.ok) setFilingMsg(json.error ?? "Couldn't set the billing month.");
      else if (json.previewed)
        setFilingMsg("Preview only — writes are OFF. The billing month wasn't changed.");
      else {
        setFilingMsg("Billing month saved.");
        await reload();
      }
    } catch (e) {
      setFilingMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setMonthSaving(false);
    }
  };

  const saveBillNumber = async () => {
    if (!header) return;
    const next = billNumberDraft.trim();
    if (next === (header.externalId ?? "").trim()) return;
    setBillNumberSaving(true);
    setFilingMsg("");
    try {
      const res = await fetch("/api/bill-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, externalId: next }),
      });
      const json = await res.json();
      if (!res.ok) setFilingMsg(json.error ?? "Couldn't set the bill number.");
      else if (json.previewed)
        setFilingMsg("Preview only — writes are OFF. The bill number wasn't changed.");
      else {
        setFilingMsg("Bill number saved.");
        await reload();
      }
    } catch (e) {
      setFilingMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setBillNumberSaving(false);
    }
  };

  const reassignJob = async (target: JobRef) => {
    if (!header || !target.id || target.id === jobId) return;
    if (
      !window.confirm(
        `Move this bill to ${jobLabel(target)}?\n\nJobTread can't move bills, so it will be ` +
          `deleted and recreated on that job. It stays a draft, keeps its PDF, and re-files ` +
          `in Drive.` +
          (changeCount > 0
            ? "\n\nIts unsaved coding changes go with it — the recreated bill is a new " +
              "document, so they can't be applied to it."
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
        body: JSON.stringify({ docId, jobId: target.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setFilingMsg(json.error ?? "Reassign failed");
        return;
      }
      // The recreate minted a NEW document on another job, so this row is stale —
      // and so is any draft held against the old document id.
      discardDraft(billDraftKey(docId));
      onBillMoved(docId);
    } catch (e) {
      setFilingMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setReassigning(false);
    }
  };

  const ctl: CodingCardCtl = {
    bill: header
      ? {
          id: header.id,
          label: sel?.label ?? "",
          cost: header.cost ?? 0,
          status: header.status,
          reviewed,
          // A draft can't be on a customer invoice — that's what makes it a
          // draft — so the card's read-only path never applies here.
          invoiced: false,
          jobPhase,
          number: header.number,
          issueDate: header.issueDate,
        }
      : null,
    lines: cardLines,
    math,
    jobId,
    c,
    writes,
    codeOptions: budget,
    leafOf,
    codeOf,
    stageLine: (lineId, leafId) => setPicked((p) => ({ ...p, [lineId]: leafId })),
    staged,
    remainingFor,
    bulkCode,
    setBulkCode,
    applyCodeToAll,
    edits,
    setLineEdit: (lineId, patch) =>
      setEdits((p) => ({ ...p, [lineId]: { ...p[lineId], ...patch } })),
    taxEdit,
    storedTax,
    taxView,
    setTax: setTaxEdit,
    toggleReviewed: () => toggleReviewed(),
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
    filesLoading: loading,
    billNumberDraft,
    setBillNumberDraft,
    saveBillNumber,
    billNumberSaving,
    monthOptions: billingMonthOptions(),
    setBillingMonth,
    monthSaving,
    reassignJob,
    reassigning,
    filingMsg,
  };

  const stepBtn =
    "inline-flex min-h-8 items-center rounded-lg border border-line px-2 text-xs font-semibold transition hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-inherit";

  return (
    <>
      {/* The queue's own header sits ABOVE the shared card, which carries its
          own "Coding" label — this row is the part the board has no use for:
          stepping down a list that spans every job. */}
      {count > 1 && sel && (
        <div className="mb-2 flex items-center justify-end gap-1.5">
          <button type="button" className={stepBtn} onClick={onPrev} disabled={position <= 1}>
            ‹ Prev
          </button>
          <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
            {position} / {count}
          </span>
          <button type="button" className={stepBtn} onClick={onNext} disabled={position >= count}>
            Next ›
          </button>
        </div>
      )}

      {error && <Banner tone="error" className="mb-2">{error}</Banner>}
      {sel && loading && !header && <Loading label="Loading bill…" />}

      {/* The job, which the board never has to say — there it's the whole page. */}
      {sel && header && (
        <p className="mb-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
          {sel.jobName}
        </p>
      )}

      {/* Save sits OUTSIDE the card, above it, where the board puts its Sync:
          the board commits a whole month of staged bills at once, this
          commits the one bill in front of you — and pinned at the top means
          it's still on screen after scrolling down a long bill. */}
      {header && (
        <div className="mb-2">
          <Button className="w-full" onClick={save} disabled={saving}>
            {saving
              ? "Saving…"
              : changeCount > 0
                ? `Save ${changeCount} change${changeCount === 1 ? "" : "s"}`
                : "Save"}
          </Button>
          {saveMsg && (
            <Banner
              tone={/fail|error|preview/i.test(saveMsg) ? "warning" : "success"}
              className="mt-2 !py-1.5 !text-[11px]"
            >
              {saveMsg}
            </Banner>
          )}
          {/* Unsynced coding for THIS bill came back. Said out loud rather than
              restored silently: the figures below now include changes JobTread
              doesn't have, and Save is what sends them. */}
          {restored && (
            <Banner tone="info" className="mt-2 !py-1.5 !text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span>
                  Restored {restored.kept} unsaved change{restored.kept === 1 ? "" : "s"} from{" "}
                  {draftSavedAtLabel(restored.savedAt)}
                  {restored.dropped > 0 && <> · {restored.dropped} no longer applied</>}.
                </span>
                <button
                  type="button"
                  onClick={dismissRestored}
                  className="shrink-0 underline underline-offset-2 opacity-80 hover:opacity-100"
                >
                  Dismiss
                </button>
              </div>
            </Banner>
          )}
        </div>
      )}

      <BillCodingCard ctl={ctl} />
    </>
  );
}
