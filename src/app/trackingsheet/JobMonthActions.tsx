"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { DocumentAccessDialog } from "@/components/DocumentAccess";
import { LaborReportButton } from "@/components/LaborReportButton";
import {
  SyncOutcome,
  runTrackingSync,
  type TrackingSyncState,
  type TrackingTarget,
} from "@/components/TrackingSheetSync";
import type { MonthAction } from "@/lib/monthActions";

/**
 * The month-closing actions on each all-jobs card — Give Document Access,
 * Create Labor Report, Sync to Tracking Sheets — each with a stamp saying when
 * it last ran for the selected billing month. The stamps are written by the
 * actions' own routes (src/lib/monthActions.ts), so a run from the job
 * workbench stamps the card too.
 */

interface Run {
  action: MonthAction;
  scope: string;
  at: string;
  by: string;
  note: string;
}

/** The month's stamps and each job's tracking sheet, read once for every card. */
export function useMonthActions(ym: string) {
  const canTrack = useAccess().can("tracking-sheet");
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [targets, setTargets] = useState<Record<string, TrackingTarget>>({});
  // A slow answer for the month you just left must not paint this one.
  const current = useRef(ym);
  current.current = ym;

  const reload = useCallback(() => {
    fetch(`/api/month-actions?ym=${encodeURIComponent(ym)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (current.current === ym) setRuns(j.runs ?? []);
      })
      .catch(() => {}); // stamps are a convenience — the buttons still work
  }, [ym]);

  useEffect(() => {
    setRuns(null);
    reload();
  }, [reload]);

  useEffect(() => {
    if (!canTrack) return;
    fetch("/api/tracking-sheet", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((b) => {
        const byJob: Record<string, TrackingTarget> = {};
        for (const j of (b.jobs ?? []) as { id: string; label: string; jtJobId: string; url: string }[]) {
          if (j.jtJobId) byJob[j.jtJobId] = { projectId: j.id, label: j.label, url: j.url };
        }
        setTargets(byJob);
      })
      .catch(() => {}); // no sheet list, no sync button
  }, [canTrack]);

  /** The last run, null for never, undefined while the month is still loading. */
  const stamp = (action: MonthAction, scope: string): Run | null | undefined =>
    runs === null ? undefined : (runs.find((r) => r.action === action && r.scope === scope) ?? null);

  return { stamp, targetFor: (jobId: string) => targets[jobId], reload };
}

export type MonthActions = ReturnType<typeof useMonthActions>;

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One action: its button, and when it last ran this month. */
function ActionRow({
  run,
  detail,
  children,
}: {
  run: Run | null | undefined;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      {children}
      {run !== undefined && (
        <span
          title={run?.by ? `Run by ${run.by}` : undefined}
          className="text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400"
        >
          {run ? `✓ ${fmtWhen(run.at)}${detail ? ` · ${detail}` : ""}` : "Not run"}
        </span>
      )}
    </div>
  );
}

export function JobMonthActions({
  jobId,
  jobName,
  ym,
  monthLabel,
  actions,
}: {
  jobId: string;
  jobName: string;
  ym: string;
  monthLabel: string;
  actions: MonthActions;
}) {
  const canReport = useAccess().can("labor-review");
  const [accessOpen, setAccessOpen] = useState(false);
  const [sync, setSync] = useState<TrackingSyncState | undefined>(undefined);
  const target = actions.targetFor(jobId);
  const syncing = sync?.status === "queued" || sync?.status === "running";
  const access = actions.stamp("document-access", jobId);

  return (
    <div className="space-y-2 border-t border-line-soft pt-2">
      <ActionRow run={access} detail={access?.note}>
        <Button variant="secondary" size="sm" onClick={() => setAccessOpen(true)}>
          Give Document Access
        </Button>
      </ActionRow>

      {/* Company-wide, like the workbench's copy: every job's labor goes in,
          so its stamp reads the same on every card. */}
      {canReport && (
        <ActionRow run={actions.stamp("labor-report", "")} detail="all jobs">
          <LaborReportButton ym={ym} onDone={actions.reload} />
        </ActionRow>
      )}

      {target && (
        <div>
          <ActionRow run={actions.stamp("tracking-sync", target.projectId)}>
            <Button
              variant="secondary"
              size="sm"
              disabled={syncing}
              title={`Push ${monthLabel} into ${target.label}`}
              onClick={() => {
                const [y, m] = ym.split("-").map(Number);
                runTrackingSync(target.projectId, m, y, (s) => {
                  setSync(s);
                  if (s.status === "done") actions.reload();
                });
              }}
            >
              {syncing ? (
                <>
                  <Spinner className="mr-1.5" />
                  Syncing…
                </>
              ) : (
                "Sync to Tracking Sheets"
              )}
            </Button>
          </ActionRow>
          {sync && (
            <SyncOutcome status={sync.status} result={sync.result ?? null} error={sync.error ?? ""} />
          )}
        </div>
      )}

      {accessOpen && (
        <DocumentAccessDialog
          jobId={jobId}
          ym={ym}
          monthLabel={monthLabel}
          jobTitle={jobName}
          onClose={() => {
            setAccessOpen(false);
            actions.reload();
          }}
        />
      )}
    </div>
  );
}
