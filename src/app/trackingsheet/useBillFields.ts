"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { BillMoveRequest } from "@/components/BillMove";
import { jobLabel, type JobRef } from "@/components/JobPicker";
import { issueDateFor, monthLabel } from "@/lib/billingMonths";
import type { BillRef, BoardPayload } from "./Board";

/**
 * The open bill's OWN fields on the Tracking Sheets board: its billing month
 * (issueDate), due date, Bill/Expense type (staged until Save), vendor bill
 * number, and the job it sits on (a move runs through BillMoveProvider). Each
 * write goes to its own route (/api/bill-issuedate, /api/bill-duedate,
 * /api/bill-number) as the card changes it.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01) with
 * the owner's ok for the write paths; the code is the board's, unchanged.
 */
export function useBillFields({
  jobId,
  load,
  openBill,
  openBillDirty,
  openDocId,
  setData,
  setOpenDocId,
  setSyncMsg,
  setTypeEdits,
  startBillMove,
  ym,
}: {
  jobId: string;
  load: (opts?: { preserveStaged?: boolean; }) => Promise<void>;
  openBill: BillRef | null;
  openBillDirty: boolean;
  openDocId: string | null;
  setData: Dispatch<SetStateAction<BoardPayload | null>>;
  setOpenDocId: Dispatch<SetStateAction<string | null>>;
  setSyncMsg: Dispatch<SetStateAction<{ tone: "success" | "error"; text: string; } | null>>;
  setTypeEdits: Dispatch<SetStateAction<Record<string, "Bill" | "Expense">>>;
  startBillMove: (req: BillMoveRequest) => void;
  ym: string;
}) {
  const [monthSaving, setMonthSaving] = useState(false);
  const [dueDateSaving, setDueDateSaving] = useState(false);
  const [filingMsg, setFilingMsg] = useState("");
  // Vendor Bill Number (JobTread externalId) editor for the open bill. Local draft
  // synced from the bill; committed on blur so we don't write on every keystroke.
  const [billNumberDraft, setBillNumberDraft] = useState("");
  const [billNumberSaving, setBillNumberSaving] = useState(false);
  // Cleared when the open bill changes, like the board's other per-bill forms.
  useEffect(() => setFilingMsg(""), [openDocId]);

  // Keep the Bill Number draft in step with the open bill — on open, and after a
  // save/reload re-reads its externalId from JobTread.
  useEffect(() => {
    setBillNumberDraft(openBill?.externalId ?? "");
  }, [openDocId, openBill?.externalId]);

  // Re-date the bill (JobTread's issueDate = its billing month; the sheet and
  // the Drive month folder follow it via the hourly mirror). Any status — a
  // re-date is legal on a committed bill, unlike qty/description edits.
  const setBillingMonth = async (targetYm: string) => {
    if (!openBill || !targetYm) return;
    // A different month takes the bill out of the month this board is showing,
    // and the reload below prunes anything staged against it.
    const leaves = targetYm !== ym;
    if (
      leaves &&
      openBillDirty &&
      !window.confirm(
        `Move this bill to ${monthLabel(targetYm)}?\n\nIt leaves ${monthLabel(ym)} on this ` +
          `board, and its staged coding changes go with it — they haven't been synced.`,
      )
    )
      return;
    setMonthSaving(true);
    setFilingMsg("");
    try {
      const res = await fetch("/api/bill-issuedate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: openBill.id, issueDate: issueDateFor(targetYm) }),
      });
      const json = await res.json();
      if (!res.ok) setFilingMsg(json.error ?? "Couldn't set the billing month.");
      else if (json.previewed)
        setFilingMsg("Preview only — writes are OFF. The billing month wasn't changed.");
      else {
        if (leaves) {
          setOpenDocId(null);
          setSyncMsg({
            tone: "success",
            text: `Moved to ${monthLabel(targetYm)} — it's no longer in ${monthLabel(ym)}.`,
          });
        }
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setFilingMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setMonthSaving(false);
    }
  };

  /**
   * Set the bill's PAYMENT DUE date — when the VENDOR has to be paid. It is not
   * the billing month above: a due date moves no money, re-files nothing, and
   * never takes the bill off this board, so it needs none of that method's
   * confirm. "" clears it and puts the bill back on net-30.
   */
  const setDueDate = async (next: string) => {
    if (!openBill || next === (openBill.dueDate ?? "")) return;
    setDueDateSaving(true);
    setFilingMsg("");
    try {
      const res = await fetch("/api/bill-duedate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: openBill.id, dueDate: next }),
      });
      const json = await res.json();
      if (!res.ok) setFilingMsg(json.error ?? "Couldn't set the due date.");
      else if (json.previewed)
        setFilingMsg("Preview only — writes are OFF. The due date wasn't changed.");
      else await load({ preserveStaged: true });
    } catch (e) {
      setFilingMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setDueDateSaving(false);
    }
  };

  /**
   * Stage the bill's type — Bill or Expense. Save writes it. Picking the type
   * JobTread already has (both fields agreeing) un-stages it.
   */
  const stageBillType = (t: "Bill" | "Expense") => {
    if (!openBill) return;
    const qbo = t === "Expense" ? "purchase" : "bill";
    const inJobTread = openBill.name === t && (openBill.qboDocumentType ?? "bill") === qbo;
    setTypeEdits((prev) => {
      const next = { ...prev };
      if (inJobTread) delete next[openBill.id];
      else next[openBill.id] = t;
      return next;
    });
    setSyncMsg(null);
  };

  // Save the Vendor Bill Number (JobTread externalId). Writes immediately, like
  // the billing-month edit, then reloads so the field reflects JobTread's truth.
  // A re-number keeps the bill on this board, so success is reported in the card.
  const saveBillNumber = async () => {
    if (!openBill) return;
    const next = billNumberDraft.trim();
    const current = (openBill.externalId ?? "").trim();
    if (next === current) return;
    setBillNumberSaving(true);
    setFilingMsg("");
    try {
      const res = await fetch("/api/bill-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: openBill.id, externalId: next }),
      });
      const json = await res.json();
      if (!res.ok) setFilingMsg(json.error ?? "Couldn't set the bill number.");
      else if (json.previewed)
        setFilingMsg("Preview only — writes are OFF. The bill number wasn't changed.");
      else {
        setFilingMsg("Bill number saved.");
        await load({ preserveStaged: true });
      }
    } catch (e) {
      setFilingMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setBillNumberSaving(false);
    }
  };

  // Move the bill to another job. JobTread can't move bills, so Apps Script
  // delete+recreates it on the target job (draft only) and re-files the sheet
  // row + Drive folder. The recreate mints a NEW docId on a job this board
  // isn't showing, so afterwards we simply drop it from the list.
  const reassignJob = (target: JobRef) => {
    if (!openBill || !target.id || target.id === jobId) return;
    if (
      !window.confirm(
        `Move this bill to ${jobLabel(target)}?\n\nJobTread can't move bills, so it will be ` +
          `voided and recreated on that job. It stays a draft, keeps its PDF, and re-files ` +
          `in Drive.` +
          (openBillDirty
            ? "\n\nIts staged coding changes haven't been synced and will be lost."
            : "") +
          `\n\nThe move runs in the background — you can keep working while it finishes.`,
      )
    )
      return;
    setFilingMsg("");
    // Handed to the root layout's BillMoveProvider, so the 30-90s void+recreate
    // is not tied to this drawer. The row is dropped OPTIMISTICALLY — it is
    // leaving this job either way, and the provider's banner is what reports a
    // failure. A refresh puts it back if the move did not land.
    startBillMove({ docId: openBill.id, jobId: target.id, jobLabel: jobLabel(target) });
    setOpenDocId(null);
    setData((d) => (d ? { ...d, bills: d.bills.filter((b) => b.id !== openBill.id) } : d));
  };

  return {
    billNumberDraft,
    billNumberSaving,
    dueDateSaving,
    filingMsg,
    monthSaving,
    reassignJob,
    saveBillNumber,
    setBillNumberDraft,
    setBillingMonth,
    setDueDate,
    stageBillType,
  };
}
