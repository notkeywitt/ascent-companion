"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { BillRef } from "./Board";

/**
 * Approving bills on the Tracking Sheets board — one from the coding card, or
 * every draft on screen from the batch dialog. Each is one POST to
 * /api/bill-status (a JobTread write: draft → pending for a Bill, draft →
 * approved for an Expense). Moved out of Board.tsx on 2026-09-29
 * (SIMPLICITY_AUDIT.md finding 01); the code is the board's, unchanged.
 *
 * `dirty` blocks a single approve for the reason it always did — approving
 * locks a draft's lines in JobTread, so staged coding syncs first — and `load`
 * re-reads the month afterwards.
 */
export function useBillApproval({
  data,
  dirty,
  orderedBills,
  setOpenDocId,
  load,
}: {
  data: { bills: BillRef[] } | null;
  dirty: boolean;
  orderedBills: BillRef[];
  setOpenDocId: Dispatch<SetStateAction<string | null>>;
  load: () => Promise<unknown>;
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveMsg, setApproveMsg] = useState<{ tone: "success" | "error"; text: string } | null>(
    null,
  );

  // Every draft bill on screen — both panes — so "Approve" acts on exactly what
  // the office can see (Sunset drafts included; they're one tap away in the pane).
  const draftBills = useMemo(() => (data?.bills ?? []).filter((b) => b.status === "draft"), [data]);

  // Mirrors approveBill() on the bill detail page: a Bill is a payable (draft →
  // pending, "approved for payment"); an Expense is already paid (draft →
  // approved, "record payment").
  const approvalTarget = (b: BillRef) =>
    b.name === "Expense" || b.qboDocumentType === "purchase" ? "approved" : "pending";

  /**
   * One bill's approve POST. The batch button below loops it; the coding card's
   * own "Approve in JT" fires it once. Returns the failure line, or the
   * write-gate's preview flag on success.
   */
  const postApproval = async (b: BillRef): Promise<{ failure?: string; previewed?: boolean }> => {
    try {
      const r = await fetch("/api/bill-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: b.id, status: approvalTarget(b) }),
      });
      const j = await r.json();
      if (!r.ok || j.error) return { failure: `${b.label}: ${j.error ?? "Approve failed"}` };
      return { previewed: Boolean(j.previewed) };
    } catch (e) {
      return { failure: `${b.label}: ${e instanceof Error ? e.message : "Request failed"}` };
    }
  };

  /**
   * Approve ONE bill — the card's button, beside the batch one at the bottom
   * of the page. Same write, same role gate, no confirmation dialog: the batch
   * dialog exists to say how many bills one press would move, and here the
   * answer is one. `dirty` blocks it for the reason it blocks the batch —
   * approving locks a draft's lines in JobTread, so staged coding syncs first.
   */
  const approveOneBill = async (docId: string) => {
    const b = data?.bills.find((x) => x.id === docId);
    if (!b || dirty || approving) return;
    // Read the next bill off the CURRENT order, before the reload: approving
    // changes a bill's status, never its place in the list, so this is the same
    // row either way — and reading it after `load()` would use a stale closure.
    const at = orderedBills.findIndex((x) => x.id === docId);
    const next = at >= 0 ? orderedBills[at + 1] : undefined;
    setApproveMsg(null);
    setApproving(true);
    const r = await postApproval(b);
    setApproving(false);
    setApproveMsg(
      r.failure
        ? { tone: "error", text: r.failure }
        : { tone: "success", text: `${r.previewed ? "Would approve" : "Approved"} ${b.label}.` },
    );
    // Approving is queue work, so land on the next bill rather than on the one
    // just finished. A failure stays put — the message is about THIS bill.
    if (!r.failure) setOpenDocId(next ? next.id : null);
    await load();
  };

  // Batch-approve every draft bill currently on screen (see draftBills above —
  // same filters as the visible list). One /api/bill-status POST per bill,
  // sequentially, same loop shape as sync()'s per-doc /api/code calls.
  const approveDraftBills = async () => {
    setApproving(true);
    let ok = 0;
    let previewed = false;
    const failures: string[] = [];
    for (const b of draftBills) {
      const r = await postApproval(b);
      if (r.failure) failures.push(r.failure);
      else {
        if (r.previewed) previewed = true;
        ok++;
      }
    }
    setApproving(false);
    setApproveOpen(false);
    const verb = previewed ? "Would approve" : "Approved";
    if (failures.length === 0) {
      setApproveMsg({ tone: "success", text: `${verb} ${ok} bill${ok === 1 ? "" : "s"}.` });
    } else {
      setApproveMsg({
        tone: "error",
        text: `${verb} ${ok} bill(s), ${failures.length} failed: ${[...new Set(failures)].slice(0, 2).join("; ")}`,
      });
    }
    await load();
  };

  return {
    approveOpen,
    setApproveOpen,
    approving,
    approveMsg,
    setApproveMsg,
    draftBills,
    approvalTarget,
    approveOneBill,
    approveDraftBills,
  };
}
