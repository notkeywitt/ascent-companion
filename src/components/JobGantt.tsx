"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { axisTicks, barPct, shortDate, type JobGanttData } from "@/lib/jobBoard";
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
 */

const pctLabel = (p: number | null) => (p === null ? "" : `${Math.round(p * 100)}% done`);

/** Label column + track, the one grid every row (and the scale) uses. */
const ROW = "grid grid-cols-[7rem_1fr] items-center gap-x-2 sm:grid-cols-[11rem_1fr]";

export function JobGantt({
  jobId,
  today = orgDay(new Date().toISOString()),
}: {
  jobId: string;
  /** Org-local "YYYY-MM-DD"; defaults to today in the JobTread org's zone. */
  today?: string;
}) {
  const [data, setData] = useState<JobGanttData | null | undefined>(undefined);

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

  if (data === undefined) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (!data) return null; // nothing dated in JobTread

  const ticks = axisTicks(data.start, data.end);
  const todayLeft = barPct(data.start, data.end, today, today).left;
  const inSpan = today >= data.start && today <= data.end;

  return (
    <figure className="m-0">
      <figcaption className="mb-1 flex items-baseline justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
        <span className="font-semibold uppercase tracking-wide">Schedule</span>
        <span className="tabular-nums">
          {shortDate(data.start)} – {shortDate(data.end)}
        </span>
      </figcaption>

      {/* Month scale. Absolute labels over the track column only, so a tick
          lines up with the bars under it. */}
      <div className={`${ROW} items-end`}>
        <span />
        <div className="relative h-4">
          {ticks.map((t) => (
            <span
              key={t.label + t.pct}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] text-neutral-400 dark:text-neutral-500"
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
                className={`truncate text-[11.5px] ${
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

      <p className="mt-1.5 text-[10.5px] text-neutral-400 dark:text-neutral-500">
        Each bar is a JobTread schedule phase; the fill is its progress. The line is today. A row
        opens that phase in JobTread.
      </p>
    </figure>
  );
}
