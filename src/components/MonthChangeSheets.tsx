"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, Loading } from "@/components/ui";
import { runSheetOp } from "@/components/TrackingSheetSync";
import { monthLabel } from "@/lib/billingMonths";
import {
  MONTH_CLOSE_ACTION,
  MONTH_CLOSE_SCOPE,
  closeDue,
  planCopy,
  recordsLabel,
} from "@/lib/monthChangeSheets";

/**
 * Month close for the tracking sheets, asked from the ONE month picker (Home).
 * Rules and the reasoning: src/lib/monthChangeSheets.ts.
 *
 * Opened two ways by `HomeMasthead`:
 *   - the picker moves forward to `to` (`change` sets the billing month), or
 *   - Home already sits on `to` and the month before it is still open (the
 *     "Close <month>" chip; no `change`).
 *
 * It reads the sheets' state first. When nothing is due it changes the month
 * and shows nothing. When the month before `to` is still open it ASKS, and on
 * a yes runs, in this order:
 *
 *   1. The sheets' month is set to the closing month (op "setPeriod"), so the
 *      30-minute sync cannot write another month between the steps below.
 *   2. Per sheet: one that Close month already filed, or whose records already
 *      hold the month, is left alone. Otherwise the sheet is refreshed with the
 *      closing month's bills from JobTread (op "sync"), then CURRENT INVOICE
 *      is copied into the next free records block (op "finalize"). The refresh
 *      is what makes the record the right month, whatever the sheet showed.
 *   3. Only when every sheet has its records: month close is stamped, and the
 *      sheets move on to `to`.
 *   4. The billing month changes, when it has not already.
 *
 * A failed sheet stops before step 3: the sheets stay on the closing month and
 * the app keeps asking. "Not now" changes the billing month alone.
 *
 * Every sheet write goes through /api/tracking-sheet, which Apps Script
 * serves. Nothing here writes to JobTread.
 */
type RowState = "todo" | "running" | "done" | "kept" | "failed";
interface Row {
  id: string;
  label: string;
  state: RowState;
  note?: string;
}

type Phase = "loading" | "load-failed" | "ask" | "running" | "failed" | "changing";

const MARK: Record<RowState, string> = { todo: "", running: "…", done: "✓", kept: "–", failed: "✕" };

