"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { EmptyState, MetaLine } from "@/components/ui";
import { hubHref } from "@/lib/hubUrl";
import { busiestOn, nearness, type WeekActivity, type WeekJob } from "@/lib/weekActivity";

/**
 * HOME'S WEEK BARS (owner, 2026-11-15; "Bars 3 · Focus" of the round-6
 * drawings). One row per job, one column per day, Sunday to Saturday. A bar's
 * height is how much is on that job that day: open schedule tasks plus to-dos
 * due (src/lib/weekActivity.ts).
 *
 * It changes only because time passes. Today's column is lit and full
 * strength; every other day draws as strong as it is near (`nearness`), so
 * tomorrow sharpens through the afternoon and yesterday fades. The rule under
 * the day letters fills with the week. The clock ticks once a minute; nothing
 * loops.
 *
 *   Tap a day  → that day's schedule summary, in a sheet.
 *   Tap a bar  → the job's Schedule tab on the Jobs page.
 *
 * Data: /api/home/week (the `home` view). It reloads when the day turns over.
 */

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const ROWS = 6;

/** Days since this week's Sunday 00:00, local time: Wednesday 3 PM is 3.625. */
function weekTime(sunday: string): number {
  const start = new Date(+sunday.slice(0, 4), +sunday.slice(5, 7) - 1, +sunday.slice(8, 10)).getTime();
  return (Date.now() - start) / 86_400_000;
}

const dayLabel = (d: string, weekday: "short" | "long" = "long") =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday, month: "short", day: "numeric", timeZone: "UTC" });

const counts = (items: WeekJob["days"][number]) => {
  const tasks = items.filter((i) => i.kind === "task").length;
  const todos = items.length - tasks;
  return [tasks && `${tasks} ${tasks === 1 ? "task" : "tasks"}`, todos && `${todos} ${todos === 1 ? "to-do" : "to-dos"}`]
    .filter(Boolean)
    .join(", ");
};

const scheduleHref = (jobId: string) => hubHref(jobId, null, { tab: "schedule" });

