"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { descriptionForCode, round2, type BillMath, type LineEdit } from "@/lib/billLineMath";
import { buildCombine, type CombineRequest } from "@/lib/combineLines";
import type { BillRef, BoardPayload, JobBillLine } from "./Board";
import { postSplitBill } from "@/lib/splitBillClient";
import type { LineOps } from "./useLineOps";

/**
 * The open bill's LINE actions on the Tracking Sheets board: Apply a code to
 * every line (staged), Combine lines that share a code (staged, applied by
 * Save after the line writes), and the three that write at once — delete a
 * line (/api/delete-line), add a line (/api/add-line) and buy a line back onto
 * the Shop bill (/api/buyback).
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01) with
 * the owner's ok for the write paths; the code is the board's, unchanged.
 */
export function useLineEdits({
  data,
  edits,
  leafOf,
  load,
  openBill,
  openDocId,
  openLines,
  openMath,
  openTaxView,
  setCombinePending,
  setEdits,
  setStaged,
  setSyncMsg,
  lineOps,
}: {
  /** The staged structural edits — delete, add, buyback, void (useLineOps.ts). */
  lineOps: LineOps;
  data: BoardPayload | null;
  edits: Record<string, LineEdit | undefined>;
  leafOf: (l: JobBillLine) => string;
  load: (opts?: { preserveStaged?: boolean; }) => Promise<void>;
  openBill: BillRef | null;
  openDocId: string | null;
  openLines: JobBillLine[];
  openMath: BillMath;
  openTaxView: number;
  setCombinePending: Dispatch<SetStateAction<CombineRequest | null>>;
  setEdits: Dispatch<SetStateAction<Record<string, LineEdit | undefined>>>;
  setStaged: Dispatch<SetStateAction<Map<string, string>>>;
  setSyncMsg: Dispatch<SetStateAction<{ tone: "success" | "error"; text: string; } | null>>;
}) {
  // ---- coding-drawer bulk actions: Apply to all + Combine ------------------
  // Ported from the bill page (/bill/[docId]) — same rules, adapted to this
  // page's staged-not-saved model.
  const [bulkCode, setBulkCode] = useState("");
  const [combineSelected, setCombineSelected] = useState<string[]>([]);
  const [combining, setCombining] = useState(false);
  const [combineMsg, setCombineMsg] = useState("");
  const [buybackId, setBuybackId] = useState("");
  const [addingLine, setAddingLine] = useState(false);
  const [newLine, setNewLine] = useState({ name: "", quantity: "1", unitCost: "0", code: "" });
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [addLineMsg, setAddLineMsg] = useState("");
  const [deletingLineId, setDeletingLineId] = useState("");
  const [deleteLineMsg, setDeleteLineMsg] = useState("");

  // All reset when the open bill changes — they're about the CURRENT bill's
  // lines, and stale selections/forms from a previous bill would silently
  // apply to the wrong one. taxEdits is NOT reset here: like edits/staged, a
  // tax edit stays pending across bills until Sync or Revert.
  useEffect(() => {
    setBulkCode("");
    setCombineSelected([]);
    setCombineMsg("");
    setAddingLine(false);
    setNewLine({ name: "", quantity: "1", unitCost: "0", code: "" });
    setAddLineMsg("");
    setDeleteLineMsg("");
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
    [openLines, setStaged, setSyncMsg],
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
    return Boolean(
      e && (e.name !== undefined || e.quantity !== undefined || e.unitCost !== undefined),
    );
  });
  const canCombine = combineSelected.length >= 2 && combineCodeSet.size === 1 && !combineHasEdit;

  const toggleCombineSel = (id: string) =>
    setCombineSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // Combine WRITES immediately (unlike a recode) — it's a structural line
  // merge (delete + sum), not a "which code" decision worth trying on and
  // reverting, and the bill page's combine has always worked this way.
  /**
   * STAGE the merge. It used to POST straight to /api/combine-lines, which made
   * it the one edit in the coding card that Revert could not take back. It is
   * held here now and applied by sync() AFTER the line writes — combining
   * deletes lines, so running it first would leave those writes naming ids that
   * no longer exist.
   */
  const combineRows = () => {
    const sel = combineSelected
      .map((id) => combineById.get(id))
      .filter((l): l is JobBillLine => !!l);
    if (!openBill) return;
    const req = buildCombine(openBill.id, sel, leafOf, (leafId) =>
      descriptionForCode(leafId, data?.budget ?? []),
    );
    if (!req) return;
    setCombineMsg("");
    setCombinePending(req);
    setCombineSelected([]);
  };

  /** Drop the staged merge. Revert clears it too, with everything else. */
  const cancelCombine = () => {
    setCombinePending(null);
    setCombineMsg("");
  };

  // Delete a single line from the open bill — STAGED (one save rule, Phase 6):
  // the tap marks the row, a second tap unmarks it, and Save Changes writes
  // /api/delete-line with the rest (useLineOps.ts).
  const deleteLineById = (id: string, label: string) => {
    if (!openBill) return;
    lineOps.toggleDelete(id, openBill.id, label);
    setCombineSelected((s) => s.filter((x) => x !== id));
    setSyncMsg(null);
  };

  // Add a new line to the open bill — STAGED. Unit $ is entered PRE-TAX
  // (matching the line editor); grossed up against the bill's CURRENT
  // previewed subtotal/tax so it lands consistent with what is on screen,
  // including an unsynced tax edit. Save Changes writes /api/add-line.
  const addLine = () => {
    const name = newLine.name.trim();
    if (!name || !openBill) return;
    const qty = Number(newLine.quantity) || 0;
    const preTaxUnit = Number(newLine.unitCost) || 0;
    const newSumPreTax = openMath.subtotal + preTaxUnit * qty;
    const reTaxAdd = newSumPreTax > 0 ? (newSumPreTax + openTaxView) / newSumPreTax : 1;
    lineOps.stageAdd({
      docId: openBill.id,
      name,
      quantity: qty,
      preTaxUnit,
      unitCost: round2(preTaxUnit * reTaxAdd),
      jobCostItemId: newLine.code || undefined,
      description: descriptionForCode(newLine.code, data?.budget ?? []),
    });
    setAddingLine(false);
    setNewLine({ name: "", quantity: "1", unitCost: "0", code: "" });
    setAddLineMsg("");
    setSyncMsg(null);
  };

  // Buyback WRITES immediately (unlike a recode) — like Combine, it's a
  // structural change (the line moves onto a DIFFERENT bill entirely, not just
  // a different code on this one), not a "which code" decision worth trying on
  // and reverting. Mirrors the bill page's buyback (/bill/[docId]) — see
  // buybackLine in lib/jobtread.ts for how repeat clicks against the SAME
  // source bill land on the SAME Ascent - Shop bill instead of minting a new
  // one each time.
  // STAGED (one save rule): the row is marked "→ Shop on save" and Save
  // Changes writes /api/buyback — see buybackLine in lib/jobtread.ts for how
  // repeat buybacks against the SAME source bill land on the SAME Shop bill.
  const buybackLineById = async (l: JobBillLine, name: string, extended: number) => {
    const codeId = leafOf(l);
    lineOps.stageBuyback({
      lineId: l.id,
      docId: l.docId,
      name,
      unitCost: round2(extended),
      description: codeId ? descriptionForCode(codeId, data?.budget ?? []) : undefined,
    });
    setSyncMsg(null);
  };

  /** Split a bill (the coding card's ✂ Split bill) — see /api/split-bill. */
  const splitBill = async (docId: string, lineIds: string[]) => {
    setSyncMsg(null);
    const r = await postSplitBill(docId, lineIds);
    setSyncMsg({ tone: r.ok ? "success" : "error", text: r.text });
    if (r.ok) await load({ preserveStaged: true });
  };

  return {
    addLine,
    addLineMsg,
    addLineSaving,
    addingLine,
    anyCombinable,
    applyCodeToAll,
    bulkCode,
    buybackId,
    buybackLineById,
    splitBill,
    canCombine,
    cancelCombine,
    combineCodeSet,
    combineHasEdit,
    combineMsg,
    combineRows,
    combineSelected,
    combining,
    deleteLineById,
    deleteLineMsg,
    deletingLineId,
    isCombinable,
    newLine,
    setAddLineMsg,
    setAddingLine,
    setBulkCode,
    setCombineMsg,
    setCombining,
    setNewLine,
    toggleCombineSel,
  };
}
