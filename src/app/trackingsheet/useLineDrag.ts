"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { BoardPayload, BudgetItem } from "./Board";

/**
 * Drag and drop on the Tracking Sheets board: drag a line chip (or a bill
 * chip, which carries all its lines) onto a cost code to stage a recode onto
 * that code's budget leaf. Staged only; Save writes it. A code with several
 * distinguishable leaves opens a picker instead of guessing.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * code is the board's, unchanged.
 */
export function useLineDrag({
  data,
  leavesByCode,
  setStaged,
  setSyncMsg,
}: {
  data: BoardPayload | null;
  leavesByCode: Map<string, BudgetItem[]>;
  setStaged: Dispatch<SetStateAction<Map<string, string>>>;
  setSyncMsg: Dispatch<SetStateAction<{ tone: "success" | "error"; text: string; } | null>>;
}) {
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
    [data, setStaged, setSyncMsg],
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
              dragLineIds ??
              (e.dataTransfer.getData("text/plain") || "").split(",").filter(Boolean);
            if (ids.length) dropOnCode(code, ids);
            endDrag();
          },
        }
      : {};

  return {
    beginDrag,
    dragLineIds,
    dragOverCode,
    dropHandlers,
    endDrag,
    leafPicker,
    moveLinesToLeaf,
    setLeafPicker,
  };
}
