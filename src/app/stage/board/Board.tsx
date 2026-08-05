"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
 * Everything the board reads comes from /api/stage/board in one fetch.
 */

interface BillRef {
  id: string;
  label: string;
  vendor: string;
  cost: number;
  status: string;
  issueDate: string | null;
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
  droppable: boolean; // has at least one budget leaf to code to
}

const remainingOf = (h: Headroom) => h.budget - h.spent - h.drafts;

/** Budget-usage meter. Amber past 90%, red past 100% — the whole point of the rail. */
function Meter({ h }: { h: Headroom }) {
  const used = h.spent + h.drafts;
  const pct = h.budget > 0 ? used / h.budget : used > 0 ? 1 : 0;
  const over = h.budget > 0 && used > h.budget;
  const near = !over && pct >= 0.9;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${h.code} budget used`}
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

export function Board() {
  const params = useSearchParams();
  const jobId = params.get("jobId") ?? "";

  const [ym, setYm] = useState(() => params.get("ym") || defaultYm());
  const [includeDrafts, setIncludeDrafts] = useState(true);
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** costItemId → the budget leaf it's been staged onto. */
  const [staged, setStaged] = useState<Map<string, string>>(new Map());
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [mode, setMode] = useState<"bill" | "code">("bill");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [codeQuery, setCodeQuery] = useState("");

  const dirty = staged.size > 0;
  useUnsavedChanges(
    dirty,
    "You have staged coding changes that haven't been synced to JobTread. Leave and lose them?",
  );

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    const [y, m] = ym.split("-");
    try {
      const r = await fetch(
        `/api/stage/board?jobId=${encodeURIComponent(jobId)}&year=${y}&month=${Number(m)}` +
          `&includeDrafts=${includeDrafts ? "1" : "0"}`,
      );
      const j = (await r.json()) as BoardPayload;
      if (j.error) setError(j.error);
      else {
        setData(j);
        setStaged(new Map()); // a fresh pull invalidates staged moves
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [jobId, ym, includeDrafts]);

  useEffect(() => {
    load();
  }, [load]);

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
    const rows = [...headroom.values()].filter(
      (h) => h.budget !== 0 || h.spent !== 0 || h.drafts !== 0,
    );
    const matched = q
      ? rows.filter((h) => `${h.code} ${h.name}`.toLowerCase().includes(q))
      : rows;
    return matched.sort((a, b) => a.code.localeCompare(b.code));
  }, [headroom, codeQuery]);

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

  const openBill = data?.bills.find((b) => b.id === openDocId) ?? null;
  const openLines = openDocId ? (linesByDoc.get(openDocId) ?? []) : [];

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
        const stacks = [...lanes.entries()]
          .map(([docId, ls]) => ({
            key: `${code}/${docId}`,
            docId,
            lines: ls,
            cost: ls.reduce((s, l) => s + l.cost, 0),
            label: billById.get(docId)?.vendor ?? ls[0]?.name ?? "Bill",
            status: billById.get(docId)?.status ?? ls[0]?.billStatus ?? "",
          }))
          .sort((a, b) => b.cost - a.cost);
        return {
          code,
          h: headroom.get(code),
          stacks,
          total: stacks.reduce((s, x) => s + x.cost, 0),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [data, codeOf, headroom]);

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

  const revertAll = () => {
    setStaged(new Map());
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
    if (!data || staged.size === 0) return;
    setSyncing(true);
    setSyncMsg(null);

    // One POST per bill: /api/code takes changes[] plus a single docId for its
    // "saved" marker, so batching per bill keeps that marker correct and needs
    // no change to that route.
    const byDoc = new Map<string, { costItemId: string; jobCostItemId: string }[]>();
    for (const [lineId, leafId] of staged) {
      const line = data.lines.find((l) => l.id === lineId);
      if (!line) continue;
      const arr = byDoc.get(line.docId) ?? [];
      arr.push({ costItemId: lineId, jobCostItemId: leafId });
      byDoc.set(line.docId, arr);
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
        <PageHeader title="Recode" />
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
        title="Recode"
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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
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
          <Toggle
            checked={includeDrafts}
            onChange={setIncludeDrafts}
            label="Include drafts"
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

      {data && !loading && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[24rem_minmax(0,1fr)_26rem]">
          {/* ─────────── LEFT: cost-code reference rail ─────────── */}
          <section className="min-w-0">
            <SectionLabel className="mb-2">Cost codes · budget remaining</SectionLabel>
            <Card pad={false} className="overflow-hidden">
              <input
                type="search"
                value={codeQuery}
                onChange={(e) => setCodeQuery(e.target.value)}
                placeholder="Filter cost codes…"
                className="w-full border-b border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none dark:border-white/10"
              />
              <div className="max-h-[70vh] overflow-y-auto">
                {railRows.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-neutral-500">No cost codes match.</p>
                ) : (
                  <ul>
                    {railRows.map((h) => {
                      const left = remainingOf(h);
                      const over = left < 0;
                      return (
                        <li
                          key={h.code}
                          {...dropHandlers(h.code, h.droppable)}
                          className={`border-b border-neutral-100 px-3 py-2 transition last:border-0 dark:border-neutral-800 ${
                            dragOverCode === h.code
                              ? "bg-accent/10 ring-1 ring-inset ring-accent"
                              : dragLineIds && !h.droppable
                                ? "opacity-40"
                                : ""
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0">
                              <span className="font-mono text-xs text-neutral-500">{h.code}</span>{" "}
                              <span className="text-sm">{h.name}</span>
                            </span>
                            <span
                              className={`shrink-0 text-sm font-semibold tabular-nums ${
                                over ? "text-red-600 dark:text-red-400" : ""
                              }`}
                            >
                              {money0(left)}
                            </span>
                          </div>
                          <div className="mt-1">
                            <Meter h={h} />
                          </div>
                          <div className="mt-1 flex justify-between text-[11px] text-neutral-400">
                            <span>
                              {money0(h.spent)}
                              {h.drafts > 0 && ` + ${money0(h.drafts)} draft`} of {money0(h.budget)}
                            </span>
                            {!h.droppable && <span title="No budget line to code to">no target</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
              Remaining = budget − committed − this month&apos;s drafts. Committed is approved and
              pending bills across all time; drafts aren&apos;t committed spend yet, so they&apos;re
              counted separately.
            </p>
          </section>

          {/* ─────────── CENTRE: the month's bills ─────────── */}
          <section className="min-w-0">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <SectionLabel>
                {data.bills.length} bill{data.bills.length === 1 ? "" : "s"} ·{" "}
                {money(data.billTotal)}
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

            {/* ---- grouped by cost code: the drag surface ---- */}
            {mode === "code" &&
              (laneRows.length === 0 ? (
                <EmptyState>No coded lines in this month.</EmptyState>
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
                        <div className="flex items-baseline justify-between gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
                          <span className="min-w-0 truncate">
                            <span className="font-mono text-xs text-neutral-500">{code}</span>{" "}
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
                        </ul>
                      </Card>
                    </li>
                  ))}
                </ul>
              ))}

            {mode === "bill" && data.bills.length === 0 ? (
              <EmptyState>No uninvoiced bills dated in this month.</EmptyState>
            ) : mode === "bill" ? (
              <ul className="space-y-2">
                {data.bills.map((b) => {
                  const lines = linesByDoc.get(b.id) ?? [];
                  const codes = new Map<string, number>();
                  let movedHere = 0;
                  for (const l of lines) {
                    const c = codeOf(l);
                    codes.set(c, (codes.get(c) ?? 0) + l.cost);
                    if (staged.has(l.id)) movedHere++;
                  }
                  const isOpen = openDocId === b.id;
                  return (
                    <li key={b.id}>
                      <Card
                        pad={false}
                        draggable={lines.length > 0}
                        onDragStart={beginDrag(lines.map((l) => l.id))}
                        onDragEnd={endDrag}
                        className={`${isOpen ? "ring-1 ring-accent" : ""} ${
                          lines.length > 0 ? "cursor-grab active:cursor-grabbing" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setOpenDocId(isOpen ? null : b.id)}
                          aria-expanded={isOpen}
                          className="w-full p-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
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
                                    <span className="font-mono">{code || "uncoded"}</span>
                                    <span className="tabular-nums">{money0(amt)}</span>
                                    <span className="opacity-60">·</span>
                                    <span className="tabular-nums">{money0(left)} left</span>
                                  </span>
                                );
                              })}
                          </span>
                        </button>
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
              <Card className="sticky top-4">
                <p className="truncate text-sm font-semibold">{openBill.label}</p>
                <p className="mb-3 text-xs text-neutral-500">
                  {money(openBill.cost)} · {openLines.length} line
                  {openLines.length === 1 ? "" : "s"}
                  {openBill.status ? ` · ${openBill.status}` : ""}
                </p>
                <ul className="space-y-3">
                  {openLines.map((l) => {
                    const current = leafOf(l);
                    const moved = staged.has(l.id);
                    const code = codeOf(l);
                    const h = headroom.get(code);
                    return (
                      <li
                        key={l.id}
                        className="border-t border-neutral-100 pt-3 first:border-0 first:pt-0 dark:border-neutral-800"
                      >
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-xs">
                            {l.name || "(unnamed line)"}
                          </span>
                          <span className="shrink-0 text-xs font-semibold tabular-nums">
                            {money(l.cost)}
                          </span>
                        </div>
                        <CostCodeSelect
                          options={codeOptions}
                          value={current}
                          onChange={(leafId) => stageLine(l.id, leafId, l.jobCostItemId)}
                        />
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
