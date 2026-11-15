"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Segmented, Skeleton } from "@/components/ui";
import {
  GANTT_PX_PER_DAY,
  barPct,
  shortDate,
  spanDays,
  zoomTicks,
  type GanttZoom,
  type JobGanttData,
} from "@/lib/jobBoard";
import { jtScheduleUrl } from "@/lib/jtLinks";
import { orgDay } from "@/lib/orgTime";

/**
 * The job's Gantt chart — JobTread's own schedule phases as bars on one shared
 * timeline, with today marked.
 *
 * PHASES, NOT TASKS: the data behind it is `isGroup` tasks only (see
 * getJobGantt), so a job draws ~15 bars instead of ~110. The point of the chart
 * on a home board is "which phase are we in, and is it running late" — the leaf
 * task in flight is already named on the card's schedule line.
 *
 * EVERY BAR CARRIES ITS OWN PROGRESS as a fill, so the today line reads as the
 * answer: fill short of the line means the phase is behind. One rule for every
 * bar beats colouring past/present/future, which says less and needs a legend.
 *
 * Plain divs positioned in percentages rather than an SVG or a chart library:
 * the geometry is two numbers per bar (`barPct`), and CSS handles the theme,
 * the hairlines and the text for free.
 *
 * EVERY ROW IS A LINK to that phase on JobTread's own schedule
 * (`/jobs/<id>/schedule?taskId=<task>`), which is where it gets edited. The row
 * is an <a> carrying the same grid classes the <div> carried, and Tailwind's
 * preflight makes an anchor inherit its colour and decoration, so the chart
 * looks exactly as it did.
 *
 * ZOOM (Month / Week / Day): Month fits the whole schedule in the card. Week
 * and Day give every day a fixed width (`GANTT_PX_PER_DAY`), so the chart
 * scrolls sideways under sticky phase names and opens centred on today. The
 * choice is per device (localStorage).
 */

const pctLabel = (p: number | null) => (p === null ? "" : `${Math.round(p * 100)}% done`);

/**
 * Label column + track, the one grid every row (and the scale) uses. The label
 * width is a variable so the zoomed width below can add it in. No column gap:
 * the label carries its own right padding, so a bar scrolling under the sticky
 * label never shows through a gap.
 */
const ROW = "grid grid-cols-[var(--gl)_1fr] items-center";
/** The sticky label cell: stays put while a zoomed chart scrolls sideways. */
const STICKY = "sticky left-0 z-10 bg-white pr-2 dark:bg-ink-raised";

/** The zoom is a per-device choice, kept in localStorage like Home's donut view. */
const ZOOM_KEY = "jobGantt.zoom";
const ZOOMS: readonly { value: GanttZoom; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

export function JobGantt({
  jobId,
  today = orgDay(new Date().toISOString()),
}: {
  jobId: string;
  /** Org-local "YYYY-MM-DD"; defaults to today in the JobTread org's zone. */
  today?: string;
}) {
  const [data, setData] = useState<JobGanttData | null | undefined>(undefined);
  const [zoom, setZoom] = useState<GanttZoom>("month");
  const scroller = useRef<HTMLDivElement>(null);
  const labelCell = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(ZOOM_KEY);
      if (v === "week" || v === "day") setZoom(v);
    } catch {
      // storage blocked — Month stands.
    }
  }, []);
  const changeZoom = (z: GanttZoom) => {
    setZoom(z);
    try {
      localStorage.setItem(ZOOM_KEY, z);
    } catch {
      // storage blocked — the choice lasts until reload.
    }
  };

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    fetch(`/api/home/gantt?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j: { gantt?: JobGanttData | null }) => {
        if (!cancelled) setData(j.gantt ?? null);
      })
      .catch(() => {
        if (!cancelled) setData(null); // no chart is better than a broken one
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // A zoomed chart is wider than the card: bring today to the middle of the
  // view (or the start, when today is outside the schedule).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !data) return;
    const inSpan = today >= data.start && today <= data.end;
    if (zoom === "month" || !inSpan) {
      el.scrollLeft = 0;
      return;
    }
    const label = labelCell.current?.offsetWidth ?? 0;
    const track = el.scrollWidth - label;
    const at = (barPct(data.start, data.end, today, today).left / 100) * track;
    el.scrollLeft = Math.max(0, at - (el.clientWidth - label) / 2);
  }, [zoom, data, today]);

  if (data === undefined) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (!data) return null; // nothing dated in JobTread

  const ticks = zoomTicks(data.start, data.end, zoom);
  const todayLeft = barPct(data.start, data.end, today, today).left;
  const inSpan = today >= data.start && today <= data.end;
  const pxPerDay = GANTT_PX_PER_DAY[zoom];
  // Month fits the card. Week and day give each day a fixed width; never
  // narrower than the card, so a short job still fills it.
  const chartWidth = pxPerDay
    ? `max(100%, calc(var(--gl) + ${spanDays(data.start, data.end) * pxPerDay}px))`
    : undefined;
  // A day label sits inside its day; a month or week label centres on its line.
  const tickCls = zoom === "day" ? "pl-1" : "-translate-x-1/2";

  return (
    <figure className="m-0 [--gl:7rem] sm:[--gl:11rem]">
      <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400">
        <span className="font-semibold uppercase tracking-wide">Schedule</span>
        <span className="flex items-center gap-3">
          <span className="tabular-nums">
            {shortDate(data.start)} – {shortDate(data.end)}
          </span>
          <Segmented label="Schedule zoom" value={zoom} onChange={changeZoom} options={ZOOMS} />
        </span>
      </figcaption>

      <div ref={scroller} className="overflow-x-auto">
        <div style={{ width: chartWidth }}>
          {/* The scale. Absolute labels over the track column only, so a tick
              lines up with the bars under it. */}
          <div className={`${ROW} items-end`}>
            <span ref={labelCell} className={`${STICKY} h-4`} />
            <div className="relative h-4 overflow-hidden">
              {ticks.map((t) => (
                <span
                  key={t.label + t.pct}
                  className={`absolute top-0 whitespace-nowrap text-[10px] text-neutral-400 dark:text-neutral-500 ${tickCls}`}
                  style={{ left: `${t.pct}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          <div>
            {data.bars.map((b) => {
              const { left, width } = barPct(data.start, data.end, b.start, b.end);
              const fill = Math.min(1, Math.max(0, b.progress ?? 0));
              return (
                <a
                  key={b.id}
                  href={jtScheduleUrl(jobId, b.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${ROW} py-[2px]`}
                >
                  <span
                    className={`${STICKY} truncate text-[12px] ${
                      b.depth > 0
                        ? "pl-3 text-neutral-500 dark:text-neutral-400"
                        : "font-semibold text-neutral-700 dark:text-neutral-200"
                    }`}
                    title={b.name}
                  >
                    {b.name}
                  </span>
                  <div
                    className="relative h-3.5"
                    title={`${b.name} · ${shortDate(b.start)} – ${shortDate(b.end)}${
                      b.progress === null ? "" : ` · ${pctLabel(b.progress)}`
                    }`}
                  >
                    {/* Today, drawn per row: the rows abut, so the segments read as
                        one line down the chart. */}
                    {inSpan && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 w-px bg-accent/50"
                        style={{ left: `${todayLeft}%` }}
                      />
                    )}
                    <div
                      className="absolute inset-y-0 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10"
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: 3 }}
                    >
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${fill * 100}%` }}
                      />
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
        Each bar is a JobTread schedule phase; the fill is its progress. The line is today. A row
        opens that phase in JobTread. Week and Day widen the chart; swipe it sideways.
      </p>
    </figure>
  );
}
