"use client";

import { useRef, useState } from "react";

type State = "idle" | "busy" | "done" | "error";

/**
 * Fires the full Apps Script JT→Sheets/Drive sync via POST /api/jt-sync
 * (queued mode — Apps Script returns immediately and runs within ~1 min).
 * The button confirms the queue, not the sync result; results land in the
 * script's Audit Log under "Full JT Sync".
 */
export function SyncNowButton() {
  const [state, setState] = useState<State>("idle");
  const [detail, setDetail] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fire() {
    if (state === "busy") return;
    if (timer.current) clearTimeout(timer.current);
    setState("busy");
    setDetail("");
    try {
      const res = await fetch("/api/jt-sync", { method: "POST" });
      const j = await res.json();
      if (j?.ok) {
        setState("done");
        setDetail(j.note ?? "Sync queued.");
      } else {
        setState("error");
        setDetail(j?.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setState("error");
      setDetail(e instanceof Error ? e.message : "Network error");
    }
    timer.current = setTimeout(() => setState("idle"), 6000);
  }

  const label =
    state === "busy"
      ? "Syncing…"
      : state === "done"
        ? "Queued ✓"
        : state === "error"
          ? "Failed ✕"
          : "Sync";

  return (
    <button
      onClick={fire}
      disabled={state === "busy"}
      title={detail || "Sync Sheets + Drive with JobTread now"}
      aria-label="Sync with JobTread now"
      className={
        "mr-1 whitespace-nowrap rounded-md px-2 py-1 text-sm font-semibold transition " +
        (state === "error"
          ? "text-red-600 dark:text-red-400"
          : state === "done"
            ? "text-green-700 dark:text-green-400"
            : "text-neutral-500 hover:text-accent") +
        (state === "busy" ? " animate-pulse cursor-wait" : "")
      }
    >
      ⟳ {label}
    </button>
  );
}
