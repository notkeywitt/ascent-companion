"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Card, EmptyState, Loading, SectionLabel } from "@/components/ui";
import { timeAgo } from "@/lib/timeAgo";
import { money } from "@/lib/money";
import { shortMonth } from "@/lib/monthClose";
import { Sheet } from "@/components/Sheet";

/**
 * Sheet sync settings — a panel on the Jobs Hub (the Month tab's Company
 * tools, and a picked job's save menu). `SheetSyncButton` opens it.
 *
 * Since the month close (2026-11-14) it holds one control: pause or resume the
 * automatic sync that rewrites every wired sheet's SubVendor Invoices tab. The
 * held-month picker, the per-job month list and the manual Finalize button are
 * gone. The sheets' month moves only when the month closes (src/lib/monthClose.ts,
 * the chip on Home), and a job's sheet is filed by its own Close month.
 *
 * It still names a sheet wired to more than one job: the close skips those.
 */

interface JobRef {
  id: string;
  label: string;
}

/**
 * The automatic all-projects sync's state, from Apps Script's _tsSyncStatus().
 * `paused` is a Script Property, not a trigger change: the trigger keeps firing
 * and the run short-circuits, so resuming is instant and needs no reinstall.
 */
interface SyncStatus {
  paused: boolean;
  /** ISO stamp of when the pause was set. Empty while running. */
  pausedAt: string;
  note: string;
  /** False means nothing is scheduled at all — pausing would be moot. */
  triggerInstalled: boolean;
  intervalMinutes: number;
  lastRun: {
    at: string;
    jobCount: number;
    succeeded: number;
    failed: number;
    totalSynced: number;
  } | null;
}

/** A tracking sheet wired to more than one project — the close skips it until fixed. */
interface SharedSheet {
  fileId: string;
  projects: { projectId: string; label: string; row: number }[];
}

export function SheetSyncButton({
  className = "",
}: {
  /** Kept for the callers; the panel no longer acts on one job or month. */
  jtJobId?: string;
  ym?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => setOpen(true)}>
        Sheet sync settings
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Sheet sync settings">
        {open && <SheetSyncSettings />}
      </Sheet>
    </>
  );
}

function SheetSyncSettings() {
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [shared, setShared] = useState<SharedSheet[]>([]);
  const [sheetsYm, setSheetsYm] = useState("");
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState("");
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tracking-sheet", { cache: "no-store" });
        const b = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
        setJobs(b.jobs || []);
        setShared(b.shared || []);
        setSheetsYm(`${b.defaultYear}-${String(b.defaultMonth).padStart(2, "0")}`);
        setSync((b.sync as SyncStatus) || null);
      } catch (e) {
        if (alive) setBootError(e instanceof Error ? e.message : "Could not load the tracking sheets.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Pause or resume the automatic all-projects sync. Pausing freezes every
   * sheet where it is. Apps Script leaves the trigger installed and
   * short-circuits on a flag, so resuming takes effect on the next run.
   */
  const togglePause = useCallback(
    async (next: boolean) => {
      if (pausing) return;
      setPausing(true);
      setPauseError("");
      try {
        const res = await fetch("/api/tracking-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "setPaused", paused: next, note: next ? "Paused from the Assistant." : "" }),
        });
        const b = await res.json();
        if (!res.ok || b?.ok === false) throw new Error(b?.error || `Request failed (${res.status})`);
        // Apps Script echoes the status back, so the switch shows what it holds.
        if (b.sync) setSync(b.sync as SyncStatus);
        else setSync((cur) => (cur ? { ...cur, paused: next } : cur));
      } catch (e) {
        setPauseError(e instanceof Error ? e.message : "Could not change the sync.");
      } finally {
        setPausing(false);
      }
    },
    [pausing],
  );

  if (loading) return <Loading label="Loading tracking sheets…" />;

  return (
    <div>
      {bootError && (
        <Banner tone="error" className="mb-4">
          {bootError}
        </Banner>
      )}

      {shared.length > 0 && (
        <Banner tone="error" className="mb-4">
          <p className="font-semibold">
            {shared.length === 1 ? "A tracking sheet is" : `${shared.length} tracking sheets are`} wired to more
            than one job. The month close skips them.
          </p>
          <p className="mt-1">
            One job would overwrite the other&apos;s numbers. Clear the wrong job&apos;s{" "}
            <span className="font-semibold">Tracking Sheet</span> cell on the Projects sheet, then reload.
          </p>
          {shared.map((s) => (
            <ul key={s.fileId} className="mt-2 list-inside list-disc">
              {s.projects.map((p) => (
                <li key={p.projectId}>
                  {p.label} <span className="opacity-70">({p.projectId}, Projects row {p.row})</span>
                </li>
              ))}
            </ul>
          ))}
        </Banner>
      )}

      {!bootError && jobs.length === 0 && (
        <EmptyState>
          No project has a tracking sheet yet. Add its URL to the{" "}
          <span className="font-semibold">Tracking Sheet</span> column of the Projects sheet.
        </EmptyState>
      )}

      {jobs.length > 0 && (
        <Card className="mb-4">
          <SectionLabel className="mb-2">Automatic sync</SectionLabel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                  !sync?.triggerInstalled ? "bg-neutral-400" : sync.paused ? "bg-amber-500" : "bg-emerald-500"
                }`}
              />
              <div className="text-sm">
                <p className="font-semibold">
                  {!sync ? "Unknown" : !sync.triggerInstalled ? "Not scheduled" : sync.paused ? "Paused" : "Running"}
                </p>
                <p className="text-xs text-neutral-500">
                  {!sync ? (
                    "Could not read the sync's state."
                  ) : !sync.triggerInstalled ? (
                    <>
                      Nothing is scheduled. Run{" "}
                      <span className="font-mono">installAllTrackingSheetsSyncTrigger()</span> in Apps Script.
                    </>
                  ) : sync.paused ? (
                    <>No sheet has been rewritten{sync.pausedAt ? ` since ${timeAgo(sync.pausedAt)}` : ""}.</>
                  ) : (
                    <>Every sheet is rewritten every {sync.intervalMinutes} minutes.</>
                  )}
                </p>
              </div>
            </div>
            {sync && (
              <Button
                variant={sync.paused ? "primary" : "danger"}
                size="sm"
                disabled={pausing}
                onClick={() => togglePause(!sync.paused)}
              >
                {pausing ? (sync.paused ? "Resuming…" : "Pausing…") : sync.paused ? "Resume sync" : "Pause sync"}
              </Button>
            )}
          </div>

          {pauseError && (
            <Banner tone="error" className="mt-3">
              {pauseError}
            </Banner>
          )}

          {sync?.lastRun && (
            <p className="mt-3 text-xs text-neutral-500">
              Last automatic run {timeAgo(sync.lastRun.at)}: {sync.lastRun.succeeded}/{sync.lastRun.jobCount} job
              {sync.lastRun.jobCount === 1 ? "" : "s"}, {money(sync.lastRun.totalSynced)}
              {sync.lastRun.failed > 0 ? `, ${sync.lastRun.failed} failed` : ""}.
            </p>
          )}

          {sheetsYm && (
            <p className="mt-3 text-xs text-neutral-500">
              The sheets are on {shortMonth(sheetsYm)}. The month close moves them: the chip on Home shows how far it
              has got.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
