"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Chip, FilterChip, IconButton, Label, Select } from "@/components/ui";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JtLink } from "@/components/JtLink";
import { orgDay } from "@/lib/orgTime";
import {
  CUSTOM_RANGE,
  UNCODED,
  WEEK,
  addDays,
  dayLabel,
  rangeOfSelection,
  shortDay,
  weekStart,
} from "@/lib/timeEntryDates";

/**
 * THE MONTH'S TIME ENTRIES — one list, rendered by both surfaces that show it.
 *
 * Labor Review (`/labor-review`) and the Tracking Sheets board's "Time & labor"
 * panel are the same list of the same entries against the same budget, and they
 * were two hand-written ones. They drifted exactly the way BillCodingCard's two
 * callers did before that was consolidated: Labor Review grew multi-select,
 * bulk recode, the flag mark and a budget-left chip on every row; the board grew
 * a week/date picker, group-by and a per-entry editor. Neither ever got the
 * other's work, and the office met a different list depending on which door it
 * came through.
 *
 * So the list is HERE, once, and both pages render it. Everything either of
 * them had, both of them now have.
 *
 * WHAT'S SHARED AND WHAT ISN'T. This owns the entries: filtering them, grouping
 * them, drawing them, and the selection the page acts on. It owns no decisions
 * about MONEY — `codeOf` and `headroomFor` are supplied, because the two pages
 * legitimately disagree about what a code has left (the board counts draft
 * bills in headroom; Labor Review doesn't load them), and that disagreement is
 * documented on each page rather than papered over here.
 *
 * WHAT A RECODE IS is likewise the caller's business: this component stages
 * nothing and writes nothing. It reports what's selected and what's flagged.
 */

/** One time entry, in the shape both pages already hold. */
export interface TimeEntryRow {
  id: string;
  employee: string;
  startedAt: string | null;
  hours: number;
  cost: number;
  /** The code JobTread has the entry on — its ORIGINAL, before any staged move. */
  code: string;
  codeName: string;
  notes: string;
  isApproved: boolean;
  costItemId: string | null;
  type: string;
  /** Assistant-local "flag for review" mark — companion DB, not JobTread. */
  flagged?: boolean;
}

/** What a cost code has left, after the caller's staged moves. */
export interface CodeHeadroom {
  name: string;
  remaining: number;
}

// Date helpers live in a pure module so the unit suite can reach them — see
// src/lib/timeEntryDates.ts. Re-exported here because this component is the one
// entry point its callers know.
export {
  CUSTOM_RANGE,
  UNCODED,
  WEEK,
  addDays,
  dayLabel,
  rangeOfSelection,
  shortDay,
  weekStart,
} from "@/lib/timeEntryDates";

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const hrs = (n: number) => `${n.toFixed(1)}h`;

/** The day an entry belongs to, read in the ORG's zone — never sliced off the
 *  ISO string, which would push an afternoon entry onto the next day. */
const dayOfEntry = (t: TimeEntryRow) => orgDay(t.startedAt);

// ---------------------------------------------------------------------------
// THE FILTER STATE — a hook, so the PAGE can read what's on screen
// ---------------------------------------------------------------------------

export type GroupBy = "none" | "date" | "employee" | "code";

export interface TimeFilters {
  employees: Set<string>;
  code: string;
  /** "" = every day · a "YYYY-MM-DD" · a `W:` week · CUSTOM_RANGE. */
  day: string;
  from: string;
  to: string;
  groupBy: GroupBy;
  setEmployees: (next: Set<string>) => void;
  toggleEmployee: (name: string) => void;
  setCode: (v: string) => void;
  pickDate: (v: string) => void;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  setGroupBy: (v: GroupBy) => void;
  clear: () => void;
  /** True when anything is narrowing the list. */
  on: boolean;
  /** The entries these filters leave. */
  visible: TimeEntryRow[];
  /** …in their groups, each with its own hours and dollars. */
  groups: { key: string; label: string; entries: TimeEntryRow[]; cost: number; hours: number }[];
  shownCost: number;
  shownHours: number;
  /** Every name, code, day and week the month actually contains. */
  present: {
    employees: string[];
    codes: { number: string; name: string }[];
    days: { day: string; count: number }[];
    weeks: { from: string; to: string; count: number }[];
  };
  range: { from: string; to: string } | null;
  rangeOn: boolean;
}

