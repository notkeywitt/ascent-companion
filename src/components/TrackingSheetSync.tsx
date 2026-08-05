"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Spinner } from "@/components/ui";
import { TrackingSheetRisks } from "@/components/TrackingSheetRisks";
import { useAccess } from "@/components/AccessProvider";
import { createTaskRunner } from "@/lib/taskRunner";

/**
 * "Push this job's month into its Google Tracking Sheet."
 *
 * Two exports, because the two kinds of caller need different state ownership:
 *
 *  - `TrackingSheetSync` is presentational. The Invoicing page drives it from
 *    page-level state on purpose: a card's dropdown unmounts when it collapses,
 *    and button-local state would throw away the result of a sync the office
 *    kicked off and moved on from.
 *  - `TrackingSheetSyncFor` is self-contained — give it a JobTread job id and a
 *    month and it resolves the tracking-sheet target, runs the sync, and owns
 *    its own state. That's what single-job pages (a bill, Client Invoicing)
 *    want, since there's nothing to collapse.
 *
 * Both render nothing at all when the job has no tracking sheet wired up, or
 * when the user lacks the "tracking-sheet" view — /api/tracking-sheet is gated,
 * so asking anyway would just 403.
 */

/** A project wired to a tracking sheet, keyed by its JobTread job id. */
export interface TrackingTarget {
  projectId: string;
  label: string;
  url: string;
}

export interface TrackingSyncResult {
  rowCount: number;
  billCount: number;
  total: number;
  unmatched: { csi: string; amount: number; vendors: string[] }[];
  whitespaceOnly?: { csi: string; amount: number; vendors: string[] }[];
  deadColumns?: { csi: string; amount: number; vendors: string[]; column?: string }[];
  unmatchedTotal: number;
  trackingSheetName: string;
  trackingSheetUrl: string;
  durationSec?: number;
}

export interface TrackingSyncState {
  status: "queued" | "running" | "done" | "error";
  result?: TrackingSyncResult;
  error?: string;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Bounded concurrency, shared across every caller in the tab: the sync is a long
 * Apps Script round trip, and firing a dozen at once would just queue them
 * behind the script lock anyway.
 */
const trackingRunner = createTaskRunner(3);

export function TrackingSheetSync({
  state,
  onStart,
  monthLabel,
  className = "mb-3",
}: {
  state: TrackingSyncState | undefined;
  onStart: () => void;
  monthLabel: string;
  className?: string;
}) {
  const status = state?.status ?? "idle";
  const result = state?.result ?? null;
  const error = state?.error ?? "";
  const busy = status === "queued" || status === "running";

  return (
    <div className={className}>
      <Button variant="secondary" size="sm" className="w-full" disabled={busy} onClick={onStart}>
        {busy ? (
          <>
            <Spinner className="mr-1.5" />
            {status === "queued" ? "Queued…" : "Syncing…"}
          </>
        ) : status === "done" ? (
          `Sync ${monthLabel} to Tracking Sheet again`
        ) : (
          `Sync ${monthLabel} to Tracking Sheet`
        )}
      </Button>

      {status === "error" && (
        <Banner tone="error" className="mt-1.5 !py-2 text-xs">
          {error}
        </Banner>
      )}

      {status === "done" && result && (
        <>
          <p className="mt-1.5 text-xs text-neutral-500">
            Wrote <span className="font-semibold">{result.rowCount}</span> row
            {result.rowCount === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold">{money(result.total)}</span> ·{" "}
            <a
              href={result.trackingSheetUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-accent"
            >
              {result.trackingSheetName}
            </a>
            {typeof result.durationSec === "number" ? ` · ${result.durationSec.toFixed(1)}s` : ""}
          </p>
          <TrackingSheetRisks
            unmatched={result.unmatched}
            whitespaceOnly={result.whitespaceOnly}
            deadColumns={result.deadColumns}
            compact
            className="mt-1.5 !py-2"
          />
        </>
      )}
    </div>
  );
}

/** Kick off one project's sync, reporting progress through `set`. */
export function runTrackingSync(
  projectId: string,
  month: number,
  year: number,
  set: (s: TrackingSyncState) => void,
) {
  set({ status: "queued" });
  void trackingRunner.run(projectId, async () => {
    set({ status: "running" });
    try {
      const res = await fetch("/api/tracking-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "sync", projectId, month, year }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
      set({ status: "done", result: b as TrackingSyncResult });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : "Something went wrong." });
    }
  });
}

/**
 * Self-contained button for a single job. Resolves `jtJobId` to its tracking
 * sheet and renders nothing if there isn't one.
 *
 * `ym` is the billing month as YYYY-MM — for a bill that's the month of its
 * Invoice Date, which IS its billing month.
 */
export function TrackingSheetSyncFor({
  jtJobId,
  ym,
  monthLabel,
  className,
}: {
  jtJobId: string;
  ym: string;
  monthLabel: string;
  className?: string;
}) {
  const access = useAccess();
  const canTrack = access.can("tracking-sheet");
  const [target, setTarget] = useState<TrackingTarget | null>(null);
  const [state, setState] = useState<TrackingSyncState | undefined>(undefined);

  useEffect(() => {
    if (!canTrack || !jtJobId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tracking-sheet", { cache: "no-store" });
        if (!res.ok) return; // non-fatal — the button simply doesn't appear
        const b = await res.json();
        if (!alive) return;
        const hit = ((b.jobs ?? []) as { id: string; label: string; jtJobId: string; url: string }[]).find(
          (j) => j.jtJobId === jtJobId,
        );
        if (hit) setTarget({ projectId: hit.id, label: hit.label, url: hit.url });
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      alive = false;
    };
  }, [canTrack, jtJobId]);

  // A month change invalidates the result on screen — it describes another
  // billing period.
  useEffect(() => setState(undefined), [ym]);

  const start = useCallback(() => {
    if (!target) return;
    const [y, m] = ym.split("-").map(Number);
    runTrackingSync(target.projectId, m, y, setState);
  }, [target, ym]);

  if (!target) return null;
  return (
    <TrackingSheetSync
      state={state}
      onStart={start}
      monthLabel={monthLabel}
      className={className}
    />
  );
}
