"use client";

import { timeAgo } from "@/lib/timeAgo";

/**
 * "Synced 12 minutes ago (every 30 min) · Sync now" — the line that stands
 * where a run-it button used to (OVERHAUL_PLAN Phase 6). Every job this line
 * describes already runs on a timer; what the office needs is when it last
 * ran and a retry, not a button it has to remember to press.
 *
 * `at` undefined = still reading the stamp; null = no stamp known (the timer
 * side does not record one yet, or the read failed) — the retry still shows.
 */
export function LastRun({
  verb,
  at,
  every,
  retry,
  onRetry,
  busy,
  busyLabel,
  detail,
  error,
  quiet,
  className = "",
}: {
  /** Replaces the whole sentence, for a line with no time to give ("The timer
   *  is on September, not this month."). The retry still shows. */
  quiet?: string;
  /** Past tense, capitalised: "Synced", "Checked for bills", "Updated". */
  verb: string;
  at: string | null | undefined;
  /** "every 30 min", "hourly" — left out when the host has no timer to name. */
  every?: string;
  /** The retry link's label: "Sync now", "Check now". */
  retry: string;
  onRetry: () => void;
  busy?: boolean;
  busyLabel?: string;
  /** Inline, after the stamp: a result line, a count. */
  detail?: React.ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className={`text-[12px] text-neutral-500 dark:text-neutral-400 ${className}`}>
      <span>
        {quiet ? (
          quiet
        ) : (
          <>
            {verb} {at === undefined ? "…" : at ? timeAgo(at) : "— no run recorded"}
            {every ? ` (${every})` : ""}
          </>
        )}
      </span>
      {" · "}
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="text-accent underline disabled:no-underline disabled:opacity-60"
      >
        {busy ? (busyLabel ?? "Running…") : retry}
      </button>
      {detail && <span className="ml-2">{detail}</span>}
      {error && (
        <span role="alert" className="ml-2 text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
