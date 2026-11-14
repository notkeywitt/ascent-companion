"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, Loading } from "@/components/ui";
import { runSheetOp } from "@/components/TrackingSheetSync";
import { monthLabel } from "@/lib/billingMonths";
import {
  planCopy,
  recordsLabel,
  sheetsHoldAnotherMonth,
  syncIsRunning,
  type SheetSyncState,
} from "@/lib/monthChangeSheets";

/**
 * The home billing month moves to a later month: that closes the month it
 * leaves. Before anything moves, each wired tracking sheet's CURRENT INVOICE
 * is copied into its records (the reserved month block), so the month's
 * figures are kept when the sheets go on to the next month.
 *
 * Order, and it is the whole point:
 *   1. Copy, per sheet (rules in src/lib/monthChangeSheets.ts):
 *        - a sheet "Close month" already filed for this month is left alone;
 *        - a sheet that already has a block holding this month's figures is
 *          left alone, so the copy never replaces records;
 *        - otherwise CURRENT INVOICE goes into the next free block. While the
 *          automatic sync runs, the sheet is refreshed from JobTread first
 *          (the write the timer makes anyway). While it is paused, the sheet
 *          is copied as it stands.
 *   2. Only when every sheet is copied or already has its records: the sheets'
 *      held month moves to the new month (op "setPeriod").
 *   3. Then the billing month changes (`onChange`).
 *
 * A failed copy stops before step 2. "Change month only" then moves the
 * billing month and leaves the sheets held where they are, so no sheet is
 * rewritten with a new month before its records exist.
 *
 * Every write goes through /api/tracking-sheet, which Apps Script serves.
 * Nothing here writes to JobTread.
 */
type RowState = "todo" | "running" | "done" | "kept" | "failed";
interface Row {
  id: string;
  label: string;
  state: RowState;
  note?: string;
}

type Phase = "loading" | "load-failed" | "wrong-month" | "ready" | "running" | "failed" | "changing";

const MARK: Record<RowState, string> = { todo: "", running: "…", done: "✓", kept: "–", failed: "✕" };

