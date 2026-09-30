"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { descriptionForCode, round2, type BillMath, type LineEdit } from "@/lib/billLineMath";
import { buildCombine, type CombineRequest } from "@/lib/combineLines";
import type { BillRef, BoardPayload, JobBillLine } from "./Board";

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
}: {
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

  // Delete a single line from the open bill — ported from the bill page.
  // WRITES immediately (draft-only; the server gates it), same as Combine.
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
        body: JSON.stringify({ docId: openBill?.id, costItemId: id }),
      });
      const json = await res.json();
      if (!res.ok) setDeleteLineMsg(json.error ?? "Delete failed");
      else if (json.previewed)
        setDeleteLineMsg("Preview only — writes are OFF. Nothing was deleted in JobTread.");
      else {
        setCombineSelected((s) => s.filter((x) => x !== id));
        setStaged((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setEdits((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setDeleteLineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setDeletingLineId("");
    }
  };

  // Add a new line to the open bill (createCostItem) — ported from the bill
  // page. Unit $ is entered PRE-TAX (matching the line editor); gross it up
  // against the bill's CURRENT previewed subtotal/tax so it lands consistent
  // with whatever's on screen, including an unsynced tax edit.
  const addLine = async () => {
    const name = newLine.name.trim();
    if (!name || !openBill) return;
    setAddLineSaving(true);
    setAddLineMsg("");
    try {
      const description = descriptionForCode(newLine.code, data?.budget ?? []);
      const qty = Number(newLine.quantity) || 0;
      const preTaxUnit = Number(newLine.unitCost) || 0;
      const newSumPreTax = openMath.subtotal + preTaxUnit * qty;
      const reTaxAdd = newSumPreTax > 0 ? (newSumPreTax + openTaxView) / newSumPreTax : 1;
      const res = await fetch("/api/add-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId: openBill.id,
          name,
          quantity: qty,
          unitCost: round2(preTaxUnit * reTaxAdd),
          jobCostItemId: newLine.code || undefined,
          description,
        }),
      });
      const json = await res.json();
      if (!res.ok) setAddLineMsg(json.error ?? "Add failed");
      else if (json.previewed)
        setAddLineMsg("Preview only — writes are OFF. Nothing was added to JobTread.");
      else {
        setAddingLine(false);
        setNewLine({ name: "", quantity: "1", unitCost: "0", code: "" });
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setAddLineMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setAddLineSaving(false);
    }
  };

  // Buyback WRITES immediately (unlike a recode) — like Combine, it's a
  // structural change (the line moves onto a DIFFERENT bill entirely, not just
  // a different code on this one), not a "which code" decision worth trying on
  // and reverting. Mirrors the bill page's buyback (/bill/[docId]) — see
  // buybackLine in lib/jobtread.ts for how repeat clicks against the SAME
  // source bill land on the SAME Ascent - Shop bill instead of minting a new
  // one each time.
  const buybackLineById = async (l: JobBillLine, name: string, extended: number) => {
    // No confirm here: the card's buyback dialog is the confirmation, and it can
    // hand over several lines in a row.
    setBuybackId(l.id);
    setSyncMsg(null);
    try {
      const codeId = leafOf(l);
      const description = codeId ? descriptionForCode(codeId, data?.budget ?? []) : undefined;
      const res = await fetch("/api/buyback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDocId: l.docId,
          costItemId: l.id,
          name,
          unitCost: round2(extended),
          description,
        }),
      });
      const json = await res.json();
      if (!res.ok) setSyncMsg({ tone: "error", text: json.error ?? "Buyback failed." });
      else if (json.previewed)
        setSyncMsg({
          tone: "error",
          text: "Preview only — writes are OFF. Nothing was moved in JobTread.",
        });
      else {
        setStaged((prev) => {
          const next = new Map(prev);
          next.delete(l.id);
          return next;
        });
        setEdits((prev) => {
          const next = { ...prev };
          delete next[l.id];
          return next;
        });
        setSyncMsg({
          tone: "success",
          text: json.created ? "Moved to a new Shop bill." : "Added to the existing Shop bill.",
        });
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setSyncMsg({ tone: "error", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setBuybackId("");
    }
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
