"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  FilterChip,
  Label,
  Loading,
  Meter,
  PageHeader,
  SectionLabel,
  Select,
  StickyActionBar,
  Toggle,
} from "@/components/ui";
import { type Option } from "@/components/CostCodeSelect";
import {
  TimeEntryList,
  TimeRecodeCard,
  useTimeFilters,
  type CodeHeadroom,
} from "@/components/TimeEntryList";
import { LaborReportButton } from "@/components/LaborReportButton";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

/**
 * Labor Review — the time-entry twin of the Tracking Sheets board.
 *
 * THE LIST IN THE MIDDLE IS NOT WRITTEN HERE. It is
 * `src/components/TimeEntryList.tsx`, rendered identically by the board's
 * "Time & labor" panel — the two were hand-written twins that drifted, and each
 * had capabilities the other lacked. This page owns the budget rail, the money,
 * and what a recode WRITES; the list owns filtering, grouping, drawing and
 * selecting the entries.
 *
 * Same premise, same three columns: the decision is "this week of General Labor
 * really belongs to Framing", and you can only make it if the hours and the
 * budget they're eating are on one screen. Cost-code headroom on the left, the
 * month's time entries in the middle, the coding drawer on the right.
 *
 * STAGED, NOT SAVED — identical to the board. Re-pointing an entry updates the
 * left rail's math immediately and writes nothing; JobTread is touched only on
 * Sync. That's what makes "what happens to Framing if I move these?" free.
 *
 * WHAT A RECODE IS. A time entry, like a bill line, derives its cost code from
 * the budget leaf it points at, so `costItemId` is the whole edit. Confirmed
 * live before this page shipped: the entry's cost, minutes, pay type and
 * approval all survive untouched, because a time entry's cost is hours × the
 * PAY TYPE's rate and owes nothing to the cost item. Recoding moves labor
 * between codes at exactly the amount already on the entry.
 *
 * Everything comes from /api/labor-review in one fetch, off the same cached
 * readers Tracking Sheets uses, so the two pages' budgets can't drift apart.
 */