export function WeekBars() {
  const [data, setData] = useState<WeekActivity | null>(null);
  const [failed, setFailed] = useState(false);
  const [t, setT] = useState(0);
  const [grown, setGrown] = useState(false);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const stop = new AbortController();
    fetch("/api/home/week", { signal: stop.signal })
      .then((r) => r.json())
      .then((d: WeekActivity & { error?: string }) => {
        if (d.error) return setFailed(true);
        setData(d);
        setT(weekTime(d.dates[0]));
      })
      .catch(() => {});
    return () => stop.abort();
  }, [reload]);

  // The clock: once a minute. A new day reloads, since to-dos and tasks move.
  useEffect(() => {
    if (!data) return;
    const loadedDay = data.dates.indexOf(data.today);
    const id = setInterval(() => {
      const now = weekTime(data.dates[0]);
      setT(now);
      if (Math.floor(now) !== loadedDay) setReload((n) => n + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, [data]);

  // The bars grow in once, on the first frame after the data lands.
  useEffect(() => {
    if (!data) return;
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, [data]);

  if (failed) return <p className="text-[12px] text-neutral-500">The week did not load.</p>;
  if (!data) return <div className="h-48" aria-hidden />;

  const today = Math.max(0, Math.min(6, Math.floor(t)));
  const jobs = data.jobs.slice(0, ROWS);
  const hidden = data.jobs.length - jobs.length;
  const max = Math.max(1, ...data.jobs.flatMap((j) => j.days.map((d) => d.length)));
  const lead = busiestOn(data.jobs, today);
  const lit = (i: number) => (i === today ? "bg-accent/10" : "");

  return (
    <div className="flex flex-col gap-2">
      <div className="min-h-[2.5rem]">
        {lead ? (
          <>
            <div className="truncate text-lg font-semibold tracking-tight">{lead.name}</div>
            <div className="text-[12px] tabular-nums text-neutral-500">
              Busiest today: {counts(lead.days[today])}
              {data.jobs[0] && data.jobs[0].id !== lead.id && ` · This week: ${data.jobs[0].name}`}
            </div>
          </>
        ) : (
          <div className="text-[12px] text-neutral-500">Nothing on the schedule today.</div>
        )}
      </div>

      {data.jobs.length === 0 ? (
        <EmptyState>Nothing on the schedule this week.</EmptyState>
      ) : (
        <div
          className="grid items-end gap-x-[3px] text-[11px] tabular-nums"
          style={{ gridTemplateColumns: "minmax(0,6.5rem) repeat(7,minmax(0,1fr)) 1.75rem" }}
        >
          {/* The day row: each day opens its schedule summary. */}
          <span />
          {data.dates.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => setOpenDay(i)}
              aria-label={`${dayLabel(d)}: schedule summary`}
              className={`flex min-h-11 flex-col items-center justify-end rounded-t-md pb-1 transition-colors hover:bg-neutral-100 dark:hover:bg-ink-overlay ${lit(i)} ${
                i === today ? "font-bold text-neutral-900 dark:text-neutral-100" : "text-neutral-500"
              }`}
            >
              <span>{LETTERS[i]}</span>
              <span className="text-[10px] font-normal opacity-70">{+d.slice(8, 10)}</span>
            </button>
          ))}
          <span />

          {/* The week so far: a rule that fills as the week passes. */}
          <span />
          <span className="relative col-span-7 mb-1 h-0.5 overflow-hidden rounded-full bg-line">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-700"
              style={{ width: `${Math.min(100, (t / 7) * 100)}%` }}
            />
          </span>
          <span />

          {jobs.map((j, r) => (
            <JobRow key={j.id} job={j} max={max} t={t} today={today} grown={grown} lead={j.id === lead?.id} last={r === jobs.length - 1} lit={lit} />
          ))}
        </div>
      )}

      {hidden > 0 && <div className="text-[11px] text-neutral-500">{hidden} more in each day&apos;s summary</div>}

      <Sheet
        open={openDay !== null}
        onClose={() => setOpenDay(null)}
        title={openDay !== null ? dayLabel(data.dates[openDay]) : ""}
      >
        {openDay !== null && <DaySummary jobs={data.jobs} day={openDay} />}
      </Sheet>
    </div>
  );
}

function JobRow({
  job,
  max,
  t,
  today,
  grown,
  lead,
  last,
  lit,
}: {
  job: WeekJob;
  max: number;
  t: number;
  today: number;
  grown: boolean;
  lead: boolean;
  last: boolean;
  lit: (i: number) => string;
}) {
  return (
    <>
      <Link
        href={scheduleHref(job.id)}
        className={`flex h-10 items-center justify-end truncate pr-2 text-right ${
          lead ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-500"
        }`}
      >
        <span className="truncate">{job.name}</span>
      </Link>
      {job.days.map((items, i) => {
        const n = items.length;
        const cell = `flex h-10 items-end justify-center border-b border-line-soft ${lit(i)} ${last && i === today ? "rounded-b-md" : ""}`;
        if (!n) return <span key={i} className={cell} />;
        return (
          <Link
            key={i}
            href={scheduleHref(job.id)}
            aria-label={`${job.name}: ${counts(items)}. Open its schedule.`}
            className={cell}
          >
            <span
              className={`block w-[62%] rounded-t-[2px] transition-[height,opacity] duration-700 ${
                i === today ? "bg-accent" : "bg-neutral-900 dark:bg-neutral-100"
              }`}
              style={{ height: grown ? `${Math.max(12, (n / max) * 100)}%` : "0%", opacity: nearness(i, t) }}
            />
          </Link>
        );
      })}
      <span className={`flex h-10 items-center justify-end ${lead ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}>
        {job.total}
      </span>
    </>
  );
}

/** One day's schedule, job by job: what is on the Gantt and which to-dos are due. */
function DaySummary({ jobs, day }: { jobs: WeekJob[]; day: number }) {
  const on = jobs.filter((j) => j.days[day].length).sort((a, b) => b.days[day].length - a.days[day].length);
  if (!on.length) return <EmptyState>Nothing on the schedule this day.</EmptyState>;
  return (
    <div className="space-y-5">
      {on.map((j) => (
        <section key={j.id} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight">{j.name}</h3>
            <Link href={scheduleHref(j.id)} className="shrink-0 py-2 text-[12px] font-semibold text-accent">
              Open schedule →
            </Link>
          </div>
          <ul className="divide-y divide-line-soft rounded-xl border border-line">
            {j.days[day].map((item) => (
              <li key={`${item.kind}-${item.id}`} className="px-3 py-2">
                <div className="text-sm">{item.name}</div>
                <MetaLine items={[item.kind === "task" ? "Schedule" : "To-do due", item.phase]} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
