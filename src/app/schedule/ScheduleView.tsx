"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Banner, Button, EmptyState, Loading, Segmented } from "@/components/ui";
import { orgDay } from "@/lib/orgTime";
import type { TaskDocument } from "@/lib/jobtread/taskDocuments";
import { docTotals, money } from "@/lib/taskDocs";
import { patchTask } from "./patchTask";
import {
  WINDOWS,
  addDays,
  buildGantt,
  daysBetween,
  isWeekend,
  mondayOf,
  monthSpans,
  windowDays,
  type GanttBar,
  type GanttTaskIn,
  type WindowKey,
} from "@/lib/scheduleGantt";

interface Loaded {
  from: string;
  to: string;
  tasks: GanttTaskIn[];
  customers: Record<string, string>;
}

// A fixed set of job colours, read by dark text in both themes (as the Home
// week card does); jobs past the sixth reuse them.
const HUES = ["#7DB9DE", "#93CFA6", "#E8957A", "#C3B0E6", "#E6C36A", "#8FD3D1"];
/** Width of the job / task label column (rem). */
const LABEL_REM = 13;
/** Width of one day column (rem), so a window scrolls sideways on a phone. */
const DAY_REM = { "4w": 2.25, "12w": 0.9 } as const;

const dayLabel = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });

export interface ScheduleViewProps {
  /** Only this job's tasks (the bill popup). Omit for every job. */
  jobId?: string;
  /** The bills and estimates on each task, by task id; null/omitted draws no money. */
  links?: Record<string, TaskDocument[]> | null;
  /** A tap on a bar. */
  onPick: (a: { bar: GanttBar; hue: string; label: string }) => void;
  /** A task to outline (the one a bill is already linked to). */
  highlightTaskId?: string;
  /** The window the view opens on. */
  initialMode?: WindowKey;
  /** Drawn instead of the error banner when the read fails (a role without the view). */
  fallback?: ReactNode;
  /** Bars drag sideways to move a task in JobTread (a write). Off in the Link to Task popup. */
  canMove?: boolean;
  /** Bump to re-read the tasks (after an edit in the task dialog). */
  reloadKey?: number;
}

/**
 * The Gantt itself: window controls, month and day headings, a band per job,
 * a bar per task. Shared by the Schedule page and the "Link to Task" popup on a
 * bill (src/app/schedule/BillTaskLink.tsx). It owns only the window and the
 * read; what a tap does is the caller's.
 */