export function MonthChangeSheets({
  from,
  to,
  onCancel,
  onChange,
}: {
  /** The billing month being closed, "2026-10". */
  from: string;
  /** The month the selector moves to. */
  to: string;
  onCancel: () => void;
  /** Sets the billing month and reloads. Resolves with the error on a failure. */
  onChange: () => Promise<string | null>;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [heldYm, setHeldYm] = useState("");
  const [running, setRunning] = useState(false);
  /** Sheets "Close month" or the finalize op already filed for `from`. */
  const filed = useRef(new Set<string>());

  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const block = recordsLabel(from);

  const change = useCallback(async () => {
    setPhase("changing");
    const why = await onChange();
    if (why) {
      setError(why);
      setPhase("failed");
    }
  }, [onChange]);

  const load = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      const res = await fetch("/api/tracking-sheet", { cache: "no-store" });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
      const jobs: { id: string; label: string }[] = b.jobs ?? [];
      // No wired sheet: there is nothing to copy and nothing to hold.
      if (jobs.length === 0) return void change();

      const stamps = await fetch(`/api/month-actions?ym=${encodeURIComponent(from)}`, { cache: "no-store" });
      const runs: { action: string; scope: string }[] = stamps.ok ? ((await stamps.json()).runs ?? []) : [];
      filed.current = new Set(runs.filter((r) => r.action === "finalize").map((r) => r.scope));

      const m = Number(b.defaultMonth);
      const y = Number(b.defaultYear);
      const held = m && y ? `${y}-${String(m).padStart(2, "0")}` : "";
      const sync = (b.sync ?? null) as SheetSyncState | null;
      setHeldYm(held);
      setRunning(syncIsRunning(sync));
      setRows(jobs.map((j) => ({ id: j.id, label: j.label, state: "todo" })));
      setPhase(sheetsHoldAnotherMonth(sync, held, from) ? "wrong-month" : "ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the tracking sheets.");
      setPhase("load-failed");
    }
  }, [from, change]);

  useEffect(() => {
    void load();
    // Read once per open: the dialog mounts fresh for each month change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mark = (id: string, state: RowState, note?: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state, note } : r)));

  const run = async () => {
    setPhase("running");
    setError("");
    // A second run takes only the sheets the first one did not finish.
    const todo = rows.filter((r) => r.state === "todo" || r.state === "failed");
    const outcomes = await Promise.all(
      todo.map(async (r): Promise<boolean> => {
        try {
          if (filed.current.has(r.id)) {
            mark(r.id, "kept", "Close month already filed this month.");
            return true;
          }
          mark(r.id, "running");
          const dry = await runSheetOp(r.id, "finalize", fm, fy, { dryRun: true });
          if (planCopy(dry) === "keep") {
            mark(r.id, "kept", `Already has a ${String(dry.monthLabel || block)} block. Left as it is.`);
            return true;
          }
          if (running) await runSheetOp(r.id, "sync", fm, fy);
          const f = await runSheetOp(r.id, "finalize", fm, fy);
          filed.current.add(r.id);
          mark(r.id, "done", `Copied to ${String(f.monthLabel || block)} at ${String(f.targetRange || "")}.`);
          return true;
        } catch (e) {
          mark(r.id, "failed", e instanceof Error ? e.message : "Something went wrong.");
          return false;
        }
      }),
    );
    if (outcomes.includes(false)) return setPhase("failed");

    // Every sheet has its records. Only now may the sheets move on.
    if (heldYm !== to) {
      try {
        const res = await fetch("/api/tracking-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "setPeriod", month: tm, year: ty }),
        });
        const b = await res.json();
        if (!res.ok || b?.ok === false) throw new Error(b?.error || `Request failed (${res.status})`);
        setHeldYm(to);
      } catch (e) {
        setError(
          `The records are copied, but the sheets could not move to ${monthLabel(to)}: ` +
            `${e instanceof Error ? e.message : "request failed"}`,
        );
        return setPhase("failed");
      }
    }
    await change();
  };

  const busy = phase === "running" || phase === "changing" || phase === "loading";
  const heldLabel = heldYm ? monthLabel(heldYm) : "the month they hold now";

  const title =
    phase === "failed" || phase === "load-failed"
      ? "The billing month has not changed"
      : phase === "wrong-month"
        ? `The sheets are on ${heldLabel}`
        : `Change the billing month to ${monthLabel(to)}?`;

  const cancel = (
    <Button variant="secondary" className="min-h-11 w-full" onClick={onCancel} disabled={busy}>
      Cancel
    </Button>
  );
  const monthOnly = (
    <Button variant="secondary" className="min-h-11 w-full" onClick={change} disabled={busy}>
      Change month only
    </Button>
  );

  return (
    <Dialog
      busy={busy}
      onClose={onCancel}
      title={title}
      footer={
        phase === "ready" || phase === "running" || phase === "changing" ? (
          <div className="grid w-full grid-cols-2 gap-2">
            {cancel}
            <Button className="min-h-11 w-full" onClick={run} disabled={busy}>
              {phase === "running" ? "Copying…" : phase === "changing" ? "Changing…" : "Copy and change month"}
            </Button>
          </div>
        ) : phase === "loading" ? (
          <div className="grid w-full grid-cols-2 gap-2">{cancel}</div>
        ) : (
          <div className="grid w-full grid-cols-3 gap-2">
            {cancel}
            {monthOnly}
            {phase === "wrong-month" ? (
              <span />
            ) : (
              <Button className="min-h-11 w-full" onClick={phase === "load-failed" ? load : run}>
                Try again
              </Button>
            )}
          </div>
        )
      }
    >
      {phase === "loading" && <Loading label="Reading the tracking sheets…" />}

      {phase === "load-failed" && (
        <p className="text-sm">
          Could not read the tracking sheets, so nothing was copied: {error} &ldquo;Change month only&rdquo;
          moves the billing month and leaves every sheet as it is.
        </p>
      )}

      {phase === "wrong-month" && (
        <p className="text-sm">
          The automatic sync holds every sheet on {heldLabel}, not {monthLabel(from)}. Nothing was copied:
          CURRENT INVOICE does not show {monthLabel(from)}. Set the sheets&apos; month in Sheet sync settings
          on the Jobs page, then change the month here. &ldquo;Change month only&rdquo; moves the billing
          month and leaves every sheet as it is.
        </p>
      )}

      {(phase === "ready" || phase === "running" || phase === "changing" || phase === "failed") && (
        <>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            This closes {monthLabel(from)}. First, each tracking sheet&apos;s CURRENT INVOICE is copied into
            its records as &ldquo;{block}&rdquo;.{" "}
            {running
              ? "Each sheet is refreshed from JobTread before its copy."
              : "The automatic sync is paused, so each sheet is copied as it stands."}{" "}
            A sheet that already has that block is left as it is. Then the sheets move to {monthLabel(to)}.
          </p>
          <ol className="mt-3 max-h-64 space-y-1.5 overflow-y-auto text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex gap-2">
                <span aria-hidden className="w-4 shrink-0 text-center tabular-nums">
                  {MARK[r.state]}
                </span>
                <span className={r.state === "todo" ? "text-neutral-400" : r.state === "failed" ? "text-danger" : ""}>
                  {r.label}
                  {r.note && (
                    <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">{r.note}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {phase === "failed" && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error ||
                `Some sheets were not copied. The sheets stay on ${heldLabel}. ` +
                  `"Change month only" moves the billing month and leaves them there.`}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
