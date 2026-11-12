"use client";

import { useState } from "react";
import { Banner, Button } from "@/components/ui";

type Summary = { logged?: number; skipped?: number; unmatched?: number; failed?: number };

/** Runs the tagged-email scan now (/api/jobs-hub/scan-bills) and says what it did. */
export function CheckForBills() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/jobs-hub/scan-bills", { method: "POST" });
      const d: { error?: string; ok?: boolean; summary?: Summary } = await r.json().catch(() => ({}));
      if (!r.ok || d.error || !d.ok) throw new Error(d.error || "The scan did not run.");
      const s = d.summary ?? {};
      const bad = (s.unmatched ?? 0) + (s.failed ?? 0);
      const text =
        `${s.logged ?? 0} bill${s.logged === 1 ? "" : "s"} imported` +
        (bad ? `, ${bad} not imported (check the tag in Gmail)` : "");
      setMsg({ tone: bad ? "error" : "success", text });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "The scan failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-center">
      <Button variant="secondary" className="min-h-11" onClick={run} disabled={busy}>
        {busy ? "Checking…" : "Check for Bills"}
      </Button>
      {msg && (
        <Banner tone={msg.tone} className="mt-1.5 !py-2 text-xs">
          {msg.text}
        </Banner>
      )}
    </div>
  );
}
