"use client";

import { useEffect, useRef } from "react";
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
export function BillPopup({ sel, onClose }: { sel: Selection; onClose: () => void }) {
  const editor = useBillEditor(sel);

  const close = () => {
    // Unsaved coding is autosaved on this device (src/lib/codingDraft.ts) and
    // offered back when the bill is reopened, so closing loses nothing.
    if (
      editor.changeCount > 0 &&
      !window.confirm(
        "This bill has unsaved coding changes. They stay on this device and come back when you reopen the bill. Close anyway?",
      )
    ) {
      return;
    }
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Bill — ${sel.label}`}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-line bg-cream p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-xl dark:bg-ink sm:rounded-2xl sm:pb-3"
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold">{sel.label}</p>
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-9 shrink-0 items-center text-xs font-semibold text-accent transition hover:underline"
          >
            Close
          </button>
        </div>
        <DraftCodingPanel
          editor={editor}
          sel={sel}
          position={1}
          count={1}
          onPrev={() => {}}
          onNext={() => {}}
          // Re-filed to another job: the bill no longer lives where it was opened.
          onBillMoved={onClose}
        />
      </div>
    </div>
  );
}
