"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { LastRun } from "@/components/LastRun";
import { SCAN_EVERY_MS, scanEvery } from "@/lib/scanCountdown";

type Summary = { logged?: number; skipped?: number; unmatched?: number; failed?: number };

/**
 * "Checked for bills 6 minutes ago (every 15 min) · Check now" — the tagged
 * email scan (`_JT Invoice …` labels in Gmail) as a status line (Phase 6).
 * Apps Script runs it every 15 minutes; the stamp is its `INVOICE_SCAN_LAST_RUN`
 * property, returned on GET /api/tracking-sheet as `invoiceScan` (null until
 * that side records one, or without the tracking-sheet view). The retry runs
 * the scan now (/api/jobs-hub/scan-bills) and says what it imported.
 *
 * COUNTDOWN (owner, 2026-11-14): "(every 15 min, next in ~9 min)" — the last
 * run plus 15 minutes, ticking each half minute. Apps Script's timer drifts a
 * few minutes, so it is an estimate. Once the time passes it reads "any
 * minute" and re-reads the stamp once a minute until the timer's run lands.
 */
export function CheckForBills() {
  const canStamp = useAccess().can("tracking-sheet");
  const [at, setAt] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [now, setNow] = useState(() => Date.now());

  const readStamp = useCallback(() => {
    fetch("/api/tracking-sheet", { cache: "no-store" })
      .then((r): Promise<{ invoiceScan?: { at?: string } | null }> => (r.ok ? r.json() : Promise.resolve({})))
      .then((b) => setAt((prev) => b?.invoiceScan?.at ?? prev ?? null))
      .catch(() => setAt((prev) => prev ?? null));
  }, []);

  useEffect(() => {
    if (!canStamp) {
      setAt(null);
      return;
    }
    readStamp();
  }, [canStamp, readStamp]);

  // The countdown's clock.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Past due: re-read the stamp once a minute until the timer's run shows up.
  const overdue = !!at && Date.parse(at) + SCAN_EVERY_MS < now;
  useEffect(() => {
    if (!overdue || !canStamp) return;
    const id = setInterval(readStamp, 60_000);
    return () => clearInterval(id);
  }, [overdue, canStamp, readStamp]);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/jobs-hub/scan-bills", { method: "POST" });
      const d: { error?: string; ok?: boolean; summary?: Summary } = await r.json().catch(() => ({}));
      if (!r.ok || d.error || !d.ok) throw new Error(d.error || "The scan did not run.");
      const s = d.summary ?? {};
      const bad = (s.unmatched ?? 0) + (s.failed ?? 0);
      setMsg({
        tone: bad ? "error" : "ok",
        text:
          `${s.logged ?? 0} bill${s.logged === 1 ? "" : "s"} imported` +
          (bad ? `, ${bad} not imported (check the tag in Gmail)` : ""),
      });
      setAt(new Date().toISOString());
      setNow(Date.now());
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "The scan failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <LastRun
      className="basis-full text-center"
      verb="Checked for bills"
      at={at}
      every={scanEvery(at, now)}
      retry="Check now"
      busy={busy}
      busyLabel="Checking…"
      detail={msg?.tone === "ok" ? msg.text : undefined}
      error={msg?.tone === "error" ? msg.text : undefined}
      onRetry={run}
    />
  );
}
