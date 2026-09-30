"use client";

import { useEffect, useState } from "react";
import type { BoardPayload } from "./Board";

/**
 * The open bill's "Needs review" flag and note on the Tracking Sheets board.
 * Companion-local (/api/bill-review), never JobTread. The flag rides on every
 * row of the month already; the note is fetched only for the open bill.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the
 * code is the board's, unchanged.
 */
export function useBillReview({
  data,
  load,
  openDocId,
}: {
  data: BoardPayload | null;
  load: (opts?: { preserveStaged?: boolean; }) => Promise<void>;
  openDocId: string | null;
}) {
  /**
   * The open bill's "Needs review" flag and note, for the shared coding card.
   * Fetched per bill rather than carried on the board's payload: the flag is on
   * every row already (BillRef.needsReview, the ⚑ chip), but the NOTE is only
   * ever read for the one bill you have open, and putting it on the month's
   * payload would fetch a paragraph per bill to show none of them.
   */
  const [review, setReview] = useState({
    flagged: false,
    note: "",
    by: "",
    at: "",
    saving: false,
    msg: "",
  });

  // Load the open bill's review flag + note. Seeded from the row the board
  // already has, so the ⚑ shows instantly and only the note arrives late.
  useEffect(() => {
    if (!openDocId) return;
    const seed = data?.bills.find((b) => b.id === openDocId)?.needsReview ?? false;
    setReview({ flagged: seed, note: "", by: "", at: "", saving: false, msg: "" });
    let alive = true;
    fetch(`/api/bill-review?docId=${encodeURIComponent(openDocId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        setReview((prev) => ({
          ...prev,
          flagged: !!j.needsReview,
          note: j.note ?? "",
          by: j.flaggedBy ?? "",
          at: j.flaggedAt ?? "",
        }));
      })
      .catch(() => {
        /* best-effort — the flag from the row still shows */
      });
    return () => {
      alive = false;
    };
    // `data` is read only to seed the flag; refetching on every board reload
    // would stamp on a note being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDocId]);

  /** Flag / unflag the open bill, with the note. Companion-local, not JobTread. */
  const saveReview = async (flagged: boolean) => {
    if (!openDocId) return;
    setReview((p) => ({ ...p, saving: true, msg: "" }));
    try {
      const res = await fetch("/api/bill-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: openDocId, needsReview: flagged, note: review.note }),
      });
      const j = await res.json();
      if (!res.ok) {
        setReview((p) => ({ ...p, saving: false, msg: j?.error ?? "Couldn't save." }));
        return;
      }
      setReview((p) => ({
        ...p,
        flagged,
        note: flagged ? p.note : "",
        by: flagged ? p.by : "",
        at: flagged ? p.at : "",
        saving: false,
        msg: flagged ? "Flagged for review." : "Cleared.",
      }));
      // The month's rows carry the ⚑ too — re-read so the list agrees.
      await load({ preserveStaged: true });
    } catch (e) {
      setReview((p) => ({
        ...p,
        saving: false,
        msg: e instanceof Error ? e.message : "Network error",
      }));
    }
  };

  return {
    review,
    saveReview,
    setReview,
  };
}
