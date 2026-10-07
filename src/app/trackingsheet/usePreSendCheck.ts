"use client";

import { useCallback, useEffect, useState } from "react";
import type { PreSendResult } from "@/lib/invoiceReview/preSend";

/** One job's check. Throws with the route's error. Also run per job by "Check all Jobs". */
export async function fetchPreSend(jobId: string, ym: string): Promise<PreSendResult> {
  const res = await fetch(
    `/api/invoice-review/job?jobId=${encodeURIComponent(jobId)}&ym=${encodeURIComponent(ym)}`,
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "The check failed.");
  return json as PreSendResult;
}

/**
 * "Check this job" on the Tracking Sheets board — the invoice review's checks,
 * run on one job and month. Moved out of Board.tsx on 2026-09-29
 * (SIMPLICITY_AUDIT.md finding 01); the code is the board's, unchanged.
 */
export function usePreSendCheck({ jobId, ym }: { jobId: string; ym: string }) {
  // ---- pre-send check (the invoice review's checks, on this job) -----------
  // State lives here, not inside PreSendCheck, so both triggers — the bottom
  // action row and the phone's action drawer — sit outside the card, which
  // stays purely the result.
  const [preSend, setPreSend] = useState<PreSendResult | null>(null);
  const [preSendRunning, setPreSendRunning] = useState(false);
  const [preSendError, setPreSendError] = useState("");
  const runPreSend = useCallback(async () => {
    if (!jobId) return;
    setPreSendRunning(true);
    setPreSendError("");
    setPreSend(null);
    try {
      setPreSend(await fetchPreSend(jobId, ym));
    } catch (e) {
      setPreSendError(e instanceof Error ? e.message : "The check failed.");
    } finally {
      setPreSendRunning(false);
    }
  }, [jobId, ym]);
  // A month or job change describes another period — drop the stale result.
  useEffect(() => {
    setPreSend(null);
    setPreSendError("");
  }, [jobId, ym]);

  return { preSend, preSendRunning, preSendError, runPreSend };
}
