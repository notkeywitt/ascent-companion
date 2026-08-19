"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JtLink } from "@/components/JtLink";
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
  recodeLog,
  round2,
  type BillMath,
  type LineEdit,
} from "@/lib/billLineMath";
import { markBillTouched } from "@/lib/billTouch";

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
 * complete) rather than `/api/recode`.
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
  nonRecoverableTaxName?: string;
}

interface FileNode {
  id: string;
  name?: string;
  type?: string;
  url?: string;
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
  files?: FileNode[];
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

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const money0 = (n: number) =>
  (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");

const isImage = (f: FileNode) =>
  /^image\//i.test(f.type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");

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
  files: FileNode[];
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
  taxView: number;
  taxChanged: boolean;
  taxName: string;
  math: BillMath;
  /** Lines differing from JobTread, plus the tax if it's been retyped. */
  changeCount: number;
  saving: boolean;
  saveMsg: string;
  save: () => Promise<void>;
  /** Cost-code number → pre-tax dollars THIS bill currently puts on it. */
  pendingByCode: Map<string, number>;
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
    // Edits belong to the bill they were typed on.
    setPicked({});
    setEdits({});
    setTaxEdit(null);
    setSaveMsg("");
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
  const writes = Boolean(payload?.writesEnabled);

  const storedTax = header?.nonRecoverableTax ?? 0;
  const taxName = header?.nonRecoverableTaxName || "Tax";
  const taxView = taxEdit !== null && taxEdit !== "" ? Number(taxEdit) || 0 : storedTax;
  const taxChanged = taxEdit !== null && round2(taxView) !== round2(storedTax);

  const math = useMemo(
    () =>
      billLineMath({
        lines: lines.map((l) => ({ ...l, jobCostItemId: l.jobCostItem?.id ?? null })),
        storedTax,
        taxView,
        status: header?.status,
        edits,
        picked,
        budget,
      }),
    [lines, storedTax, taxView, header?.status, edits, picked, budget],
  );

  const changeCount = math.pendingCount + (taxChanged ? 1 : 0);

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
    if (math.wholeBillChanges.length === 0 && !taxChanged) {
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
      if (taxChanged) {
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
  }, [docId, jobId, math, taxChanged, taxView, lines, picked, budget, fetchInto]);

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
    taxView,
    taxChanged,
    taxName,
    math,
    changeCount,
    saving,
    saveMsg,
    save,
    pendingByCode,
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
      const e = g.get(dc) ?? { code: dc, name: r.division, rows: [] };
      if (!e.name && r.division) e.name = r.division;
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
            the job in Client Invoicing for the full picture.
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
 * The bill on the right, editable in place: description, quantity, unit cost,
 * cost code, and the document-level sales tax. Nothing is written until Save.
 */
export function DraftCodingPanel({
  editor,
  sel,
  position,
  count,
  onPrev,
  onNext,
}: {
  editor: BillEditor;
  sel: Selection | null;
  /** 1-based place in the visible queue, for the ‹ n / total › readout. */
  position: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
}) {
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
    taxView,
    taxName,
    math,
    changeCount,
    saving,
    saveMsg,
    save,
  } = editor;
  const [bulkCode, setBulkCode] = useState("");

  // A new bill starts with an empty bulk picker — the last bill's code has no
  // bearing on this one.
  useEffect(() => setBulkCode(""), [sel?.docId]);

  const linesEditable = math.isDraft;

  const applyCodeToAll = (codeId: string) => {
    if (!codeId) return;
    setPicked((p) => {
      const next = { ...p };
      for (const l of lines) next[l.id] = codeId;
      return next;
    });
  };

  const stepBtn =
    "inline-flex min-h-8 items-center rounded-lg border border-line px-2 text-xs font-semibold transition hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-inherit";

  const lineInputCls =
    "h-9 rounded-lg border border-line-strong bg-white px-2 text-xs transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-ink";

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <SectionLabel>Coding</SectionLabel>
        {count > 1 && sel && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className={stepBtn} onClick={onPrev} disabled={position <= 1}>
              ‹ Prev
            </button>
            <span className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
              {position} / {count}
            </span>
            <button
              type="button"
              className={stepBtn}
              onClick={onNext}
              disabled={position >= count}
            >
              Next ›
            </button>
          </div>
        )}
      </div>

