"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTimeFilters, type TimeEntryRow } from "@/components/TimeEntryList";
import type { TimeEntryEdit } from "@/lib/codingDraft";
import { laborOptions } from "./TimeCodingCard";
import type { BudgetItem } from "./Board";

/**
 * The Tracking Sheets board's TIME CODING — every piece of state and every
 * handler for the month's labor: the open entry, the selection, staged
 * recodes and corrections, flags and approvals.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01). The
 * code is the board's, unchanged; Board destructures the same names, so its
 * JSX did not move. What stays in the board is what joins labor to the rest:
 * the budget rail (which reads `timeCodeOf`), the dirty check, the draft
 * autosave and Save (which read and clear `timeStaged` / `timeEdits`).
 *
 * `onStaged` is the board's "a change was staged" hook (it clears the last
 * Save message), so staging here behaves exactly as it did inline.
 */
export function useTimeCoding<D extends { timeEntries: TimeEntryRow[]; budget: BudgetItem[] }>({
  data,
  setData,
  jobId,
  ym,
  leafById,
  onStaged,
}: {
  data: D | null;
  setData: Dispatch<SetStateAction<D | null>>;
  jobId: string;
  ym: string;
  leafById: Map<string, BudgetItem>;
  onStaged: () => void;
}) {
  // The "Labor" block in the bills list starts collapsed to a single
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
  /**
   * timeEntryId → its staged correction (hours, day, pay type). The entry
   * panel's twin of `edits` on the bill side: it stages instead of writing, so
   * fixing three entries and recoding a month of bills is ONE Save. The cost
   * code is deliberately NOT in here — it rides `timeStaged` above wherever it
   * was picked, so an entry can never carry two different codes.
   */
  const [timeEdits, setTimeEdits] = useState<Record<string, TimeEntryEdit>>({});

  /** Every time entry a Save would touch, recodes and corrections together —
   *  counted once each, because an entry moved AND re-timed is one entry. */
  const timeTouched = useMemo(
    () => new Set([...timeStaged.keys(), ...Object.keys(timeEdits)]),
    [timeStaged, timeEdits],
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

  // Every time entry counts toward the month's labor, approved or not — each
  // row is tagged with its own approval state so nothing is hidden. The rail's
  // labor figure counts the same set, so the two always agree.
  // Typed as the board's own entry (MonthTimeEntry), not the shared row, so the
  // single-entry editor keeps its clock fields.
  const monthTime = useMemo<D["timeEntries"][number][]>(() => data?.timeEntries ?? [], [data]);
  const monthTimeTotal = useMemo(() => monthTime.reduce((s, t) => s + t.cost, 0), [monthTime]);
  /** The same set's hours, shown beside the money on the card's title line —
   *  "what did labor cost" and "how much labor was it" are one question. */
  const monthTimeHours = useMemo(() => monthTime.reduce((s, t) => s + t.hours, 0), [monthTime]);

  /* ---------------- Labor ------------------------------------------------
     The list, its filters and its grouping are src/components/TimeEntryList —
     the SAME component Labor Review renders, so a month of hours is narrowed,
     grouped, selected and read identically wherever you meet it. What lives
     here is what this page does with it: the budget it measures against, the
     staged recodes, and the single-entry editor the Edit button opens. */

  const timeFilters = useTimeFilters(monthTime, {
    codeOf: timeCodeOf,
    resetKey: `${jobId}|${ym}`,
    // By cost code, and every group shut: on this page the question is which
    // codes the month's hours landed on and whether they fit the budget, not
    // who worked when. Labor Review asks the other question and stays flat.
    defaultGroupBy: "code",
  });


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
    onStaged();
  };

  /**
   * Stage one entry's correction from the panel. The cost code goes into the
   * board's labor lane so the rail, the rings and the drawer all move with it;
   * the rest is the patch a Save sends to /api/time-entry. An EMPTY patch is
   * the panel's Revert — it clears both lanes for that entry.
   */
  const stageTimeEdit = (id: string, patch: TimeEntryEdit & { costItemId?: string }) => {
    const { costItemId, ...rest } = patch;
    setTimeStaged((prev) => {
      const next = new Map(prev);
      if (costItemId) next.set(id, costItemId);
      else next.delete(id);
      return next;
    });
    setTimeEdits((prev) => {
      const next = { ...prev };
      if (Object.keys(rest).length > 0) next[id] = rest;
      else delete next[id];
      return next;
    });
  };

  /**
   * Re-rate the whole selection — the recode's twin, staged the same way. An
   * empty pick, or the entry's own JobTread type, un-stages it rather than
   * staging a write that changes nothing.
   */
  const stageTimeType = (type: string) => {
    setTimeEdits((prev) => {
      const next = { ...prev };
      for (const t of monthTime) {
        if (!timeSelected.has(t.id)) continue;
        if (type && type !== t.type) {
          next[t.id] = { ...next[t.id], type };
        } else {
          const rest = { ...next[t.id] };
          delete rest.type;
          if (Object.keys(rest).length > 0) next[t.id] = rest;
          else delete next[t.id];
        }
      }
      return next;
    });
    onStaged();
  };

  /** The pay type an entry reads as now, a staged re-rate winning. */
  const timeTypeOf = useCallback(
    (t: { id: string; type: string }) => timeEdits[t.id]?.type ?? t.type,
    [timeEdits],
  );

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
    () =>
      laborOptions(
        data?.budget ?? [],
        (data?.timeEntries ?? []).map((t) => t.costItemId),
      ),
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

  return {
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
  };
}
