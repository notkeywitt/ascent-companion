"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/ui";
import { useBillReview } from "./useBillReview";
import { DraftCodingPanel, useBillEditor, type Selection } from "./DraftWorkbench";

/**
 * ONE BILL, IN A POPUP — the coding panel the all-jobs workbench docks at xl
 * (DraftWorkbench's `useBillEditor` + `DraftCodingPanel`), opened over the
 * page instead. A job check's bill finding opens here, so fixing it does not
 * cost the results list: close the popup and Re-check the row.
 *
 * It saves a bill at a time, straight to JobTread, exactly as that panel does
 * — so a host holding the same month (the board) re-reads it on close.
 */
export function BillPopup({
  sel,
  onClose,
  nav,
  fullPageHref,
}: {
  sel: Selection;
  onClose: () => void;
  /** Step through the list the bill was opened from, without closing. */
  nav?: { position: number; count: number; onPrev: () => void; onNext: () => void };
  /** The bill page, for what the popup does not carry: approve, void, flag. */
  fullPageHref?: string;
}) {
  const editor = useBillEditor(sel);

  // The bill page's three extra actions, so "Full page" is rarely needed.
  const { review, saveReview, setReview } = useBillReview({
    data: null,
    load: async () => {},
    openDocId: sel.docId,
  });
  const [approving, setApproving] = useState(false);
  const [approveMsg, setApproveMsg] = useState("");
  const approveBill = async (docId: string) => {
    if (approving) return;
    setApproving(true);
    setApproveMsg("");
    try {
      // Same write as the board's per-bill approve (useBillApproval). The route
      // corrects an Expense's QuickBooks type itself.
      const r = await fetch("/api/bill-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, status: editor.header?.name === "Expense" ? "approved" : "pending" }),
      });
      const j = await r.json();
      setApproveMsg(!r.ok || j.error ? j.error ?? "Approve failed" : j.previewed ? "Would approve (saving is off)." : "Approved.");
      await editor.reload();
    } catch (e) {
      setApproveMsg(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setApproving(false);
    }
  };

  // Unsaved coding is autosaved on this device (src/lib/codingDraft.ts) and
  // offered back when the bill is reopened, so leaving it loses nothing.
  const okToLeave = () =>
    editor.changeCount === 0 ||
    window.confirm(
      "This bill has unsaved coding changes. They stay on this device and come back when you reopen the bill. Leave anyway?",
    );
  const close = () => {
    if (okToLeave()) onClose();
  };
  // Escape and the scrim both run `close`, so the unsaved-coding question
  // guards every way out.
  return (
    <Dialog label={`Bill — ${sel.label}`} size="lg" onClose={close}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold">{sel.label}</p>
          {fullPageHref && (
            <Link
              href={fullPageHref}
              title="Approve, void or flag this bill"
              className="ml-auto inline-flex min-h-9 shrink-0 items-center text-xs font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
            >
              Full page
            </Link>
          )}
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-9 shrink-0 items-center text-xs font-semibold text-accent transition hover:underline"
          >
            Close
          </button>
        </div>
        {approveMsg && <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">{approveMsg}</p>}
        <DraftCodingPanel
          editor={editor}
          sel={sel}
          position={nav?.position ?? 1}
          count={nav?.count ?? 1}
          onPrev={() => nav && okToLeave() && nav.onPrev()}
          onNext={() => nav && okToLeave() && nav.onNext()}
          // Re-filed to another job: the bill no longer lives where it was opened.
          onBillMoved={onClose}
          actions={{
            review: {
              ...review,
              setNote: (v: string) => setReview((p) => ({ ...p, note: v })),
              save: (flagged: boolean) => void saveReview(flagged),
            },
            approveBill: (id: string) => void approveBill(id),
            approvingBill: approving,
            approveBlocked: editor.changeCount > 0 ? "Save the coding first — approving locks the lines." : null,
            onVoided: onClose,
          }}
        />
    </Dialog>
  );
}