      {!sel ? (
        <EmptyState>Pick a bill from the list to code it here.</EmptyState>
      ) : (
        <>
          <Card className="max-h-[calc(100dvh-13rem)] overflow-y-auto">
            {error && <Banner tone="error">{error}</Banner>}
            {loading && !header && <Loading label="Loading bill…" />}

            {header && (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold">{sel.label}</p>
                  <JtLink
                    href={`https://app.jobtread.com/jobs/${sel.jobId}/documents/${sel.docId}`}
                    className="shrink-0 text-xs font-semibold text-neutral-400 transition hover:text-accent"
                  >
                    JT ↗
                  </JtLink>
                </div>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {sel.jobName}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                      {money(math.total)} · {lines.length} line{lines.length === 1 ? "" : "s"}
                    </span>
                    <BillStatusBadge status={header.status} />
                  </div>
                  <Button
                    variant={reviewed ? "primary" : "secondary"}
                    size="sm"
                    className="shrink-0 !px-2 !py-1 !text-[11px]"
                    onClick={toggleReviewed}
                  >
                    {reviewed ? "✓ Reviewed" : "Mark reviewed"}
                  </Button>
                </div>

                {/* Everything structural lives on the full bill page — this
                    panel deliberately carries only the edits you make on every
                    bill, so the column stays scannable. */}
                <Link
                  href={`/bill/${sel.docId}?jobId=${encodeURIComponent(sel.jobId)}&from=drafts`}
                  className="mt-1 inline-block text-[11px] font-semibold text-accent transition hover:opacity-70 dark:text-accent-soft"
                >
                  Full bill page ↗ — add or delete lines, combine, approve, re-file
                </Link>

                {!linesEditable && (
                  <Banner tone="info" className="mt-2 !py-1.5 !text-[11px]">
                    JobTread locks descriptions and amounts once a bill leaves draft. Re-coding
                    still works.
                  </Banner>
                )}

                {linesEditable && writes && budget.length > 0 && lines.length > 1 && (
                  <div className="mt-3 rounded-lg border border-dashed border-line-strong bg-neutral-50 p-2 dark:bg-ink-raised/60">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                      Apply one code to all {lines.length} lines
                    </span>
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <CostCodeSelect
                          options={budget}
                          value={bulkCode}
                          onChange={setBulkCode}
                        />
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

                <ul className="mt-3 space-y-3">
                  {lines.map((l, i) => {
                    const current = picked[l.id] ?? l.jobCostItem?.id ?? "";
                    const nameVal = edits[l.id]?.name ?? (l.name ?? "");
                    const qtyVal =
                      edits[l.id]?.quantity ?? (l.quantity != null ? String(l.quantity) : "");
                    const t = math.targets[i];
                    const unitVal =
                      edits[l.id]?.unitCost ??
                      (l.unitCost != null ? String(round2(math.deTax(l.unitCost))) : "");
                    const extended = t ? round2(t.qty * t.preTaxUnit) : math.deTax(l.cost ?? 0);
                    const setEdit = (patch: LineEdit) =>
                      setEdits((p) => ({ ...p, [l.id]: { ...p[l.id], ...patch } }));
                    const codeNum = budget.find((o) => o.id === current)?.number;
                    const c = codeNum ? ctc[codeNum] : undefined;
                    return (
                      <li
                        key={l.id}
                        className="border-t border-line-soft pt-3 first:border-0 first:pt-0"
                      >
                        {linesEditable ? (
                          <input
                            type="text"
                            value={nameVal}
                            onChange={(e) => setEdit({ name: e.target.value })}
                            placeholder="Description"
                            aria-label="Line description"
                            className={`${lineInputCls} w-full font-medium`}
                          />
                        ) : (
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate text-xs font-medium">
                              {l.name || "(unnamed line)"}
                            </span>
                          </div>
                        )}

                        <div className="mt-1.5 flex items-end gap-1.5">
                          <div className="shrink-0">
                            <Label htmlFor={`dq-qty-${l.id}`}>Qty</Label>
                            <input
                              id={`dq-qty-${l.id}`}
                              type="number"
                              inputMode="decimal"
                              value={qtyVal}
                              disabled={!linesEditable}
                              onChange={(e) => setEdit({ quantity: e.target.value })}
                              className={`${lineInputCls} w-16 text-right tabular-nums`}
                            />
                          </div>
                          <span
                            aria-hidden
                            className="pb-2 text-neutral-500 dark:text-neutral-400"
                          >
                            ×
                          </span>
                          <div className="shrink-0">
                            <Label htmlFor={`dq-unit-${l.id}`}>Unit $</Label>
                            <input
                              id={`dq-unit-${l.id}`}
                              type="number"
                              inputMode="decimal"
                              value={unitVal}
                              disabled={!linesEditable}
                              onChange={(e) => setEdit({ unitCost: e.target.value })}
                              className={`${lineInputCls} w-24 text-right tabular-nums`}
                            />
                          </div>
                          <p className="min-w-0 flex-1 pb-1.5 text-right text-sm font-semibold tabular-nums">
                            {money(extended)}
                          </p>
                        </div>

                        <div className="mt-1.5">
                          <CostCodeSelect
                            options={budget}
                            value={current}
                            onChange={(id) => setPicked((p) => ({ ...p, [l.id]: id }))}
                          />
                          {c && (
                            <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[10.5px]">
                              <span className="text-neutral-500 dark:text-neutral-400">
                                Budget remaining
                              </span>
                              <span
                                className={
                                  "font-semibold tabular-nums " +
                                  (c.remaining < 0 ? "text-red-600 dark:text-red-400" : "")
                                }
                              >
                                {money(c.remaining)}
                              </span>
                              <span className="text-neutral-500 dark:text-neutral-400">
                                (budget {money(c.budget)} − actual {money(c.actual)})
                              </span>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {lines.length === 0 && !loading && (
                    <li>
                      <EmptyState>This bill has no lines.</EmptyState>
                    </li>
                  )}
                </ul>

                {/* Subtotal → tax → total, where a paper invoice puts them. */}
                <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-neutral-500 dark:text-neutral-400">Subtotal</dt>
                    <dd className="tabular-nums">{money(math.subtotal)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-neutral-500 dark:text-neutral-400">{taxName}</dt>
                    <dd>
                      {linesEditable && writes ? (
                        <div className="relative">
                          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                            $
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={taxEdit ?? String(storedTax)}
                            onChange={(e) => setTaxEdit(e.target.value)}
                            aria-label="Sales tax"
                            className={`${lineInputCls} w-24 pl-4 text-right tabular-nums`}
                          />
                        </div>
                      ) : (
                        <span className="tabular-nums">{money(taxView)}</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t border-line pt-1.5">
                    <dt className="font-semibold">Total</dt>
                    <dd className="text-base font-bold tabular-nums">{money(math.total)}</dd>
                  </div>
                </dl>

                {/* The scan, small. Coding a bill means reading it, and clicking
                    through to the full page to do that is exactly the trip this
                    layout exists to avoid. */}
                {files.length > 0 && (
                  <div className="mt-3 border-t border-line pt-3">
                    <SectionLabel className="mb-1.5">Invoice</SectionLabel>
                    <div className="space-y-2">
                      {files.map((f) =>
                        f.url && isImage(f) ? (
                          <a
                            key={f.id}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open full size"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={f.url}
                              alt={f.name ?? "invoice"}
                              className="max-h-[40dvh] w-full rounded-lg border border-line object-contain"
                            />
                          </a>
                        ) : f.url ? (
                          <a
                            key={f.id}
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-[11px] font-semibold text-accent dark:text-accent-soft"
                          >
                            Open {f.name || "attachment"} ↗
                          </a>
                        ) : (
                          <span key={f.id} className="text-[11px] text-neutral-500">
                            {f.name}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Save sits OUTSIDE the scrolling card, so it's on screen no matter
              how far down a long bill you are. */}
          {header && (
            <div className="mt-2">
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
            </div>
          )}
        </>
      )}
    </>
  );
}
