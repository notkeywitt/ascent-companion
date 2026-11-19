"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, Dialog, EmptyState, Loading, PageHeader, Segmented } from "@/components/ui";
import { orgDay } from "@/lib/orgTime";
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
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

export function ScheduleClient() {
  const today = useMemo(() => orgDay(new Date().toISOString()), []);
  const [mode, setMode] = useState<WindowKey>("4w");
  const [start, setStart] = useState(() => mondayOf(today));
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<{ bar: GanttBar; hue: string; label: string } | null>(null);

  const count = WINDOWS.find((w) => w.key === mode)!.days;
  const days = useMemo(() => windowDays(start, count), [start, count]);

  useEffect(() => {
    const stop = new AbortController();
    setData(null);
    setError("");
    const to = addDays(start, count - 1);
    fetch(`/api/schedule?from=${start}&to=${to}`, { signal: stop.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || j.error) return setError(j.error ?? "The schedule did not load.");
        setData(j as Loaded);
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("The schedule did not load.");
      });
    return () => stop.abort();
  }, [start, count]);

  const jobs = useMemo(
    () => (data ? buildGantt(data.tasks, new Map(Object.entries(data.customers)), start, count) : []),
    [data, start, count],
  );

  const dayW = DAY_REM[mode];
  const gridW = dayW * count;
  const todayIdx = daysBetween(start, today);
  const showToday = todayIdx >= 0 && todayIdx < count;
  const months = monthSpans(days);

  const step = (dir: 1 | -1) => setStart((s) => addDays(s, dir * (count === 28 ? 28 : 56)));

  return (
    <main className="w-full px-4 pad:px-7 pb-24 pt-6">
      <PageHeader
        title="Schedule"
        description="Every open task on every job, from JobTread. Tap a bar for its details."
        className="!mb-3"
      />

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
      {!data && !error && <Loading label="Loading the schedule…" />}
      {data && jobs.length === 0 && <EmptyState>No open tasks in these weeks.</EmptyState>}

      {data && jobs.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white dark:bg-ink-raised">
          <div style={{ minWidth: `${LABEL_REM + gridW}rem` }}>
            {/* Month and day headings. */}
            <div className="flex border-b border-line-soft">
              <div className="sticky left-0 z-20 shrink-0 bg-white dark:bg-ink-raised" style={{ width: `${LABEL_REM}rem` }} />
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
                      {mode === "4w" || new Date(d + "T00:00:00Z").getUTCDay() === 1 ? d.slice(8) : ""}
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
                      <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: hue }} />
                      {job.label}
                    </div>
                    <div className="flex-1 bg-neutral-50 dark:bg-ink" />
                  </div>
                  {job.bars.map((bar) => (
                    <div key={bar.task.id} className="flex">
                      <div
                        className="sticky left-0 z-10 shrink-0 truncate bg-white px-2 py-1 pl-5 text-[12px] dark:bg-ink-raised"
                        style={{ width: `${LABEL_REM}rem` }}
                        title={bar.task.phase ? `${bar.task.phase}: ${bar.task.name}` : bar.task.name}
                      >
                        {bar.task.name}
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
                          onClick={() => setPick({ bar, hue, label: job.label })}
                          className={`absolute top-1 h-5 overflow-hidden border border-black/10 text-left text-[11px] font-medium leading-5 text-neutral-900 transition hover:brightness-95 ${
                            bar.clipStart ? "rounded-l-none" : "rounded-l-md"
                          } ${bar.clipEnd ? "rounded-r-none" : "rounded-r-md"}`}
                          style={{
                            left: `${(bar.left / 100) * gridW}rem`,
                            width: `${(bar.width / 100) * gridW}rem`,
                            background: hue,
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

      {pick && (
        <Dialog onClose={() => setPick(null)} title={pick.bar.task.name} description={pick.label}>
          <dl className="space-y-2 text-sm">
            {pick.bar.task.phase && <Row k="Phase" v={pick.bar.task.phase} />}
            <Row k="Dates" v={`${dayLabel(pick.bar.task.startDate)} – ${dayLabel(pick.bar.task.endDate)}`} />
            {(pick.bar.task.startTime || pick.bar.task.endTime) && (
              <Row k="Time" v={[pick.bar.task.startTime, pick.bar.task.endTime].filter(Boolean).join(" – ")} />
            )}
            {pick.bar.task.taskTypeName && <Row k="Type" v={pick.bar.task.taskTypeName} />}
            <Row
              k="Progress"
              v={pick.bar.task.progress === null ? "Not started" : `${Math.round(pick.bar.task.progress * 100)}%`}
            />
            {pick.bar.task.description && <Row k="Notes" v={pick.bar.task.description} />}
          </dl>
        </Dialog>
      )}
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-neutral-500">{k}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap">{v}</dd>
    </div>
  );
}