async function setSheetsMonth(ym: string): Promise<void> {
  const [year, month] = ym.split("-").map(Number);
  const res = await fetch("/api/tracking-sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "setPeriod", month, year }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || b?.ok === false) throw new Error(b?.error || `Request failed (${res.status})`);
}

/** The sheets' month and whether month close is stamped for the month before
 *  `homeYm`. Throws when the sheets cannot be read. Shared with HomeMasthead. */
export async function readCloseState(homeYm: string): Promise<{
  jobs: { id: string; label: string }[];
  sheetsYm: string;
  filed: Set<string>;
  /** The month still to close, or "". */
  due: string;
}> {
  const res = await fetch("/api/tracking-sheet", { cache: "no-store" });
  const b = await res.json();
  if (!res.ok) throw new Error(b?.error || `Request failed (${res.status})`);
  const jobs: { id: string; label: string }[] = b.jobs ?? [];
  const m = Number(b.defaultMonth);
  const y = Number(b.defaultYear);
  const sheetsYm = m && y ? `${y}-${String(m).padStart(2, "0")}` : "";
  const closing = closeDue(homeYm, sheetsYm, false);
  if (!closing || jobs.length === 0) return { jobs, sheetsYm, filed: new Set(), due: "" };

  const stamps = await fetch(`/api/month-actions?ym=${encodeURIComponent(closing)}`, { cache: "no-store" });
  if (!stamps.ok) throw new Error(`Could not read the month's stamps (${stamps.status}).`);
  const runs: { action: string; scope: string }[] = (await stamps.json()).runs ?? [];
  const closed = runs.some((r) => r.action === MONTH_CLOSE_ACTION && r.scope === MONTH_CLOSE_SCOPE);
  return {
    jobs,
    sheetsYm,
    filed: new Set(runs.filter((r) => r.action === "finalize").map((r) => r.scope)),
    due: closeDue(homeYm, sheetsYm, closed),
  };
}

export function MonthChangeSheets({
  to,
  change,
  onCancel,
}: {
  /** The month Home is on, or is moving to, "2026-11". */
  to: string;
  /** Sets the billing month and reloads; resolves with the error on a failure.
   *  Left out when Home already sits on `to`. */
  change?: () => Promise<string | null>;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  /** The month being closed: the month before `to`. */
  const [closing, setClosing] = useState("");
  const sheetsYm = useRef("");
  /** Sheets Close month (or the finalize op) already filed for `closing`. */
  const filed = useRef(new Set<string>());

  const finish = useCallback(async () => {
    setPhase("changing");
    if (!change) return window.location.reload();
    const why = await change();
    if (why) {
      setError(why);
      setPhase("failed");
    }
  }, [change]);

  const load = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      const s = await readCloseState(to);
      // Nothing to close: the month just changes. From the chip there is
      // nothing to do at all.
      if (!s.due) return change ? void finish() : onCancel();
      sheetsYm.current = s.sheetsYm;
      filed.current = s.filed;
      setClosing(s.due);
      setRows(s.jobs.map((j) => ({ id: j.id, label: j.label, state: "todo" })));
      setPhase("ask");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the tracking sheets.");
      setPhase("load-failed");
    }
  }, [to, change, finish, onCancel]);

  useEffect(() => {
    void load();
    // Read once per open: the dialog mounts fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mark = (id: string, state: RowState, note?: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state, note } : r)));

  const run = async () => {
    setPhase("running");
    setError("");
    const [cy, cm] = closing.split("-").map(Number);
    const block = recordsLabel(closing);
    try {
      // 1. Hold the sheets on the closing month while its records are written.
      if (sheetsYm.current !== closing) {
        await setSheetsMonth(closing);
        sheetsYm.current = closing;
      }
    } catch (e) {
      setError(`Could not set the sheets to ${monthLabel(closing)}: ${e instanceof Error ? e.message : "request failed"}`);
      return setPhase("failed");
    }

    // 2. A second run takes only the sheets the first one did not finish.
    const todo = rows.filter((r) => r.state === "todo" || r.state === "failed");
    const outcomes = await Promise.all(
      todo.map(async (r): Promise<boolean> => {
        try {
          if (filed.current.has(r.id)) {
            mark(r.id, "kept", "Close month already filed this month.");
            return true;
          }
          mark(r.id, "running");
          const dry = await runSheetOp(r.id, "finalize", cm, cy, { dryRun: true });
          if (planCopy(dry) === "keep") {
            mark(r.id, "kept", `Records already hold ${String(dry.monthLabel || block)}. Left as they are.`);
            return true;
          }
          await runSheetOp(r.id, "sync", cm, cy);
          const f = await runSheetOp(r.id, "finalize", cm, cy);
          filed.current.add(r.id);
          mark(r.id, "done", `Filed as ${String(f.monthLabel || block)} at ${String(f.targetRange || "")}.`);
          return true;
        } catch (e) {
          mark(r.id, "failed", e instanceof Error ? e.message : "Something went wrong.");
          return false;
        }
      }),
    );
    if (outcomes.includes(false)) return setPhase("failed");

    // 3. Every sheet has its records. Stamp the close, then move the sheets on.
    try {
      await fetch("/api/month-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: MONTH_CLOSE_ACTION, ym: closing }),
      });
      await setSheetsMonth(to);
      sheetsYm.current = to;
    } catch (e) {
      setError(
        `The records are filed, but the sheets could not move to ${monthLabel(to)}: ` +
          `${e instanceof Error ? e.message : "request failed"}`,
      );
      return setPhase("failed");
    }
    await finish();
  };

  // "Try again" after the sheets already moved on: only the month is left.
  const retry = () => (phase === "load-failed" ? load() : sheetsYm.current === to ? finish() : run());

  const busy = phase === "running" || phase === "changing" || phase === "loading";
  const closingLabel = closing ? monthLabel(closing) : "the month";

  const title =
    phase === "load-failed"
      ? "Could not read the tracking sheets"
      : phase === "failed"
        ? "Month close stopped"
        : phase === "loading"
          ? "Checking the tracking sheets"
          : `Run ${closingLabel} month close?`;

  const notNow = (
    <Button
      variant="secondary"
      className="min-h-11 w-full"
      disabled={busy}
      onClick={change ? finish : onCancel}
    >
      {change ? "Not now" : "Cancel"}
    </Button>
  );

  return (
    <Dialog
      busy={busy}
      onClose={onCancel}
      title={title}
      footer={
        phase === "loading" ? undefined : (
          <div className="grid w-full grid-cols-2 gap-2">
            {notNow}
            <Button className="min-h-11 w-full" disabled={busy} onClick={phase === "ask" ? run : retry}>
              {phase === "running"
                ? "Closing…"
                : phase === "changing"
                  ? "Finishing…"
                  : phase === "ask"
                    ? "Run month close"
                    : "Try again"}
            </Button>
          </div>
        )
      }
    >
      {phase === "loading" && <Loading label="Reading the tracking sheets…" />}

      {phase === "load-failed" && (
        <p className="text-sm">
          {error} Nothing was written.
          {change ? ` "Not now" changes the billing month and leaves every sheet as it is.` : ""}
        </p>
      )}

      {phase !== "loading" && phase !== "load-failed" && (
        <>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {closingLabel} is not closed on the tracking sheets. Month close files it into each sheet&apos;s
            records as &ldquo;{closing ? recordsLabel(closing) : ""}&rdquo;: the sheet gets {closingLabel}&apos;s
            bills from JobTread, then CURRENT INVOICE is copied. A sheet whose records already hold the month is
            left as it is. Then the sheets move to {monthLabel(to)}.
            {change ? ` "Not now" changes the billing month only, and the app asks again.` : ""}
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
              {error || `Some sheets were not filed. The sheets stay on ${closingLabel}, and the app keeps asking.`}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
