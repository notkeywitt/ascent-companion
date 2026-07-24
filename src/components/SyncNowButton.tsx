"use client";

import { useRef, useState } from "react";

type State = "idle" | "busy" | "done" | "error";

/**
 * Fires the full Apps Script JT→Sheets/Drive sync via POST /api/jt-sync
 * (queued mode — Apps Script returns immediately and runs within ~1 min).
 * The button confirms the queue, not the sync result; results land in the
 * script's Audit Log under "Full JT Sync".
 *
 * A full sync takes ~15 min and holds the script's shared sync lock throughout,
 * so a click landing in that window CANNOT start a run. Apps Script reports that
 * back as mode "already-running" (or "already-queued") rather than pretending to
 * queue one — surface it, or the button reads as success while nothing happens
 * and the natural response is to keep clicking.
 */
export function SyncNowButton() {
  const [state, setState] = useState<State>("idle");
  const [mode, setMode] = useState("");
  const [detail, setDetail] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fire() {
    if (state === "busy") return;
    if (timer.current) clearTimeout(timer.current);
    setState("busy");
    setMode("");
    setDetail("");
    try {
      const res = await fetch("/api/jt-sync", { method: "POST" });
      const j = await res.json();
      if (j?.ok) {
        setState("done");
        setMode(j.mode ?? "queued");
        setDetail(j.note ?? "Sync queued.");
      } else {
        setState("error");
        setDetail(j?.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setState("error");
      setDetail(e instanceof Error ? e.message : "Network error");
    }
    timer.current = setTimeout(() => setState("idle"), 8000);
  }

  const doneLabel =
    mode === "already-running"
      ? "Already running"
      : mode === "already-queued"
        ? "Already queued"
        : "Queued ✓";

  const label =
    state === "busy"
      ? "Syncing…"
      : state === "done"
        ? doneLabel
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
        "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-sm font-semibold transition " +
        (state === "error"
          ? "text-red-600 dark:text-red-400"
          : state === "done"
            ? mode === "queued"
              ? "text-green-700 dark:text-green-400"
              : "text-amber-600 dark:text-amber-400" // nothing was started — don't read as success
            : "text-neutral-500 hover:text-accent") +
        (state === "busy" ? " animate-pulse cursor-wait" : "")
      }
    >
      {/* Sharing one row with the job picker, the idle word "Sync" is dropped on
          phone widths — the glyph plus the tooltip/aria-label carry it. Every
          other state keeps its label: that text IS the result feedback. */}
      ⟳
      <span className={"ml-1 " + (state === "idle" ? "hidden sm:inline" : "")}>{label}</span>
    </button>
  );
}