interface TimeEntry {
  id: string;
  employee: string;
  startedAt: string | null;
  /** Clock-out instant (UTC), null on a running entry. Carried for the QB export,
   *  and read by the shared drawer so a bulk approve skips a running entry. */
  endedAt?: string | null;
  hours: number;
  cost: number;
  code: string;
  codeName: string;
  notes: string;
  isApproved: boolean;
  costItemId: string | null;
  type: string;
  /** Assistant-local "flag for review" mark — companion DB, not JobTread. */
  flagged?: boolean;
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
  budget: number;
  bills: number;
  labor: number;
  laborHours: number;
  laborApproved: number;
  laborApprovedHours: number;
}
interface CostDivisionRow {
  division: string;
  name: string;
  codes: CostCodeRow[];
}
interface Payload {
  job: { id: string; name: string; address: string; customer: string } | null;
  timeEntries: TimeEntry[];
  budget: BudgetItem[];
  costDetail: { divisions: CostDivisionRow[]; budgetBasis: string };
  writesEnabled: boolean;
  error?: string;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const hrs = (n: number) => `${n.toFixed(1)}h`;

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

/** Same default month as Tracking Sheets, so the two pages open on the same period. */
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

/** Per-cost-code money for the left rail, after staged recodes. */
interface Headroom {
  code: string;
  name: string;
  division: string;
  budget: number;
  bills: number; // committed vendor bills, all time (reference only here)
  labor: number; // time coded here ± staged moves
  laborHours: number;
  codeable: boolean; // has at least one budget leaf to re-point onto
}
const usedOf = (h: Headroom) => h.bills + h.labor;
const remainingOf = (h: Headroom) => h.budget - usedOf(h);

export function LaborReview() {
  const params = useSearchParams();
  const jobId = params.get("jobId") ?? "";

  const [ym, setYm] = useState(() => params.get("ym") || defaultYm());
  /**
   * Counts only approved entries toward the rail's labor and the list, matching
   * the identically-named toggle on Tracking Sheets. Defaults ON so nothing is
   * hidden until someone deliberately narrows it.
   */
  const [includeUnapproved, setIncludeUnapproved] = useState(true);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** timeEntryId → the budget leaf it's been staged onto. */
  const [staged, setStaged] = useState<Map<string, string>>(new Map());
  /** The entries the coding drawer is acting on. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // ---- filters (cost code / employee(s) / date / grouping) ----------------
  // Owned by the shared list — see useTimeFilters. Held here rather than inside
  // it because this page reads what's on screen for its own figures (the shown
  // total, and the "cost codes in view" card below).
  const [codeQuery, setCodeQuery] = useState("");
  // On a phone the rail stacks above the list, so it starts rolled up — same
  // choice the board makes, for the same reason (land on the work, not the
  // reference). Desktop keeps it docked via the `lg:` overrides.
  const [railCollapsed, setRailCollapsed] = useState(true);

  const dirty = staged.size > 0;
  useUnsavedChanges(
    dirty,
    "You have staged labor recodes that haven't been synced to JobTread. Leave and lose them?",
  );

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    const [y, m] = ym.split("-");
    try {
      const r = await fetch(
        `/api/labor-review?jobId=${encodeURIComponent(jobId)}&year=${y}&month=${Number(m)}`,
        { cache: "no-store" },
      );
      const j = (await r.json()) as Payload;
      if (j.error) setError(j.error);
      else {
        setData(j);
        // A fresh pull invalidates anything staged against the old data.
        setStaged(new Map());
        setSelected(new Set());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [jobId, ym]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- derived ------------------------------------------------------------
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

  /** The leaf an entry currently points at, staged edits winning. */
  const leafOf = useCallback(
    (t: TimeEntry) => staged.get(t.id) ?? t.costItemId ?? "",
    [staged],
  );
  /** The cost code an entry currently sits under, staged edits winning. */
  const codeOf = useCallback(
    (t: TimeEntry) => leafById.get(leafOf(t))?.number ?? t.code,
    [leafOf, leafById],
  );

  /**
   * Coding targets: every LABOR budget leaf on the job, plus any leaf an entry
   * already sits on. JobTread rejects time against a code it doesn't consider
   * time-trackable, and in this budget that tracks the Labor cost type — so
   * leading with Labor leaves keeps the dropdown to targets that will actually
   * take the write, while never hiding a code that demonstrably already holds
   * time.
   */
  const codingOptions: Option[] = useMemo(() => {
    const inUse = new Set(
      (data?.timeEntries ?? []).map((t) => t.costItemId).filter(Boolean) as string[],
    );
    return (data?.budget ?? []).filter(
      (b) => (b.costType ?? "").trim().toLowerCase() === "labor" || inUse.has(b.id),
    );
  }, [data]);

  /** Every entry in the month, narrowed by the approval toggle only. */
  const monthEntries = useMemo(
    () => (data?.timeEntries ?? []).filter((t) => includeUnapproved || t.isApproved),
    [data, includeUnapproved],
  );

  /**
   * The middle column: filtering, grouping and what's on screen — all of it the
   * shared list's, so this page and the board narrow a month of hours the same
   * way. `codeOf` is passed in so a filter matches the code an entry sits under
   * NOW, staged moves included.
   */
  const f = useTimeFilters(monthEntries, { codeOf, resetKey: `${jobId}|${ym}` });
  const entries = f.visible;

  /**
   * Headroom per cost code, with staged recodes applied as transfers.
   *
   * `costDetail.labor` already counts every entry under its ORIGINAL code, so a
   * staged move subtracts there and adds here — exactly how the board treats a
   * committed bill line.
   *
   * NOTE this rail's Remaining deliberately omits DRAFT bills, which Client
   * Invoicing's rail adds on top: drafts live on the bills this page doesn't
   * fetch. A code with open drafts therefore reads slightly roomier here. The
   * footnote under the card says so.
   */
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
          bills: c.bills,
          labor: includeUnapproved ? c.labor : c.laborApproved,
          laborHours: includeUnapproved ? c.laborHours : c.laborApprovedHours,
          codeable: (leavesByCode.get(c.number)?.length ?? 0) > 0,
        });
      }
    }
    // A code that exists only as a budget leaf still needs a row — it's usually
    // the one WITH room, which is exactly what this rail is for.
    for (const [code, leaves] of leavesByCode) {
      if (map.has(code)) continue;
      map.set(code, {
        code,
        name: leaves[0]?.name ?? "",
        division: divisionOf.get(code) ?? "",
        budget: leaves.reduce((s, l) => s + (l.cost ?? 0), 0),
        bills: 0,
        labor: 0,
        laborHours: 0,
        codeable: true,
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
          bills: 0,
          labor: 0,
          laborHours: 0,
          codeable: (leavesByCode.get(code)?.length ?? 0) > 0,
        };
        map.set(code, h);
      }
      return h;
    };

    for (const t of monthEntries) {
      const now = codeOf(t);
      const was = t.code;
      if (now === was) continue;
      if (was) {
        const h = ensure(was);
        h.labor -= t.cost;
        h.laborHours -= t.hours;
      }
      if (now) {
        const h = ensure(now);
        h.labor += t.cost;
        h.laborHours += t.hours;
      }
    }
    return map;
  }, [data, monthEntries, codeOf, leavesByCode, includeUnapproved]);

  /**
   * What a cost code has left, for the chip the shared list draws on every row.
   * This page's answer deliberately omits DRAFT bills — they live on the bills
   * it doesn't fetch — so a code reads slightly roomier here than on Tracking
   * Sheets. The footnote under the rail says so.
   */
  const headroomFor = useCallback(
    (code: string): CodeHeadroom | null => {
      const h = headroom.get(code);
      return h ? { name: h.name, remaining: remainingOf(h) } : null;
    },
    [headroom],
  );

  const railRows = useMemo(() => {
    const q = codeQuery.trim().toLowerCase();
    const rows = [...headroom.values()].filter(
      (h) => h.budget !== 0 || h.bills !== 0 || h.labor !== 0,
    );
    const matched = q ? rows.filter((h) => `${h.code} ${h.name}`.toLowerCase().includes(q)) : rows;
    return matched.sort((a, b) => a.code.localeCompare(b.code));
  }, [headroom, codeQuery]);

  /**
   * Codes carrying labor first, everything else after. On a labor page the
   * codes with hours on them ARE the subject; a rail sorted purely by number
   * buries them among forty material-only codes.
   */
  const railWithLabor = useMemo(() => railRows.filter((h) => h.labor !== 0), [railRows]);
  const railRest = useMemo(() => railRows.filter((h) => h.labor === 0), [railRows]);

  /**
   * The cost codes the CURRENT FILTERS actually touch, with what those filtered
   * hours cost and what's left in each — the left rail narrowed to the question
   * on screen.
   *
   * The rail answers "where is there room on this job"; this answers "where did
   * this crew's week land, and can those codes take it". Two different figures
   * sit side by side deliberately: `inView` is only the labor matching the
   * filters, while `budget`/`remaining` come from the same whole-job headroom
   * the rail uses — narrowing to one employee doesn't shrink a code's budget or
   * un-spend the rest of the crew's hours.
   */
  const codesInView = useMemo(() => {
    const rows = new Map<string, { code: string; name: string; inView: number; hours: number }>();
    for (const t of entries) {
      // `code` stays the REAL value — "" for an uncoded entry, never a display
      // placeholder. The row's click sets the cost-code filter, and "—" would
      // match nothing and silently empty the list.
      const code = codeOf(t);
      const r = rows.get(code) ?? {
        code,
        name: leafById.get(leafOf(t))?.name || t.codeName || (code ? "" : "Uncoded"),
        inView: 0,
        hours: 0,
      };
      r.inView += t.cost;
      r.hours += t.hours;
      rows.set(code, r);
    }
    return [...rows.values()]
      .map((r) => {
        const h = headroom.get(r.code);
        return {
          ...r,
          budget: h?.budget ?? 0,
          used: h ? usedOf(h) : 0,
          remaining: h ? remainingOf(h) : 0,
          known: Boolean(h),
        };
      })
      // Most labor in view first — the code the filtered work actually went to
      // is the one being asked about.
      .sort((a, b) => b.inView - a.inView);
  }, [entries, codeOf, leafOf, leafById, headroom]);

  // ---- selection + staging ------------------------------------------------
  const selectedEntries = useMemo(
    () => entries.filter((t) => selected.has(t.id)),
    [entries, selected],
  );

  /** Stage the selection onto one budget leaf. */
  const stageSelection = (leafId: string) => {
    if (!leafId) return;
    setStaged((prev) => {
      const next = new Map(prev);
      for (const t of selectedEntries) {
        // Re-picking an entry's ORIGINAL leaf is an un-stage, not a change.
        if (t.costItemId === leafId) next.delete(t.id);
        else next.set(t.id, leafId);
      }
      return next;
    });
  };

  const revertAll = () => setStaged(new Map());

  /**
   * "Flag for review" — an Assistant-local mark on one time entry, for the entry
   * you can't resolve on the spot ("is that really 11 hours on demo?"). It is
   * NOT a JobTread write, so it's independent of the write gate and of the
   * staged recodes: flagging never touches Sync, and Sync never clears a flag.
   *
   * Optimistic, and best-effort on the wire — same as the board's Reviewed tag.
   */
  const toggleFlag = async (id: string, flagged: boolean) => {
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
      /* best-effort */
    }
  };

  /**
   * The drawer approved some entries in JobTread — mark them here. Deliberately
   * NOT a reload: load() clears the staged recodes, and approving hours says
   * nothing about where they are coded.
   */
  const markApproved = (ids: string[]) => {
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

  async function sync() {
    if (!dirty) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const changes = [...staged.entries()].map(([id, costItemId]) => ({ id, costItemId }));
      const r = await fetch("/api/labor-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const j = await r.json();
      if (j.error) {
        setSyncMsg({ tone: "error", text: j.error });
      } else if (j.previewed) {
        setSyncMsg({ tone: "error", text: j.message });
      } else {
        const failed = (j.results ?? []).filter((x: { ok: boolean }) => !x.ok);
        if (failed.length > 0) {
          setSyncMsg({
            tone: "error",
            text:
              `${changes.length - failed.length} of ${changes.length} recoded. ` +
              `${failed.length} failed: ${failed[0].error ?? "unknown error"}`,
          });
        } else {
          setSyncMsg({
            tone: "success",
            text: `Recoded ${changes.length} time ${changes.length === 1 ? "entry" : "entries"} in JobTread.`,
          });
        }
        await load(); // re-pull so the rail reflects what JobTread now holds
      }
    } catch (e) {
      setSyncMsg({ tone: "error", text: e instanceof Error ? e.message : "Sync failed" });
    } finally {
      setSyncing(false);
    }
  }

  // ---- render -------------------------------------------------------------
  if (!jobId) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <PageHeader title="Labor Review" />
        <EmptyState>
          No job selected. Pick one above to review its labor, or{" "}
          <Link href="/trackingsheet" className="text-accent underline">
            go to Tracking Sheets
          </Link>
          .
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 lg:max-w-[110rem]">
      <PageHeader
        title="Labor Review"
        description="Move logged time between cost codes against live budget headroom."
        actionsClassName="w-full min-w-0 items-center lg:w-auto"
        actions={
          <div className="flex w-full min-w-0 flex-col gap-3 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
            <div className="min-w-0">
              <Label htmlFor="labor-month" className="lg:hidden">
                Month
              </Label>
              <Select
                id="labor-month"
                value={ym}
                onChange={(e) => setYm(e.target.value)}
                className="!h-11 lg:!h-auto lg:w-52"
                aria-label="Month"
              >
                {monthOptions().map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            {/* One setting, two presentations — a pill on a phone (where the
                toolbar is a stack), the labelled switch on the desktop toolbar
                that has room for words. Same split the board makes. */}
            <div className="lg:hidden">
              <FilterChip
                on={includeUnapproved}
                onClick={() => setIncludeUnapproved(!includeUnapproved)}
                title="Off counts only isApproved entries — in the list and in the rail's labor."
              >
                Unapproved time
              </FilterChip>
            </div>
            <div className="hidden lg:flex lg:items-center">
              <Toggle
                checked={includeUnapproved}
                onChange={setIncludeUnapproved}
                label={
                  <span title="Off counts only isApproved entries — in the list and in the rail's labor.">
                    Include unapproved
                  </span>
                }
                className="shrink-0 text-left"
              />
            </div>
            {dirty && (
              <span className="inline-flex shrink-0 items-center self-start rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {staged.size} staged change{staged.size === 1 ? "" : "s"}
              </span>
            )}
            <div className="hidden items-center gap-2 lg:flex">
              <Button variant="secondary" size="sm" onClick={revertAll} disabled={!dirty || syncing}>
                Revert
              </Button>
              <Button size="sm" onClick={sync} disabled={!dirty || syncing}>
                {syncing ? "Syncing…" : "Sync to JobTread"}
              </Button>
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
      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading && <Loading label="Loading labor…" />}

      {data && !loading && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {/* ─────────── LEFT: budget / cost-code rail ─────────── */}
          <section className="min-w-0 lg:sticky sticky-below-header lg:self-start">
            <div className="mb-2 flex items-baseline justify-between gap-2">
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
                className="h-11 w-full border-b border-line bg-transparent px-3 text-xs outline-none dark:border-white/10 lg:h-auto lg:px-2 lg:py-1.5"
              />
              <div className="max-h-[calc(100dvh-16rem)] overflow-y-auto">
                {railRows.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-neutral-500">No cost codes match.</p>
                ) : (
                  <>
                    <RailGroup
                      title="Carrying labor"
                      rows={railWithLabor}
                      activeCode={f.code}
                      onPick={(code) => f.setCode(f.code === code ? "" : code)}
                    />
                    <RailGroup
                      title="Everything else"
                      rows={railRest}
                      activeCode={f.code}
                      onPick={(code) => f.setCode(f.code === code ? "" : code)}
                    />
                  </>
                )}
              </div>
            </Card>
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              Remaining = budget − committed bills − labor. Tap a code to filter the list to it.
              Draft bills are <b>not</b> counted here (they live on the bills this page doesn&apos;t
              load), so a code with open drafts reads roomier than it does on{" "}
              <Link
                href={`/trackingsheet?jobId=${encodeURIComponent(jobId)}&ym=${ym}`}
                className="text-accent underline"
              >
                Tracking Sheets
              </Link>
              .
            </p>
          </section>

          {/* ─────────── MIDDLE: the month's time entries ─────────── */}
          <section className="min-w-0">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <SectionLabel>
                Time entries ({entries.length}
                {f.on ? ` of ${monthEntries.length}` : ""})
              </SectionLabel>
              <div className="flex min-w-0 items-baseline gap-3">
                <span className="shrink-0 text-xs font-semibold tabular-nums">
                  {hrs(f.shownHours)} · {money(f.shownCost)}
                </span>
                {/* Org-wide, not this job: the report covers EVERY job's time
                    entries for the selected month. The page's job selection
                    only supplies the month. */}
                <LaborReportButton ym={ym} className="items-end text-right" />
              </div>
            </div>

            {/* ---- the cost codes these filters landed on ----
                Styled as the budget card, because it IS one: the same rows,
                bars and remaining figures as the left rail, narrowed to the
                codes the filtered hours actually touched. It sits above the
                entries so the answer to "can these codes take this work" is
                read before scrolling the entries themselves. */}
            {codesInView.length > 0 && (
              <div className="mb-2">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <SectionLabel>
                    Cost codes in view ({codesInView.length})
                  </SectionLabel>
                  <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
                    hours shown · remaining
                  </span>
                </div>
                <Card pad={false} className="overflow-hidden">
                  <ul>
                    {codesInView.map((c) => {
                      const over = c.remaining < 0;
                      const pct = c.budget > 0 ? Math.round((c.remaining / c.budget) * 100) : null;
                      return (
                        <li
                          key={c.code || "uncoded"}
                          className={`border-b border-line-soft last:border-0 dark:border-neutral-800 ${
                            c.code && f.code === c.code
                              ? "bg-accent/10 ring-1 ring-inset ring-accent"
                              : ""
                          }`}
                        >
                          <button
                            type="button"
                            // Uncoded isn't a filterable code — there's nothing
                            // to narrow to, so the row is a readout only.
                            disabled={!c.code}
                            onClick={() => f.setCode(f.code === c.code ? "" : c.code)}
                            title={
                              `${c.code || "Uncoded"} ${c.name}\n` +
                              `${hrs(c.hours)} shown here (${money(c.inView)} of labor)\n` +
                              (c.known
                                ? `${money(c.used)} used of ${money(c.budget)} budget · ${money(c.remaining)} remaining`
                                : "No budget row for this code")
                            }
                            className="w-full px-3 py-2 text-left transition enabled:hover:bg-accent/5 dark:enabled:hover:bg-white/5 lg:px-2"
                          >
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="min-w-0 truncate text-xs">
                                <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                                  {c.code || "uncoded"}
                                </span>{" "}
                                {c.name}
                              </span>
                              <span className="shrink-0 text-xs font-semibold tabular-nums">
                                {hrs(c.hours)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
                              <span>
                                {money0(c.inView)} shown ·{" "}
                                {c.budget > 0 ? `${money0(c.budget)} budget` : "no budget"}
                              </span>
                              <span
                                className={
                                  over ? "font-semibold text-red-600 dark:text-red-400" : ""
                                }
                              >
                                {c.known ? `${money0(c.remaining)} left` : "—"}
                                {pct !== null && <span className="ml-1">({pct}%)</span>}
                              </span>
                            </div>
                            <Meter budget={c.budget} used={c.used} label={c.code} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
                <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  Bold figure is the hours matching your filters. Budget and remaining are the
                  code&apos;s whole-job numbers — narrowing to one employee doesn&apos;t shrink a
                  budget or un-spend the rest of the crew&apos;s hours.
                </p>
              </div>
            )}

            {monthEntries.length === 0 ? (
              <EmptyState>No time logged to this job this month.</EmptyState>
            ) : (
              <Card pad={false} className="overflow-hidden">
                <TimeEntryList
                  filters={f}
                  monthEntries={monthEntries}
                  codeOf={codeOf}
                  headroomFor={headroomFor}
                  isMoved={(t) => staged.has(t.id)}
                  selected={selected}
                  onSelectedChange={setSelected}
                  onFlag={(id, flagged) => void toggleFlag(id, flagged)}
                  emptyFiltered="No entries match these filters."
                />
              </Card>
            )}
          </section>

          {/* ─────────── RIGHT: coding drawer ─────────── */}
          {/* Sticky lives on the SECTION (the grid item) so it has the row's
              full height to travel within — same reasoning as the board's. */}
          <section className="min-w-0 xl:sticky sticky-below-header xl:self-start">
            <SectionLabel className="mb-2">Coding</SectionLabel>
            {selectedEntries.length === 0 ? (
              <EmptyState>Select one or more time entries to recode them.</EmptyState>
            ) : (
              /* The drawer is shared with the board's Time & labor panel for the
                 same reason the list is — this is the other half of "select
                 several entries and move them", and a copy on each page is a
                 copy that drifts. It stages nothing: the leaf comes back here. */
              <TimeRecodeCard
                entries={selectedEntries}
                codeOptions={codingOptions}
                leafOf={leafOf}
                onPick={stageSelection}
                isStaged={(t) => staged.has(t.id)}
                onUndo={(id) =>
                  setStaged((prev) => {
                    const next = new Map(prev);
                    next.delete(id);
                    return next;
                  })
                }
                jtHref={`https://app.jobtread.com/jobs/${jobId}/time`}
                onApproved={markApproved}
                writes={Boolean(data?.writesEnabled)}
              />
            )}
          </section>
        </div>
      )}

      {/* On a phone the commit actions ride the bottom of the screen, near the
          thumb — the toolbar at the top is the one place you are NOT looking
          after tapping through a list of entries. */}
      {dirty && (
        <StickyActionBar className="lg:hidden">
          <Button variant="secondary" size="sm" onClick={revertAll} disabled={syncing}>
            Revert
          </Button>
          <Button size="sm" onClick={sync} disabled={syncing} className="flex-1">
            {syncing ? "Syncing…" : `Sync ${staged.size} to JobTread`}
          </Button>
        </StickyActionBar>
      )}
    </main>
  );
}

/**
 * One labelled block of the cost-code rail. Split into "carrying labor" and
 * "everything else" rather than plain CSI order: on a labor page the codes with
 * hours on them are the subject, and numeric order buries them.
 */
function RailGroup({
  title,
  rows,
  activeCode,
  onPick,
}: {
  title: string;
  rows: Headroom[];
  activeCode: string;
  onPick: (code: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="border-b border-line bg-neutral-50/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-white/[0.04] dark:text-neutral-400 lg:px-2">
        {title} ({rows.length})
      </div>
      <ul>
        {rows.map((h) => {
          const left = remainingOf(h);
          const over = left < 0;
          const pct = h.budget > 0 ? Math.round((left / h.budget) * 100) : null;
          return (
            <li
              key={h.code}
              className={`border-b border-line-soft transition dark:border-neutral-800 ${
                activeCode === h.code ? "bg-accent/10 ring-1 ring-inset ring-accent" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => onPick(h.code)}
                title={
                  `${h.code} ${h.name}\n` +
                  `${money(h.bills)} bills + ${money(h.labor)} labor (${hrs(h.laborHours)})` +
                  ` of ${money(h.budget)} budget\n${money(left)} remaining` +
                  (pct !== null ? ` (${pct}% of budget)` : "") +
                  (h.codeable ? "" : "\nNo budget line — can't code time to this")
                }
                className="w-full px-3 py-2 text-left transition hover:opacity-70 lg:px-2 lg:py-1"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-xs">
                    <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                      {h.code}
                    </span>{" "}
                    <span className={h.codeable ? "" : "text-neutral-500 dark:text-neutral-400"}>
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
                {h.labor !== 0 && (
                  <div className="text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
                    {hrs(h.laborHours)} · {money0(h.labor)} labor
                  </div>
                )}
                <Meter budget={h.budget} used={usedOf(h)} label={h.code} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