/**
 * Filtering and grouping for a month of time entries.
 *
 * Lives in the PAGE rather than inside the list, because the page needs what's
 * on screen for its own figures — Labor Review's "cost codes in view" card and
 * both pages' shown-total lines are computed from it.
 *
 * `codeOf` is the caller's, so a filter matches the code an entry sits under
 * NOW (a staged move included) rather than the one JobTread still has.
 *
 * `resetKey` is the job-and-month: a filter held over from another one names
 * people, codes and days that aren't there, so the <select> shows a blank and
 * the list reads empty for no visible reason.
 */
export function useTimeFilters(
  entries: TimeEntryRow[],
  opts: { codeOf?: (t: TimeEntryRow) => string; resetKey?: string } = {},
): TimeFilters {
  const codeOf = opts.codeOf ?? ((t: TimeEntryRow) => t.code);
  const resetKey = opts.resetKey ?? "";

  /**
   * Employees to show. EMPTY MEANS EVERYONE — reviewing a crew is the normal
   * case ("Bret and Ty on siding last week"), and a single-select made that two
   * passes over the month with no way to see them side by side.
   */
  const [employees, setEmployees] = useState<Set<string>>(new Set());
  const [code, setCode] = useState("");
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  const clear = useCallback(() => {
    setEmployees(new Set());
    setCode("");
    setDay("");
    setFrom("");
    setTo("");
  }, []);

  useEffect(() => {
    clear();
  }, [resetKey, clear]);

  const toggleEmployee = useCallback((name: string) => {
    setEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  /**
   * Picking a week FILLS the from/to boxes rather than hiding behind them: the
   * range is then visible, and nudging either end turns the same selection into
   * a custom one instead of making you start again.
   */
  const pickDate = useCallback(
    (value: string) => {
      setDay(value);
      const r = rangeOfSelection(value, from, to);
      if (value.startsWith(WEEK) && r) {
        setFrom(r.from);
        setTo(r.to);
      } else if (value !== CUSTOM_RANGE) {
        setFrom("");
        setTo("");
      }
    },
    [from, to],
  );

  const present = useMemo(() => {
    const names = new Set<string>();
    const codes = new Map<string, string>();
    const days = new Map<string, number>();
    const weeks = new Map<string, number>();
    for (const t of entries) {
      names.add(t.employee);
      const c = codeOf(t);
      if (!codes.has(c)) codes.set(c, t.codeName);
      const d = dayOfEntry(t);
      if (d) {
        days.set(d, (days.get(d) ?? 0) + 1);
        weeks.set(weekStart(d), (weeks.get(weekStart(d)) ?? 0) + 1);
      }
    }
    return {
      employees: [...names].sort((a, b) => a.localeCompare(b)),
      codes: [...codes.entries()]
        .map(([number, name]) => ({ number, name }))
        .sort((a, b) => a.number.localeCompare(b.number)),
      // Newest first — a correction is nearly always about a recent day.
      days: [...days.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => b.day.localeCompare(a.day)),
      weeks: [...weeks.entries()]
        .map(([f, count]) => ({ from: f, to: addDays(f, 6), count }))
        .sort((a, b) => b.from.localeCompare(a.from)),
    };
    // codeOf is a fresh closure each render; entries is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const range = rangeOfSelection(day, from, to);
  const rangeOn = Boolean(range && (range.from || range.to));

  /**
   * `codeOf` is deliberately NOT a dependency of this or of `groups` below.
   *
   * It changes on every staged recode, and re-filtering there would make rows
   * vanish out from under you the moment you moved them — while filtered to one
   * code, recoding a week would empty the list and take the Undo with it. So
   * the arrangement holds until the data reloads or you touch a filter, and
   * each row says where it is going (the chip) and where it came from (the
   * struck-through code) instead.
   */
  const visible = useMemo(
    () =>
      entries.filter((t) => {
        // "" is a real value here — an uncoded entry — so the filter can't use
        // it as its own "no filter". UNCODED is the sentinel that lets both
        // live in one <select>.
        if (code && codeOf(t) !== (code === UNCODED ? "" : code)) return false;
        if (employees.size > 0 && !employees.has(t.employee)) return false;
        const d = dayOfEntry(t);
        const r = rangeOfSelection(day, from, to);
        if (r) {
          // Either end may be blank — "everything since" / "everything up to".
          if (r.from && d < r.from) return false;
          if (r.to && d > r.to) return false;
        } else if (day && d !== day) {
          return false;
        }
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, code, employees, day, from, to],
  );

  const groups = useMemo(() => {
    const key = (t: TimeEntryRow) => {
      if (groupBy === "date") return dayOfEntry(t) || "No date";
      if (groupBy === "employee") return t.employee || "Unknown";
      if (groupBy === "code") {
        const c = codeOf(t);
        return c ? `${c} ${t.codeName}`.trim() : "Uncoded";
      }
      return ""; // "none" is one unnamed group, so the markup never forks
    };
    const map = new Map<string, TimeEntryRow[]>();
    for (const t of visible) {
      const k = key(t);
      const list = map.get(k);
      if (list) list.push(t);
      else map.set(k, [t]);
    }
    const out = [...map.entries()].map(([k, list]) => ({
      key: k,
      // A day sorts as "2026-08-11" and reads as "Tue Aug 11" — so the heading
      // is formatted for the eye while the key it sorts on stays the ISO one.
      label: groupBy === "date" && k !== "No date" ? dayLabel(k) : k,
      entries: list,
      cost: list.reduce((s, t) => s + t.cost, 0),
      hours: list.reduce((s, t) => s + t.hours, 0),
    }));
    // Days newest first (the list's own order); people and codes alphabetically,
    // which is how you scan for one.
    if (groupBy === "date") out.sort((a, b) => b.key.localeCompare(a.key));
    else if (groupBy !== "none") out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, groupBy]);

  return {
    employees,
    code,
    day,
    from,
    to,
    groupBy,
    setEmployees,
    toggleEmployee,
    setCode,
    pickDate,
    setFrom,
    setTo,
    setGroupBy,
    clear,
    on: Boolean(code || employees.size > 0 || (day && !range) || rangeOn),
    visible,
    groups,
    shownCost: visible.reduce((s, t) => s + t.cost, 0),
    shownHours: visible.reduce((s, t) => s + t.hours, 0),
    present,
    range,
    rangeOn,
  };
}

// ---------------------------------------------------------------------------
// THE FILTER STRIP
// ---------------------------------------------------------------------------

/**
 * Filter, then group.
 *
 * THREE INDEPENDENT SELECTIONS, ANDed: an employee (or several), a cost code, a
 * date. Each is how somebody actually asks for this — "what did Miguel do
 * Tuesday", "who's charging 06 10 00", "the week of the 10th" — and the answers
 * only get useful when they combine. Grouping sits in the same strip because
 * it's the same axes at a different strength: "show me Tuesday" and "break it
 * down by day" are one thought.
 *
 * Always on screen rather than folded behind a Filter button: on a job with a
 * month of crew hours, narrowing is the FIRST thing you do, and a control you
 * have to find first isn't one you use. Every option is drawn from what the
 * month actually contains, so no combination lands on an empty list by accident.
 */
export function TimeFilterStrip({
  filters,
  className = "",
}: {
  filters: TimeFilters;
  className?: string;
}) {
  const f = filters;
  return (
    <div className={`border-t border-line-soft bg-neutral-50 px-3 py-2 dark:bg-ink-raised/50 ${className}`}>
      {/* Employees are a MULTI-select: chips rather than a <select multiple>,
          which on a phone is a scroll-trap and on desktop needs a modifier key
          nobody discovers. Each name toggles; none picked means everyone, so
          the filter starts wide. */}
      {f.present.employees.length > 0 && (
        <fieldset className="mb-2">
          <legend className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Employees{f.employees.size > 0 ? ` (${f.employees.size})` : ""}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              on={f.employees.size === 0}
              onClick={() => f.setEmployees(new Set())}
              title="Show every employee's time"
            >
              Everyone
            </FilterChip>
            {f.present.employees.map((e) => (
              <FilterChip key={e} on={f.employees.has(e)} onClick={() => f.toggleEmployee(e)}>
                {e}
              </FilterChip>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="tl-code">Cost code</Label>
          <Select
            id="tl-code"
            value={f.code}
            onChange={(e) => f.setCode(e.target.value)}
            className="!py-1 !text-xs"
          >
            <option value="">All codes</option>
            {f.present.codes.map((c) => (
              <option key={c.number || UNCODED} value={c.number || UNCODED}>
                {c.number ? `${c.number} ${c.name}` : "Uncoded"}
              </option>
            ))}
          </Select>
        </div>
        {/* One control, two shapes of answer — a span of days or a single one —
            because "when" is one question, and splitting it across two controls
            makes you decide which you're using before you can answer it.

            RANGES FIRST, Custom range at the top of them: the wider the answer,
            the earlier it sits, so the list reads from "a span I'll name" down
            through the weeks to one day. */}
        <div className="min-w-[11rem] flex-1">
          <Label htmlFor="tl-day">Date</Label>
          <Select
            id="tl-day"
            value={f.day}
            onChange={(e) => f.pickDate(e.target.value)}
            className="!py-1 !text-xs"
          >
            <option value="">All dates</option>
            <optgroup label="A range">
              <option value={CUSTOM_RANGE}>Custom range…</option>
              {f.present.weeks.map((w) => (
                <option key={w.from} value={`${WEEK}${w.from}:${w.to}`}>
                  Week of {shortDay(w.from)} – {shortDay(w.to)} · {w.count}
                </option>
              ))}
            </optgroup>
            {f.present.days.length > 0 && (
              <optgroup label="One day">
                {f.present.days.map((d) => (
                  <option key={d.day} value={d.day}>
                    {dayLabel(d.day)} · {d.count}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        {/* Also offered while a Custom range sits empty: the boxes are on screen
            by then, so a way out of them has to be too. */}
        {(f.on || f.day) && (
          <Button variant="secondary" size="sm" onClick={f.clear}>
            Clear
          </Button>
        )}
      </div>

      {/* The two ends of the range, shown for a picked week as well as a custom
          one — so the week you chose is legible as dates, and nudging either end
          just makes it custom rather than sending you back to the select. */}
      {f.range && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="tl-from">From</Label>
            <input
              id="tl-from"
              type="date"
              value={f.from}
              onChange={(e) => {
                f.pickDate(CUSTOM_RANGE);
                f.setFrom(e.target.value);
              }}
              className="rounded-md border border-line-strong bg-white px-2 py-1 text-xs dark:bg-ink-raised"
            />
          </div>
          <div>
            <Label htmlFor="tl-to">To</Label>
            <input
              id="tl-to"
              type="date"
              value={f.to}
              onChange={(e) => {
                f.pickDate(CUSTOM_RANGE);
                f.setTo(e.target.value);
              }}
              className="rounded-md border border-line-strong bg-white px-2 py-1 text-xs dark:bg-ink-raised"
            />
          </div>
          {/* A backwards range matches nothing and looks like a bug in the list
              rather than in the dates. */}
          {f.from && f.to && f.from > f.to ? (
            <p className="pb-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              From is after To — nothing can match.
            </p>
          ) : (
            <p className="pb-1 text-[11px] text-neutral-400">
              Leave either end empty for &ldquo;everything since&rdquo; or &ldquo;everything up
              to&rdquo;.
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-neutral-400">Group</span>
        <div className="flex rounded-md bg-neutral-100 p-0.5 text-[11px] dark:bg-white/5">
          {(
            [
              ["none", "None"],
              ["date", "Date"],
              ["employee", "Employee"],
              ["code", "Cost code"],
            ] as const
          ).map(([g, label]) => (
            <button
              key={g}
              type="button"
              onClick={() => f.setGroupBy(g)}
              aria-pressed={f.groupBy === g}
              className={`inline-flex min-h-9 items-center rounded px-2 transition lg:min-h-0 lg:py-1 ${
                f.groupBy === g
                  ? "bg-accent text-accent-fg font-semibold"
                  : "text-neutral-500 hover:text-accent dark:text-neutral-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE ROWS
// ---------------------------------------------------------------------------

export interface TimeEntryListProps {
  filters: TimeFilters;
  /** Every entry in the month, for the "12 of 87" line. */
  monthEntries: TimeEntryRow[];
  /** The cost code an entry sits under NOW — a staged move winning. */
  codeOf: (t: TimeEntryRow) => string;
  /** What that code has left after staged moves, or null when it has no budget row. */
  headroomFor: (code: string) => CodeHeadroom | null;
  /** True when the entry has been staged onto a different code than JobTread has. */
  isMoved: (t: TimeEntryRow) => boolean;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Given → each row carries the review flag. */
  onFlag?: (id: string, flagged: boolean) => void;
  /**
   * Given → each row carries an Edit button, for the surfaces that can open ONE
   * entry (hours, day, job). Selection is what both pages share; this is an
   * extra affordance where the host supports it, not a different row.
   */
  onEdit?: (id: string) => void;
  editingId?: string | null;
  /** Shown when the month has entries but the filters leave none. */
  emptyFiltered?: React.ReactNode;
}

export function TimeEntryList({
  filters,
  monthEntries,
  codeOf,
  headroomFor,
  isMoved,
  selected,
  onSelectedChange,
  onFlag,
  onEdit,
  editingId,
  emptyFiltered,
}: TimeEntryListProps) {
  const f = filters;
  const visible = f.visible;

  const allShownSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };
  const toggleAllShown = () => {
    const next = new Set(selected);
    if (allShownSelected) for (const t of visible) next.delete(t.id);
    else for (const t of visible) next.add(t.id);
    onSelectedChange(next);
  };

  return (
    <>
      <TimeFilterStrip filters={f} />

      {/* What's on screen when that isn't the whole month, and what narrowed it,
          in words. A range especially: "12 of 87 shown" reads as a mistake until
          you can see it means Aug 10 – Aug 16. */}
      {f.on && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-t border-line-soft px-3 py-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className="min-w-0">
            {visible.length} of {monthEntries.length} shown · {hrs(f.shownHours)}
            {(() => {
              const bits: string[] = [];
              if (f.employees.size > 0) bits.push([...f.employees].join(", "));
              if (f.code) bits.push(f.code === UNCODED ? "uncoded" : f.code);
              if (f.rangeOn && f.range) {
                bits.push(
                  f.range.from && f.range.to
                    ? `${shortDay(f.range.from)} – ${shortDay(f.range.to)}`
                    : f.range.from
                      ? `from ${shortDay(f.range.from)}`
                      : `up to ${shortDay(f.range.to)}`,
                );
              } else if (f.day && !f.range) {
                bits.push(dayLabel(f.day));
              }
              return bits.length > 0 ? ` · ${bits.join(" · ")}` : "";
            })()}
          </span>
          <span className="font-semibold tabular-nums">{money(f.shownCost)}</span>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="border-t border-line-soft px-3 py-3 text-xs text-neutral-500">
          {emptyFiltered ?? "No time entries match those filters."}
        </p>
      ) : (
        <>
          {/* Select-all, and what's selected — the header of a list you ACT on. */}
          <div className="flex items-center justify-between gap-2 border-t border-line-soft px-3 py-2">
            <label className="flex min-w-0 items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={allShownSelected}
                onChange={toggleAllShown}
                className="h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="truncate">
                {selected.size > 0 ? `${selected.size} selected` : "Select all shown"}
              </span>
            </label>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => onSelectedChange(new Set())}
                className="shrink-0 text-[11px] font-semibold text-accent"
              >
                Clear
              </button>
            )}
          </div>

          {f.groups.map((g) => (
            <div key={g.key || "all"}>
              {f.groupBy !== "none" && (
                <div className="flex items-baseline justify-between gap-2 border-t border-line-soft bg-neutral-50 px-3 py-1.5 text-[11px] font-semibold dark:bg-ink-raised/50">
                  <span className="min-w-0 truncate">{g.label}</span>
                  <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                    {hrs(g.hours)} · {money(g.cost)}
                  </span>
                </div>
              )}
              <ul className="border-t border-line-soft">
                {g.entries.map((t) => {
                  const moved = isMoved(t);
                  const nowCode = codeOf(t);
                  // Headroom on the code this entry currently sits under —
                  // staged moves included, so the chip reacts as you recode.
                  const head = headroomFor(nowCode);
                  const over = Boolean(head) && (head as CodeHeadroom).remaining < 0;
                  return (
                    <li
                      key={t.id}
                      className={`border-b border-line-soft text-xs last:border-0 ${
                        moved ? "bg-amber-50/60 dark:bg-amber-950/20" : ""
                      } ${editingId === t.id ? "bg-accent/10" : ""}`}
                    >
                      <div className="flex items-start">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 px-3 py-2 transition hover:bg-accent/5 dark:hover:bg-white/5">
                          <input
                            type="checkbox"
                            checked={selected.has(t.id)}
                            onChange={() => toggleOne(t.id)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                          />
                          <span className="min-w-0 flex-1">
                            {/* HOURS is the display figure on a labor list — the
                                question being reviewed is "how long did this
                                take", and the dollars are that number times a
                                pay rate nobody is editing here. Cost keeps its
                                place on the detail line below. */}
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="min-w-0 truncate text-[13px] font-semibold">
                                {t.employee}
                              </span>
                              <span className="shrink-0 text-sm font-semibold tabular-nums">
                                {hrs(t.hours)}
                              </span>
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                              <span>
                                {dayLabel(dayOfEntry(t))} · {money(t.cost)}
                                {t.type ? ` · ${t.type}` : ""}
                              </span>
                              <Chip
                                tone={t.isApproved ? "success" : "warning"}
                                title={
                                  t.isApproved
                                    ? "This time entry is approved in JobTread"
                                    : "This time entry is not yet approved in JobTread"
                                }
                              >
                                {t.isApproved ? "approved" : "unapproved"}
                              </Chip>
                            </span>
                            {/* The code chip, in the same shape a bill card
                                carries: code · what this charges it · what's
                                left there. Reads red once the code is over.
                                A staged entry shows it for the code it would
                                move TO, with the old one struck through. */}
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span
                                className={`inline-flex items-baseline gap-1.5 rounded-md px-2 py-1 ${
                                  over
                                    ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                                    : "bg-neutral-100 text-neutral-600 dark:bg-white/10 dark:text-neutral-300"
                                }`}
                                title={`${head?.name ?? ""} — ${
                                  head ? money(head.remaining) : "no budget row"
                                } remaining`}
                              >
                                <span className="tabular-nums">{nowCode || "uncoded"}</span>
                                <span className="tabular-nums">{money0(t.cost)}</span>
                                <span className="opacity-60">·</span>
                                <span className="tabular-nums">
                                  {head ? `${money0(head.remaining)} left` : "no budget"}
                                </span>
                              </span>
                              {moved && (
                                <span className="truncate text-neutral-500 dark:text-neutral-400">
                                  moved from{" "}
                                  <span className="line-through">{t.code || "uncoded"}</span>
                                </span>
                              )}
                            </span>
                            {/* The note is what the crew actually typed about
                                the hours — the most useful line on the entry, so
                                it wraps in full rather than truncating. */}
                            {t.notes && (
                              <span className="mt-0.5 block whitespace-pre-line text-[11px] italic leading-snug text-neutral-500 dark:text-neutral-400">
                                {t.notes}
                              </span>
                            )}
                          </span>
                        </label>
                        {/* Outside the label on purpose — nested in it, every tap
                            on these would also toggle the row's checkbox. Small
                            glyphs, full 44px targets (IconButton). */}
                        {onEdit && (
                          <IconButton
                            label="Edit this entry"
                            title="Edit this entry's hours, day, code or job"
                            aria-pressed={editingId === t.id}
                            onClick={() => onEdit(t.id)}
                            className="mt-1"
                          >
                            <span
                              aria-hidden
                              className={`text-sm ${
                                editingId === t.id ? "text-accent" : "opacity-50"
                              }`}
                            >
                              ✎
                            </span>
                          </IconButton>
                        )}
                        {onFlag && (
                          <IconButton
                            label={t.flagged ? "Remove review flag" : "Flag for review"}
                            title={
                              t.flagged
                                ? "Flagged for review — tap to clear. Saved in the Assistant, not JobTread."
                                : "Flag this entry for review. Saved in the Assistant, not JobTread."
                            }
                            aria-pressed={Boolean(t.flagged)}
                            onClick={() => onFlag(t.id, !t.flagged)}
                            className="mt-1"
                          >
                            <span
                              aria-hidden
                              className={`text-sm ${
                                t.flagged ? "text-amber-600 dark:text-amber-400" : "opacity-50"
                              }`}
                            >
                              ⚑
                            </span>
                          </IconButton>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// THE RECODE DRAWER — what the selection is FOR
// ---------------------------------------------------------------------------

/**
 * Recode the selected time entries onto one budget leaf.
 *
 * Shared for the same reason the list is: this is the other half of "select
 * several entries and move them", and a copy on each page is a copy that
 * drifts. It stages nothing itself — `onPick` hands the leaf back to the page,
 * which owns the staging and the Sync that writes it.
 *
 * A time entry, like a bill line, derives its cost code from the budget leaf it
 * points at, so `costItemId` is the whole edit. Confirmed live: the entry's
 * cost, minutes, pay type and approval all survive untouched, because a time
 * entry's cost is hours × the PAY TYPE's rate and owes nothing to the cost item.
 */
export function TimeRecodeCard({
  entries,
  codeOptions,
  leafOf,
  onPick,
  isStaged,
  onUndo,
  jtHref,
}: {
  entries: TimeEntryRow[];
  /** The legal targets — LABOR leaves, plus any leaf an entry already sits on. */
  codeOptions: Option[];
  /** The leaf an entry points at, staged moves winning. */
  leafOf: (t: TimeEntryRow) => string;
  onPick: (leafId: string) => void;
  isStaged: (t: TimeEntryRow) => boolean;
  onUndo: (id: string) => void;
  /** The job's time tab in JobTread, for the ↗ link. */
  jtHref?: string;
}) {
  const staged = entries.filter(isStaged);
  return (
    <Card className="max-h-[calc(100vh-5rem)] overflow-y-auto">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </p>
        {jtHref && (
          <JtLink
            href={jtHref}
            className="shrink-0 text-xs font-semibold text-neutral-400 transition hover:text-accent"
          >
            JT ↗
          </JtLink>
        )}
      </div>
      <p className="mb-3 text-xs text-neutral-500">
        {hrs(entries.reduce((s, t) => s + t.hours, 0))} ·{" "}
        {money(entries.reduce((s, t) => s + t.cost, 0))}
      </p>

      <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
        Code {entries.length === 1 ? "this entry" : "all selected"} to
      </span>
      <CostCodeSelect
        options={codeOptions}
        value={
          // One shared value only when every selected entry agrees — otherwise
          // the box would claim a code most of them aren't on.
          entries.length > 0 && entries.every((t) => leafOf(t) === leafOf(entries[0]))
            ? leafOf(entries[0])
            : ""
        }
        onChange={onPick}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        Only cost codes with a budget line are targets. Recoding moves the hours and their cost to
        another code — it never changes the amount, the pay type, or approval. Nothing is written
        until you Sync.
      </p>

      {staged.length > 0 && (
        <div className="mt-3 border-t border-line-soft pt-3">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
            Staged
          </span>
          <ul className="space-y-1">
            {staged.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate">
                  {t.employee} · {dayLabel(dayOfEntry(t))}
                </span>
                <button
                  type="button"
                  onClick={() => onUndo(t.id)}
                  className="shrink-0 font-semibold text-accent"
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
