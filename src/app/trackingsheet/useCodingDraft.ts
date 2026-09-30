"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { LineEdit } from "@/lib/billLineMath";
import { monthLabel } from "@/lib/billingMonths";
import {
  discardDraft,
  jobDraftKey,
  loadDraft,
  reconcileDraft,
  saveDraft,
  type TimeEntryEdit,
} from "@/lib/codingDraft";
import type { BoardPayload } from "./Board";

/**
 * Staged coding on the Tracking Sheets board, kept as a DRAFT: saved on every
 * change (this device's storage, and the companion DB on a debounce), offered
 * back when the office returns to the job and month, and reconciled against
 * what JobTread now holds. Nothing here writes to JobTread — Save does that.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * code is the board's, unchanged. The board keeps `draftKey`, `setRestoreMsg`
 * and the two refs because Revert and Save discard or re-arm the draft.
 */
export function useCodingDraft({
  jobId,
  ym,
  loading,
  data,
  staged,
  setStaged,
  edits,
  setEdits,
  taxEdits,
  setTaxEdits,
  timeStaged,
  setTimeStaged,
  timeEdits,
  setTimeEdits,
}: {
  jobId: string;
  ym: string;
  loading: boolean;
  data: BoardPayload | null;
  staged: Map<string, string>;
  setStaged: Dispatch<SetStateAction<Map<string, string>>>;
  edits: Record<string, LineEdit | undefined>;
  setEdits: Dispatch<SetStateAction<Record<string, LineEdit | undefined>>>;
  taxEdits: Record<string, string>;
  setTaxEdits: Dispatch<SetStateAction<Record<string, string>>>;
  timeStaged: Map<string, string>;
  setTimeStaged: Dispatch<SetStateAction<Map<string, string>>>;
  timeEdits: Record<string, TimeEntryEdit>;
  setTimeEdits: Dispatch<SetStateAction<Record<string, TimeEntryEdit>>>;
}) {
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
        setTimeEdits((prev) => (Object.keys(prev).length > 0 ? prev : (r.timeEdits ?? {})));
        setRestoreMsg({ kept: r.kept, dropped: r.dropped, savedAt: draft.savedAt });
      } finally {
        // Whatever came of it, this scope is now the browser's to save.
        if (alive) autosaveArmedRef.current = draftKey;
      }
    })();
    return () => {
      alive = false;
    };
  }, [draftKey, loading, data, setEdits, setStaged, setTaxEdits, setTimeEdits, setTimeStaged]);

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
        timeEdits,
      },
      `${data?.job?.name || "This job"} · ${monthLabel(ym)}`,
    );
  }, [draftKey, staged, edits, taxEdits, timeStaged, timeEdits, data?.job?.name, ym]);

  return { draftKey, restoreMsg, setRestoreMsg, restoreStartedRef, autosaveArmedRef };
}
