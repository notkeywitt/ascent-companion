"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Spinner } from "@/components/Spinner";

/**
 * Moving a bill between jobs, run in the BACKGROUND.
 *
 * JobTread can't move a bill, so Apps Script voids the old document and
 * recreates it on the target job (see /api/reassign-job). That chain is several
 * sequential JobTread round trips and routinely takes 30-90 seconds — long
 * enough that holding a page hostage to it is the wrong shape.
 *
 * So the request is owned HERE, by a provider mounted in the root layout,
 * instead of by the page that started it. Two consequences, both wanted:
 *   - the caller can close its drawer, open another bill, or navigate away the
 *     moment it hands the move over; the fetch is not tied to that component.
 *   - the progress banner is app chrome, so the move stays visible wherever the
 *     user goes next.
 *
 * A HARD reload (or closing the tab) does kill the in-flight fetch, and with it
 * this banner — but not the move: the API route runs to completion server-side
 * either way. The banner is the report, not the work.
 * ponytail: no cross-reload resume; add a poll on the old docId's status
 * (a completed move leaves it "denied") if losing the banner proves confusing.
 */

export interface BillMoveRequest {
  /** The bill being moved — its CURRENT (soon to be voided) JobTread doc id. */
  docId: string;
  /** Target JobTread job id. */
  jobId: string;
  /** Human label for the target job, for the banner and the result line. */
  jobLabel: string;
}

type MoveState = "running" | "done" | "error";

interface Move extends BillMoveRequest {
  state: MoveState;
  msg: string;
}

interface BillMoveCtx {
  /** Hand a move over. Returns at once — the fetch outlives the caller. */
  start: (req: BillMoveRequest) => void;
  /** Is a move in flight for this bill? Callers use it to lock their own UI. */
  isMoving: (docId: string) => boolean;
}

const Ctx = createContext<BillMoveCtx>({
  start: () => {},
  isMoving: () => false,
});

export function useBillMove() {
  return useContext(Ctx);
}

export function BillMoveProvider({ children }: { children: ReactNode }) {
  const [moves, setMoves] = useState<Move[]>([]);

  const dismiss = useCallback((docId: string) => {
    setMoves((m) => m.filter((x) => x.docId !== docId));
  }, []);

  const start = useCallback((req: BillMoveRequest) => {
    let already = false;
    setMoves((m) => {
      already = m.some((x) => x.docId === req.docId && x.state === "running");
      if (already) return m;
      return [
        ...m.filter((x) => x.docId !== req.docId),
        { ...req, state: "running" as MoveState, msg: "" },
      ];
    });
    if (already) return;

    void (async () => {
      let state: MoveState = "done";
      let msg = `Moved to ${req.jobLabel}.`;
      try {
        const res = await fetch("/api/reassign-job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId: req.docId, jobId: req.jobId }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          state = "error";
          msg = json.error ?? "Reassign failed";
        }
      } catch (e) {
        state = "error";
        msg = e instanceof Error ? e.message : "Network error";
      }
      setMoves((m) => m.map((x) => (x.docId === req.docId ? { ...x, state, msg } : x)));
      // Success clears itself. A FAILURE stays until dismissed — the bill is
      // still sitting on the old job and somebody has to know.
      if (state === "done") window.setTimeout(() => dismiss(req.docId), 8000);
    })();
  }, [dismiss]);

  const value = useMemo<BillMoveCtx>(
    () => ({
      start,
      isMoving: (docId: string) =>
        moves.some((x) => x.docId === docId && x.state === "running"),
    }),
    [moves, start],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <BillMoveBanner moves={moves} onDismiss={dismiss} />
    </Ctx.Provider>
  );
}

/**
 * The indicator. Fixed to the TOP of the viewport, not the bottom: three pages
 * already dock a StickyActionBar at `--tabbar-h`, and a move must not hide the
 * button the user is reaching for.
 */
function BillMoveBanner({
  moves,
  onDismiss,
}: {
  moves: Move[];
  onDismiss: (docId: string) => void;
}) {
  if (moves.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex flex-col items-center gap-2 px-3"
      role="status"
      aria-live="polite"
    >
      {moves.map((m) => (
        <div
          key={m.docId}
          className={`pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur ${
            m.state === "error"
              ? "border-red-300 bg-red-50/95 text-red-800 dark:border-red-900 dark:bg-red-950/90 dark:text-red-200"
              : "border-line bg-white/95 dark:bg-ink-raised/95"
          }`}
        >
          {m.state === "running" ? (
            <Spinner />
          ) : (
            <span aria-hidden className="shrink-0 font-semibold">
              {m.state === "error" ? "⚠" : "✓"}
            </span>
          )}
          <span className="min-w-0 flex-1">
            {m.state === "running" ? (
              <>
                <b>Moving this bill to {m.jobLabel}…</b> JobTread has to void and
                recreate it, so this takes a minute. Keep working — it finishes on
                its own.
              </>
            ) : (
              m.msg
            )}
          </span>
          {m.state !== "running" && (
            <button
              type="button"
              onClick={() => onDismiss(m.docId)}
              aria-label="Dismiss"
              className="shrink-0 rounded px-1 text-sm leading-none opacity-60 transition hover:opacity-100"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
