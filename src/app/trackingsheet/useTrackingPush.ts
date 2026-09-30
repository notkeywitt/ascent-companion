"use client";

import { useEffect, useState } from "react";
import type { TrackingSyncState, TrackingTarget } from "@/components/TrackingSheetSync";

/**
 * The job's Google tracking sheet on the Tracking Sheets board: which sheet this
 * job is wired to, and the last push into it. Moved out of Board.tsx on
 * 2026-09-29 (SIMPLICITY_AUDIT.md finding 01); the code is the board's,
 * unchanged. The push itself is `runTrackingSync`, called from the board's
 * button with `setTrackingSync`.
 */
export function useTrackingPush({ canTrack, jobId, ym }: { canTrack: boolean; jobId: string; ym: string }) {
  const [trackingTarget, setTrackingTarget] = useState<TrackingTarget | null>(null);
  // Have we finished reading whether THIS job has a tracking sheet? Until we
  // have, the month-side button renders nothing rather than flashing the wrong
  // label (a real "Sync" vs a "Link one" for a job that in fact has a sheet).
  const [trackingChecked, setTrackingChecked] = useState(false);
  const [trackingSync, setTrackingSync] = useState<TrackingSyncState | undefined>(undefined);
  // The sheet push runs on its own task runner, so `syncing` (the JobTread write
  // loop) is already false while it's still going. Without this the button would
  // re-enable mid-push and a second click would queue a duplicate sync.
  const trackingBusy = trackingSync?.status === "queued" || trackingSync?.status === "running";

  useEffect(() => {
    // A new job starts unresolved — clear the old job's target so its Sync
    // button can't linger on the wrong sheet while the new read is in flight.
    setTrackingTarget(null);
    setTrackingChecked(false);
    if (!canTrack || !jobId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tracking-sheet", { cache: "no-store" });
        if (!res.ok) return; // non-fatal — stays unchecked, button stays hidden
        const b = await res.json();
        if (!alive) return;
        const hit = (
          (b.jobs ?? []) as { id: string; label: string; jtJobId: string; url: string }[]
        ).find((j) => j.jtJobId === jobId);
        if (hit) setTrackingTarget({ projectId: hit.id, label: hit.label, url: hit.url });
        // Only a clean read flips this on: a transient API failure hides the
        // button rather than wrongly offering to "Link" a sheet that exists.
        setTrackingChecked(true);
      } catch {
        /* non-fatal — stays unchecked */
      }
    })();
    return () => {
      alive = false;
    };
  }, [canTrack, jobId]);

  // A month change invalidates the result on screen — it describes another
  // billing period.
  useEffect(() => setTrackingSync(undefined), [ym]);

  return { trackingTarget, trackingChecked, trackingSync, setTrackingSync, trackingBusy };
}
