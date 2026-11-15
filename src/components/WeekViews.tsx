"use client";

import { useState } from "react";
import {
  DayAgenda,
  HOUR,
  KIND,
  clock,
  endOf,
  layoutDay,
  splitDay,
  toMin,
  type DayEntry,
} from "@/components/DayAgenda";
import { orgParts } from "@/lib/orgTime";
import type { PickedItem, WeekActivity } from "@/lib/weekActivity";

/**
 * Three calendar looks for Home's This week card (workshop 2026-11-15; the
 * owner picks one and the rest go). All three read the same entries per day:
 * calendar events plus every task and to-do on that day, timed ones in clock
 * order, the rest as "Anytime".
 *
 *   agenda — the week as seven day sections down the page. Phone first.
 *   strip  — a row of seven day chips; the chosen day opens as an hour grid.
 *   grid   — a Sunday-to-Saturday hour grid, an Anytime row on top. Scrolls
 *            sideways on a phone.
 */
export interface WeekEvent {
  day: string;
  title: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  where: string;
  calendar: string;
}
export type WeekLook = "agenda" | "strip" | "grid";
export const WEEK_LOOKS: { id: WeekLook; label: string }[] = [
  { id: "agenda", label: "Agenda" },
  { id: "strip", label: "Strip" },
  { id: "grid", label: "Grid" },
];

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Every entry on day `i`: its events, then each job's tasks and to-dos. */
export function dayEntries(data: WeekActivity, events: WeekEvent[], i: number): DayEntry[] {
  const date = data.dates[i];
  const out: DayEntry[] = events
    .filter((e) => e.day === date)
    .map((e, k) => ({
      key: `ev${i}:${k}`,
      title: e.title,
      kind: "event",
      meta: [e.allDay ? "All day" : null, e.where || null, e.calendar || null],
      start: e.allDay ? null : toMin(orgParts(e.start).time),
      end: e.allDay ? null : toMin(orgParts(e.end).time),
    }));
  for (const job of data.jobs)
    for (const item of job.days[i]) {
      const row: PickedItem = { job, item, day: i };
      out.push({
        key: `${job.id}:${item.kind}:${item.id}`,
        title: item.name,
        kind: item.kind,
        meta: [job.name],
        start: toMin(item.startTime),
        end: toMin(item.endTime),
        row,
      });
    }
  return out;
}

interface Props {
  data: WeekActivity;
  events: WeekEvent[];
  /** Index of today in the week, and the clock now in minutes. */
  today: number;
  nowMin: number;
  editingKey: string;
  onEdit: (e: PickedItem) => void;
}

const dayName = (data: WeekActivity, i: number) => `${WEEKDAY[i]} ${monthDay(data.dates[i])}`;

