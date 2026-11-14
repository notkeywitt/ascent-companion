"use client";

import { useEffect, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { LastRun } from "@/components/LastRun";

type Summary = { logged?: number; skipped?: number; unmatched?: number; failed?: number };

/**
 * "Checked for bills 6 minutes ago (every 15 min) · Check now" — the tagged
 * email scan (`_JT Invoice …` labels in Gmail) as a status line (Phase 6).
 * Apps Script runs it every 15 minutes; the stamp is its `INVOICE_SCAN_LAST_RUN`
 * property, returned on GET /api/tracking-sheet as `invoiceScan` (null until
 * that side records one, or without the tracking-sheet view). The retry runs
 * the scan now (/api/jobs-hub/scan-bills) and says what it imported.
 */
export function CheckForBills() {
  const canStamp = useAccess().can("tracking-sheet");
  const [at, setAt] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!canStamp) {
      setAt(null);
      return;
    }
    fetch("/api/tracking-sheet", { cache: "no-store" })
      .then((r): Promise<{ invoiceScan?: { at?: string } | null }> => (r.ok ? r.json() : Promise.resolve({})))
      .then((b) => setAt(b?.invoiceScan?.at ?? null))
      .catch(() => setAt(null));
  }, [canStamp]);

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
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "The scan failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <LastRun
      className="text-center"
      verb="Checked for bills"
      at={at}
      every="every 15 min"
      retry="Check now"
      busy={busy}
      busyLabel="Checking…"
      detail={msg?.tone === "ok" ? msg.text : undefined}
      error={msg?.tone === "error" ? msg.text : undefined}
      onRetry={run}
    />
  );
}
