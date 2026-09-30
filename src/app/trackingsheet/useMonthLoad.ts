"use client";

import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { LineEdit } from "@/lib/billLineMath";
import type { TimeEntryEdit } from "@/lib/codingDraft";
import type { BoardPayload } from "./Board";

type Setter<T> = Dispatch<SetStateAction<T>>;

/**
 * The Tracking Sheets board's MONTH LOAD — one read of /api/trackingsheet for
 * the job and month, then what a load does to staged work: a fresh pull drops
 * all of it; `preserveStaged` (after a combine or an entry save) keeps every
 * staged change whose line, bill or entry still exists. Runs once per job and
 * month, and again after each write.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * code is the board's, unchanged. The board still owns the data and the
 * staged maps — this receives their setters by name.
 */
export function useMonthLoad({
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
}: {
  jobId: string;
  ym: string;
  shownKey: MutableRefObject<string>;
  setLoading: Setter<boolean>;
  setRefreshing: Setter<boolean>;
  setError: Setter<string>;
  setData: Setter<BoardPayload | null>;
  setStaged: Setter<Map<string, string>>;
  setEdits: Setter<Record<string, LineEdit | undefined>>;
  setTaxEdits: Setter<Record<string, string>>;
  setTypeEdits: Setter<Record<string, "Bill" | "Expense">>;
  setTimeStaged: Setter<Map<string, string>>;
  setTimeEdits: Setter<Record<string, TimeEntryEdit>>;
  setTimeSelected: Setter<Set<string>>;
}) {
  const load = useCallback(
    async (opts?: { preserveStaged?: boolean }) => {
      if (!jobId) return;
      const key = `${jobId}|${ym}`;
      const firstPull = shownKey.current !== key;
      if (firstPull) setLoading(true);
      else setRefreshing(true);
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
          shownKey.current = key;
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
            setTypeEdits((prev) => {
              const next = { ...prev };
              for (const id of Object.keys(next)) if (!liveDocIds.has(id)) delete next[id];
              return next;
            });
            setTimeEdits((prev) => {
              const next = { ...prev };
              for (const id of Object.keys(next)) if (!liveTimeIds.has(id)) delete next[id];
              return next;
            });
          } else {
            // A fresh pull (month/filter change, or after Sync) invalidates
            // everything staged against the old data.
            //
            // timeEdits BELONGS IN THIS LIST and was missing from it, which is
            // what made a saved entry correction look unsaved: Save wrote it,
            // load() cleared every other staged map, and the correction alone
            // came back — leaving the board dirty, the row marked, and the
            // autosave re-writing the draft that had just been discarded.
            setStaged(new Map());
            setTimeStaged(new Map());
            setTimeEdits({});
            setTimeSelected(new Set());
            setEdits({});
            setTaxEdits({});
            setTypeEdits({});
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // Every setter and the ref are stable, so `load` still changes only with
    // the job and the month — which is what re-fires the effect below.
    [
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
      setTimeEdits,
      setTimeSelected,
      setTimeStaged,
    ],
  );

  useEffect(() => {
    load();
  }, [load]);

  return load;
}
