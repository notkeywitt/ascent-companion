"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { LastRun } from "@/components/LastRun";

type State = "idle" | "busy" | "done" | "error";

/**
 * Fires the full Apps Script JT→Sheets/Drive sync via POST /api/jt-sync
 * (queued mode — Apps Script returns immediately and runs within ~1 min).
 * The button confirms the queue, not the sync result; results land in the
 * script's Audit Log under "Full JT Sync".
 *
 * It sits with the other closing actions at the foot of Tracking Sheets, not in
 * the header: kicking the mirror is something you do after settling a job's
 * month, next to the actions that settle it. "Sync Drive" is the label, because
 * the row also carries "Sync to Tracking Sheet" — one pushes THIS job's month
 * into its Google sheet, this one pulls all of JobTread into the Sheets and
 * Drive tree. Same shape as its neighbours; the RESULT is the only thing it
 * says in a color.
 *
 * A full sync takes ~15 min and holds the script's shared sync lock throughout,
 * so a click landing in that window CANNOT start a run. Apps Script reports that
 * back as mode "already-running" (or "already-queued") rather than pretending to
 * queue one — surface it, or the button reads as success while nothing happens
 * and the natural response is to keep clicking.
 */
/**
 * "Drive synced 40 minutes ago (hourly) · Sync now" — the full sync as a
 * status line (Phase 6). The stamp is Apps Script's `FULL_SYNC_LAST_RUN`,
 * returned on GET /api/tracking-sheet as `fullSync`; null until that side
 * records one. The retry is `SyncNowButton`'s own queue call.
 */
export function DriveSyncStatus({ className = "" }: { className?: string }) {
  const [at, setAt] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<State>("idle");
  const [detail, setDetail] = useState("");
  const [tone, setTone] = useState<"ok" | "warn" | "error">("ok");

  useEffect(() => {
    fetch("/api/tracking-sheet", { cache: "no-store" })
      .then((r): Promise<{ fullSync?: { at?: string } | null }> => (r.ok ? r.json() : Promise.resolve({})))
      .then((b) => setAt(b?.fullSync?.at ?? null))
      .catch(() => setAt(null));
  }, []);

  async function fire() {
    if (state === "busy") return;
    setState("busy");
    setDetail("");
    try {
      const res = await fetch("/api/jt-sync", { method: "POST" });
      const j = await res.json();
      if (j?.ok) {
        const mode = j.mode ?? "queued";
        setTone(mode === "queued" ? "ok" : "warn");
        setDetail(
          mode === "already-running"
            ? "Already running."
            : mode === "already-queued"
              ? "Already queued."
              : "Queued — it runs within a minute and takes about 15.",
        );
      } else {
        setTone("error");
        setDetail(j?.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setTone("error");
      setDetail(e instanceof Error ? e.message : "Network error");
    }
    setState("idle");
  }

  return (
    <LastRun
      className={className}
      verb="Drive synced"
      at={at}
      every="hourly"
      retry="Sync now"
      busy={state === "busy"}
      busyLabel="Queuing…"
      detail={tone !== "error" && detail ? <span className={tone === "warn" ? "text-warn" : ""}>{detail}</span> : undefined}
      error={tone === "error" ? detail : undefined}
      onRetry={fire}
    />
  );
}

export function SyncNowButton({ className = "" }: { className?: string }) {
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
          : "Sync Drive";

  // The finished states repaint the LABEL only — the button keeps its neighbours'
  // shape either way, so a row of actions doesn't change size when one reports.
  const tone =
    state === "error"
      ? " !text-danger"
      : state === "done"
        ? mode === "queued"
          ? " !text-green-700 dark:!text-green-400"
          : " !text-amber-600 dark:!text-amber-400" // nothing started — not success
        : "";

  return (
    <Button
      variant="secondary"
      onClick={fire}
      disabled={state === "busy"}
      title={detail || "Sync Sheets + Drive with JobTread now"}
      className={
        className + tone + (state === "busy" ? " animate-pulse cursor-wait" : "")
      }
    >
      {label}
    </Button>
  );
}