export function WeekAgenda({ data, events, today, nowMin, editingKey, onEdit }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {data.dates.map((d, i) => {
        const entries = dayEntries(data, events, i);
        const isToday = i === today;
        return (
          <section key={d} className={i < today ? "opacity-60" : ""}>
            <h3
              className={`sticky top-0 z-10 flex items-baseline gap-2 border-b border-line-soft bg-ink-base py-1 text-[13px] font-semibold ${
                isToday ? "text-accent" : ""
              }`}
            >
              {dayName(data, i)}
              {isToday && (
                <span className="text-[11px] font-medium uppercase tracking-wide">Today</span>
              )}
              <span className="ml-auto text-[11px] font-normal text-neutral-500">
                {entries.length || "Nothing"}
              </span>
            </h3>
            {entries.length > 0 && (
              <DayAgenda
                entries={entries}
                look={isToday ? "now" : "agenda"}
                nowMin={isToday ? nowMin : null}
                editingKey={editingKey}
                onEdit={onEdit}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

export function WeekStrip({ data, events, today, nowMin, editingKey, onEdit }: Props) {
  const [day, setDay] = useState(today);
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Day" className="grid grid-cols-7 gap-1">
        {data.dates.map((d, i) => {
          const n = dayEntries(data, events, i).length;
          const on = i === day;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(i)}
              aria-pressed={on}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-[11px] ${
                on ? "border-accent bg-accent/10" : "border-line-soft"
              } ${i === today ? "font-bold" : "text-neutral-500"}`}
            >
              <span>{WEEKDAY[i]}</span>
              <span className="text-[15px] tabular-nums">{+d.slice(8, 10)}</span>
              <span className="flex h-1.5 gap-[2px]">
                {Array.from({ length: Math.min(n, 4) }, (_, k) => (
                  <span
                    key={k}
                    className={`size-1.5 rounded-full ${on ? "bg-accent" : "bg-neutral-500"}`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="text-sm font-semibold tracking-tight">{dayName(data, day)}</div>
      {dayEntries(data, events, day).length === 0 ? (
        <p className="text-[12px] text-neutral-500">Nothing on the schedule.</p>
      ) : (
        <DayAgenda
          entries={dayEntries(data, events, day)}
          look="timeline"
          nowMin={day === today ? nowMin : null}
          editingKey={editingKey}
          onEdit={onEdit}
        />
      )}
    </div>
  );
}

export function WeekGrid({ data, events, today, nowMin, editingKey, onEdit }: Props) {
  const days = data.dates.map((_, i) => splitDay(dayEntries(data, events, i)));
  const timed = days.flatMap((d) => d.timed);
  const from = timed.length
    ? Math.min(7, Math.floor(Math.min(...timed.map((e) => e.start!)) / 60)) * 60
    : 7 * 60;
  const to = timed.length
    ? Math.min(24 * 60, Math.max(17 * 60, Math.ceil(Math.max(...timed.map(endOf)) / 60) * 60))
    : 17 * 60;
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from / 60 + i);
  const y = (m: number) => ((m - from) / 60) * HOUR;
  const anytime = Math.max(0, ...days.map((d) => d.anytime.length));

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[34rem] grid-cols-[2.75rem_repeat(7,minmax(0,1fr))]">
        <span />
        {data.dates.map((d, i) => (
          <div
            key={d}
            className={`border-b border-line-soft pb-1 text-center text-[11px] ${
              i === today ? "font-bold text-accent" : "text-neutral-500"
            }`}
          >
            {WEEKDAY[i]} <span className="tabular-nums">{+d.slice(8, 10)}</span>
          </div>
        ))}

        {anytime > 0 && (
          <>
            <span className="pr-1 pt-1 text-right text-[10px] text-neutral-500">Any</span>
            {days.map((d, i) => (
              <div
                key={i}
                className="flex min-w-0 flex-col gap-0.5 border-l border-line-soft p-0.5"
              >
                {d.anytime.map((e) => {
                  const cls =
                    "truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight " +
                    (e.kind === "event" ? "bg-line-soft" : "bg-accent/10");
                  return e.row ? (
                    <button
                      key={e.key}
                      type="button"
                      title={e.title}
                      onClick={() => onEdit(e.row!)}
                      className={cls}
                    >
                      {e.title}
                    </button>
                  ) : (
                    <span key={e.key} title={e.title} className={cls}>
                      {e.title}
                    </span>
                  );
                })}
              </div>
            ))}
          </>
        )}

        <div className="relative" style={{ height: y(to) }}>
          {hours.map((h) => (
            <span
              key={h}
              className="absolute right-1 -mt-1.5 text-[10px] tabular-nums text-neutral-500"
              style={{ top: y(h * 60) }}
            >
              {clock(h * 60)}
            </span>
          ))}
        </div>
        {days.map((d, i) => {
          const { lane, cluster } = layoutDay(d.timed);
          return (
            <div key={i} className="relative border-l border-line-soft" style={{ height: y(to) }}>
              {hours.map((h) => (
                <span
                  key={h}
                  className="absolute inset-x-0 h-px bg-line-soft"
                  style={{ top: y(h * 60) }}
                />
              ))}
              {d.timed.map((e, k) => {
                const style = {
                  top: y(e.start!),
                  height: Math.max(20, y(endOf(e)) - y(e.start!) - 2),
                  left: `${(lane[k] / cluster[k]) * 100}%`,
                  width: `calc(${100 / cluster[k]}% - 2px)`,
                };
                const cls = `absolute overflow-hidden rounded border px-1 py-0.5 text-left text-[10px] leading-tight ${
                  e.kind === "event" ? "border-line bg-line-soft" : "border-accent/40 bg-accent/10"
                } ${e.key === editingKey ? "ring-1 ring-accent" : ""}`;
                const inner = (
                  <>
                    <span className="block truncate font-medium">{e.title}</span>
                    <span className="block truncate text-neutral-500">{KIND[e.kind]}</span>
                  </>
                );
                return e.row ? (
                  <button
                    key={e.key}
                    type="button"
                    title={e.title}
                    style={style}
                    className={cls}
                    onClick={() => onEdit(e.row!)}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={e.key} title={e.title} style={style} className={cls}>
                    {inner}
                  </div>
                );
              })}
              {i === today && nowMin >= from && nowMin <= to && (
                <span className="absolute inset-x-0 h-0.5 bg-accent" style={{ top: y(nowMin) }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