export function ScheduleView({
  jobId,
  links = null,
  onPick,
  highlightTaskId,
  initialMode = "4w",
  fallback,
  canMove = false,
  reloadKey = 0,
}: ScheduleViewProps) {
  const today = useMemo(() => orgDay(new Date().toISOString()), []);
  const [mode, setMode] = useState<WindowKey>(initialMode);
  const [start, setStart] = useState(() => mondayOf(today));
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const count = WINDOWS.find((w) => w.key === mode)!.days;
  const days = useMemo(() => windowDays(start, count), [start, count]);

  useEffect(() => {
    const stop = new AbortController();
    setData(null);
    setError("");
    const to = addDays(start, count - 1);
    fetch(
      `/api/schedule?from=${start}&to=${to}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`,
      { signal: stop.signal },
    )
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || j.error) return setError(j.error ?? "The schedule did not load.");
        setData(j as Loaded);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("The schedule did not load.");
      });
    return () => stop.abort();
  }, [start, count, jobId, reloadKey]);

  // A drag moves one bar by whole days. `drag.delta` draws it while the pointer
  // is down; on release the new dates go to JobTread (PATCH /api/home/week/task).
  const [drag, setDrag] = useState<{ id: string; delta: number } | null>(null);
  const dragRef = useRef<{ id: string; x: number; moved: boolean } | null>(null);
  const [moved, setMoved] = useState<{
    id: string;
    name: string;
    from: [string, string];
    to: [string, string];
  } | null>(null);
  const [moveError, setMoveError] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);

  const setDates = (id: string, s: string, e: string) =>
    setData((d) =>
      d
        ? {
            ...d,
            tasks: d.tasks.map((t) => (t.id === id ? { ...t, startDate: s, endDate: e } : t)),
          }
        : d,
    );

  /** Write the dates; on any failure put the old ones back. Returns true when saved. */
  async function saveDates(
    t: { id: string; name: string },
    from: [string, string],
    to: [string, string],
  ) {
    setMoveError("");
    setMoveBusy(true);
    setDates(t.id, to[0], to[1]);
    const r = await patchTask(t.id, { start: to[0], end: to[1] });
    setMoveBusy(false);
    if (r.error || r.previewed) {
      setDates(t.id, from[0], from[1]);
      setMoveError(r.error ?? "Writes are off. Nothing was saved.");
      return false;
    }
    return true;
  }

  async function commitMove(t: GanttTaskIn, delta: number) {
    const from: [string, string] = [t.startDate, t.endDate];
    const to: [string, string] = [addDays(t.startDate, delta), addDays(t.endDate, delta)];
    setMoved(null);
    if (await saveDates(t, from, to)) setMoved({ id: t.id, name: t.name, from, to });
  }

  async function undoMove() {
    if (!moved) return;
    const m = moved;
    setMoved(null);
    await saveDates({ id: m.id, name: m.name }, m.to, m.from);
  }

  const jobs = useMemo(
    () =>
      data ? buildGantt(data.tasks, new Map(Object.entries(data.customers)), start, count) : [],
    [data, start, count],
  );

  const dayW = DAY_REM[mode];
  const gridW = dayW * count;
  const todayIdx = daysBetween(start, today);
  const showToday = todayIdx >= 0 && todayIdx < count;
  const months = monthSpans(days);

  const step = (dir: 1 | -1) => setStart((s) => addDays(s, dir * (count === 28 ? 28 : 56)));

  if (error && fallback) return <>{fallback}</>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => step(-1)} aria-label="Earlier">
          ‹
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setStart(mondayOf(today))}>
          Today
        </Button>
        <Button variant="secondary" size="sm" onClick={() => step(1)} aria-label="Later">
          ›
        </Button>
        <span className="text-sm font-semibold tabular-nums">
          {dayLabel(days[0])} – {dayLabel(days[count - 1])}, {days[count - 1].slice(0, 4)}
        </span>
        <Segmented
          label="Window"
          className="ml-auto"
          value={mode}
          onChange={setMode}
          options={WINDOWS.map((w) => ({ value: w.key, label: w.label }))}
        />
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {moveError && <Banner tone="error">{moveError}</Banner>}
      {moved && (
        <Banner tone="success">
          <span className="flex flex-wrap items-center gap-2">
            Moved “{moved.name}” to {dayLabel(moved.to[0])} – {dayLabel(moved.to[1])} in JobTread.
            <Button variant="secondary" size="sm" onClick={undoMove}>
              Undo
            </Button>
          </span>
        </Banner>
      )}
      {!data && !error && <Loading label="Loading the schedule…" />}
      {data && jobs.length === 0 && <EmptyState>No open tasks in these weeks.</EmptyState>}

      {data && jobs.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line bg-white dark:bg-ink-raised">
          <div style={{ minWidth: `${LABEL_REM + gridW}rem` }}>
            {/* Month and day headings. */}
            <div className="flex border-b border-line-soft">
              <div
                className="sticky left-0 z-20 shrink-0 bg-white dark:bg-ink-raised"
                style={{ width: `${LABEL_REM}rem` }}
              />
              <div className="relative" style={{ width: `${gridW}rem` }}>
                <div className="flex">
                  {months.map((m) => (
                    <div
                      key={m.start}
                      className="truncate border-l border-line-soft px-1.5 py-1 text-[11px] font-semibold"
                      style={{ width: `${m.span * dayW}rem` }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
                <div className="flex">
                  {days.map((d) => (
                    <div
                      key={d}
                      className={`border-l border-line-soft py-0.5 text-center text-[10px] tabular-nums ${
                        d === today ? "font-semibold text-accent" : "text-neutral-500"
                      } ${isWeekend(d) ? "bg-neutral-50 dark:bg-white/[0.03]" : ""}`}
                      style={{ width: `${dayW}rem` }}
                    >
                      {mode === "4w" || new Date(d + "T00:00:00Z").getUTCDay() === 1
                        ? d.slice(8)
                        : ""}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {jobs.map((job, ji) => {
              const hue = HUES[ji % HUES.length];
              return (
                <section key={job.id} className="border-b border-line-soft last:border-b-0">
                  <div className="flex">
                    <div
                      className="sticky left-0 z-10 shrink-0 truncate bg-neutral-50 px-2 py-1.5 text-[13px] font-semibold dark:bg-ink"
                      style={{ width: `${LABEL_REM}rem` }}
                      title={job.label}
                    >
                      <span
                        aria-hidden
                        className="mr-1.5 inline-block h-2 w-2 rounded-full"
                        style={{ background: hue }}
                      />
                      {job.label}
                    </div>
                    <div className="flex-1 bg-neutral-50 dark:bg-ink" />
                  </div>
                  {job.bars.map((bar) => (
                    <div key={bar.task.id} className="flex">
                      <div
                        className="sticky left-0 z-10 shrink-0 truncate bg-white px-2 py-1 pl-5 text-[12px] dark:bg-ink-raised"
                        style={{ width: `${LABEL_REM}rem` }}
                        title={
                          bar.task.phase ? `${bar.task.phase}: ${bar.task.name}` : bar.task.name
                        }
                      >
                        {bar.task.name}
                        {(links?.[bar.task.id]?.length ?? 0) > 0 && (
                          <span className="ml-1.5 tabular-nums text-neutral-500">
                            {money(
                              docTotals(links![bar.task.id]).bills +
                                docTotals(links![bar.task.id]).estimates,
                            )}
                          </span>
                        )}
                      </div>
                      <div className="relative h-7" style={{ width: `${gridW}rem` }}>
                        {/* Weekend shading and the today rule sit behind the bar. */}
                        {days.map((d, i) =>
                          isWeekend(d) ? (
                            <span
                              key={d}
                              aria-hidden
                              className="absolute inset-y-0 bg-neutral-50 dark:bg-white/[0.03]"
                              style={{ left: `${i * dayW}rem`, width: `${dayW}rem` }}
                            />
                          ) : null,
                        )}
                        {showToday && (
                          <span
                            aria-hidden
                            className="absolute inset-y-0 w-px bg-accent"
                            style={{ left: `${(todayIdx + 0.5) * dayW}rem` }}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (dragRef.current?.moved) return; // the end of a drag, not a tap
                            onPick({ bar, hue, label: job.label });
                          }}
                          onPointerDown={
                            canMove && !moveBusy
                              ? (e) => {
                                  dragRef.current = { id: bar.task.id, x: e.clientX, moved: false };
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                }
                              : undefined
                          }
                          onPointerMove={
                            canMove
                              ? (e) => {
                                  const d = dragRef.current;
                                  if (!d || d.id !== bar.task.id) return;
                                  const rem =
                                    parseFloat(
                                      getComputedStyle(document.documentElement).fontSize,
                                    ) || 16;
                                  const delta = Math.round((e.clientX - d.x) / (dayW * rem));
                                  if (delta !== 0) d.moved = true;
                                  setDrag({ id: d.id, delta });
                                }
                              : undefined
                          }
                          onPointerUp={
                            canMove
                              ? () => {
                                  const d = dragRef.current;
                                  const delta = drag?.id === bar.task.id ? drag.delta : 0;
                                  setDrag(null);
                                  if (d?.moved && delta !== 0) void commitMove(bar.task, delta);
                                  // Let the click that follows this pointerup see `moved`, then clear it.
                                  setTimeout(() => (dragRef.current = null), 0);
                                }
                              : undefined
                          }
                          onPointerCancel={
                            canMove
                              ? () => {
                                  setDrag(null);
                                  dragRef.current = null;
                                }
                              : undefined
                          }
                          className={`absolute top-1 h-5 overflow-hidden border text-left ${bar.task.id === highlightTaskId ? "border-2 border-accent" : "border-black/10"} text-[11px] font-medium leading-5 text-neutral-900 transition hover:brightness-95 ${
                            bar.clipStart ? "rounded-l-none" : "rounded-l-inner"
                          } ${bar.clipEnd ? "rounded-r-none" : "rounded-r-inner"}`}
                          style={{
                            left: `${(bar.left / 100) * gridW}rem`,
                            width: `${(bar.width / 100) * gridW}rem`,
                            background: hue,
                            ...(canMove ? { touchAction: "pan-y", cursor: "grab" } : null),
                            ...(drag?.id === bar.task.id && drag.delta !== 0
                              ? {
                                  transform: `translateX(${drag.delta * dayW}rem)`,
                                  opacity: 0.8,
                                  zIndex: 5,
                                }
                              : null),
                          }}
                          aria-label={`${bar.task.name}, ${dayLabel(bar.task.startDate)} to ${dayLabel(bar.task.endDate)}`}
                        >
                          {bar.task.progress ? (
                            <span
                              aria-hidden
                              className="absolute inset-y-0 left-0 bg-black/15"
                              style={{ width: `${Math.min(100, bar.task.progress * 100)}%` }}
                            />
                          ) : null}
                          <span className="relative truncate px-1.5">{bar.task.name}</span>
                          {(links?.[bar.task.id]?.length ?? 0) > 0 && (
                            <span
                              aria-label={`${links![bar.task.id].length} bills or estimates attached`}
                              className="absolute right-0.5 top-0.5 h-4 min-w-4 rounded-pill bg-white/80 px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-neutral-900"
                            >
                              {links![bar.task.id].length}
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
