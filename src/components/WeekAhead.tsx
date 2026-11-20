"use client";

import { useEffect, useId, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toast";
import { Banner, Button, Checkbox, Input, Label, MetaLine, Textarea } from "@/components/ui";
import { orgDay, orgParts } from "@/lib/orgTime";
import {
  patchItem,
  type ItemPatch,
  type PickedItem,
  type WeekActivity,
  type WeekItem,
  type WeekJob,
} from "@/lib/weekActivity";

/**
 * HOME'S THIS WEEK CARD (owner, 2026-11-15: option F of the week-card
 * workshop). Time runs left to right from now: today, then the next days, one
 * segment each, 6 AM to 6 PM, nights folded away. A phone shows three days and
 * lists the rest of the week under them; from `pad` up it shows all seven.
 *
 *   Next      — the next timed thing (a calendar event or a timed task), big.
 *   Calendar  — the shared office calendars' events, placed by clock time.
 *   Jobs      — one band per job: each task is one bar for its whole run, each
 *               to-do a diamond at the end of the day it is due.
 *   Now       — a rule at the clock; what is already past is shaded.
 *
 * Nothing navigates away: every tap opens a dialog. A task or to-do opens its
 * edit form (PATCH /api/home/week/task: name, dates, description, done); a
 * calendar event opens read-only; a later day opens its list.
 *
 * Data: /api/home/week (the next seven days, today first) and
 * /api/home/week/events. It reloads when the day turns over.
 */

interface CalEvent {
  day: string;
  title: string;
  when: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  where: string;
  calendar: string;
}

type Pick =
  { kind: "item"; row: PickedItem } | { kind: "event"; e: CalEvent } | { kind: "day"; i: number };

// ponytail: a fixed set of job colours, read by dark text in both themes;
// jobs past the sixth reuse them. A palette token set is the upgrade if it clashes.
const HUES = ["#7DB9DE", "#93CFA6", "#E8957A", "#C3B0E6", "#E6C36A", "#8FD3D1"];
const OPEN = 6 * 60;
const CLOSE = 18 * 60;
const WIDE = "(min-width: 744px)";

const toMin = (t: string) => (/^\d{2}:\d{2}/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
const clock = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};
const tick = (h: number) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
const dayName = (d: string, short = false) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: short ? "short" : "long",
    ...(short ? { day: "numeric" } : { month: "short", day: "numeric" }),
    timeZone: "UTC",
  });
const nowMinutes = () => toMin(orgParts(new Date().toISOString()).time) ?? 0;
const until = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `in ${h ? `${h} h ` : ""}${m} m`;
};

/** An event's clock span in minutes; null for an all-day event. */
function eventSpan(e: CalEvent): [number, number] | null {
  if (e.allDay) return null;
  const s = toMin(orgParts(e.start).time);
  if (s === null) return null;
  const end = toMin(orgParts(e.end).time);
  return [s, end !== null && end > s ? end : s + 30];
}

/** Lanes: each item takes the first lane free at its start. */
function lanes<T>(items: T[], start: (t: T) => number, end: (t: T) => number): number[] {
  const ends: number[] = [];
  return items.map((it) => {
    let l = ends.findIndex((x) => x <= start(it));
    if (l < 0) l = ends.length;
    ends[l] = end(it);
    return l;
  });
}

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** One task across the shown days: its first and last day in view. */
interface Run {
  job: WeekJob;
  item: WeekItem;
  first: number;
  last: number;
}

/**
 * Drop Saturday and Sunday (owner, 2026-11-19). The route sends the next seven
 * days, today first; the card keeps the weekdays among them. When today is a
 * weekend day, the first column is the next Monday and the card has no "now".
 */
function weekdaysOnly(d: WeekActivity): WeekActivity {
  const keep = d.dates
    .map((_, i) => i)
    .filter((i) => {
      const w = new Date(d.dates[i] + "T00:00:00Z").getUTCDay();
      return w !== 0 && w !== 6;
    });
  return {
    ...d,
    dates: keep.map((i) => d.dates[i]),
    jobs: d.jobs.map((j) => {
      const days = keep.map((i) => j.days[i]);
      return { ...j, days, total: days.reduce((s, x) => s + x.length, 0) };
    }),
  };
}

export function WeekAhead() {
  const { can } = useAccess();
  const wide = useWide();
  const [data, setData] = useState<WeekActivity | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  const [reload, setReload] = useState(0);
  const [pick, setPick] = useState<Pick | null>(null);

  useEffect(() => {
    const stop = new AbortController();
    fetch("/api/home/week/events", { signal: stop.signal })
      .then((r) => r.json())
      .then((d: { events?: CalEvent[] }) => setEvents(d.events ?? []))
      .catch(() => {});
    fetch("/api/home/week", { signal: stop.signal })
      .then((r) => r.json())
      .then((d: WeekActivity & { error?: string }) => {
        if (d.error) return setFailed(true);
        setData(weekdaysOnly(d));
        setNow(nowMinutes());
      })
      .catch(() => {});
    return () => stop.abort();
  }, [reload]);

  // The clock: once a minute. A new day reloads, since the window moves.
  useEffect(() => {
    if (!data) return;
    const id = setInterval(() => {
      if (orgDay(new Date().toISOString()) !== data.today) setReload((n) => n + 1);
      else setNow(nowMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, [data]);

  if (failed) return <p className="text-[12px] text-neutral-500">The week did not load.</p>;
  if (!data) return <div className="h-48" aria-hidden />;

  const n = Math.min(wide ? 7 : 3, data.dates.length);
  // The first column is today unless today is a weekend day.
  const todayIn = data.dates[0] === data.today;
  const shown = data.dates.slice(0, n);
  const hue = (job: WeekJob) => HUES[Math.max(0, data.jobs.indexOf(job)) % HUES.length];

  // x of (day, minute) as a percent of the timeline; 1.5% between days.
  const GAP = 1.5;
  const seg = (100 - GAP * (n - 1)) / n;
  const x = (d: number, m: number) =>
    d * (seg + GAP) + ((Math.min(CLOSE, Math.max(OPEN, m)) - OPEN) / (CLOSE - OPEN)) * seg;
  const nowX = todayIn ? x(0, now) : 0;

  // Calendar: timed events by clock, all-day ones as a full day.
  const timed = events
    .map((e) => ({ e, d: shown.indexOf(e.day), span: eventSpan(e) }))
    .filter((t) => t.d >= 0)
    .map((t) => ({ ...t, s: t.span ? t.span[0] : OPEN, f: t.span ? t.span[1] : CLOSE }))
    .sort((a, b) => a.d - b.d || a.s - b.s);
  // A block is drawn at least 3rem wide, about 300 minutes of a day segment
  // at either width, so lanes are spaced as if each lasts that long.
  const evLane = lanes(
    timed,
    (t) => t.d * 1440 + t.s,
    (t) => t.d * 1440 + Math.max(t.f, t.s + 300),
  );
  const evRows = timed.length ? Math.max(...evLane) + 1 : 0;

  // Jobs: each task once, from its first day in view to its last; to-dos by day.
  const bands = data.jobs
    .map((job) => {
      const runs = new Map<string, Run>();
      const todos: { item: WeekItem; d: number }[] = [];
      job.days.slice(0, n).forEach((items, d) => {
        for (const item of items) {
          if (item.kind === "todo") todos.push({ item, d });
          else {
            const r = runs.get(item.id);
            if (r) r.last = d;
            else runs.set(item.id, { job, item, first: d, last: d });
          }
        }
      });
      return { job, runs: [...runs.values()], todos };
    })
    // Every job with an entry in the week, even when its entries fall on later days.
    .filter((b) => b.job.total > 0);

  // Next: the soonest timed thing that has not started.
  const ahead = [
    ...timed
      .filter((t) => t.span)
      .map((t) => ({
        at: t.d * 1440 + t.s,
        title: t.e.title,
        pick: { kind: "event", e: t.e } as Pick,
      })),
    ...bands.flatMap((b) =>
      b.runs.flatMap((r) => {
        const s = toMin(r.item.startTime);
        const d = data.dates.indexOf(r.item.start);
        return s === null || d < 0 || d >= n
          ? []
          : [
              {
                at: d * 1440 + s,
                title: r.item.name,
                pick: { kind: "item", row: { job: r.job, item: r.item, day: d } } as Pick,
              },
            ];
      }),
    ),
  ]
    .filter((a) => !todayIn || a.at > now)
    .sort((a, b) => a.at - b.at);
  const next = ahead[0];

  const later = data.dates.slice(n).map((d, k) => {
    const i = n + k;
    const tasks = data.jobs.reduce(
      (s, j) => s + j.days[i].filter((t) => t.kind === "task").length,
      0,
    );
    const todos = data.jobs.reduce(
      (s, j) => s + j.days[i].filter((t) => t.kind === "todo").length,
      0,
    );
    const evs = events.filter((e) => e.day === d).length;
    return { i, d, tasks, todos, evs };
  });

  const nextCard = next ? (
    <button
      type="button"
      onClick={() => setPick(next.pick)}
      className="w-full rounded-card border border-accent bg-accent/10 p-3 text-left transition-colors hover:bg-accent/15"
    >
      <span className="block text-[10px] font-medium uppercase tracking-widest text-accent">
        Next
      </span>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-lg font-semibold tracking-tight">{next.title}</span>
        <span className="shrink-0 text-lg font-semibold tabular-nums text-accent">
          {clock(next.at % 1440)}
        </span>
      </span>
      <span className="block text-[12px] text-neutral-500">
        {todayIn && next.at < 1440 ? until(next.at - now) : dayName(data.dates[Math.floor(next.at / 1440)])}
      </span>
    </button>
  ) : (
    <p className="rounded-card border border-line-soft p-3 text-[12px] text-neutral-500">
      Nothing timed ahead.
    </p>
  );

  const timeline = (
    <div className="relative min-w-0">
      {/* Day heads and hour ticks. */}
      <div className="relative h-9">
        {shown.map((d, i) => (
          <div
            key={d}
            className="absolute top-0"
            style={{ left: `${x(i, OPEN)}%`, width: `${seg}%` }}
          >
            <div className={`truncate text-[12px] font-semibold ${todayIn && i === 0 ? "text-accent" : ""}`}>
              {todayIn && i === 0 ? "Today" : dayName(d, true)}
            </div>
            {[9, 12, 15].map((h) => (
              <span
                key={h}
                className="absolute top-5 -translate-x-1/2 text-[9px] tabular-nums text-neutral-500"
                style={{ left: `${((h * 60 - OPEN) / (CLOSE - OPEN)) * 100}%` }}
              >
                {tick(h)}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="relative pb-6">
        {/* The day segments behind everything, with noon marked. */}
        {shown.map((d, i) => (
          <div
            key={d}
            className="absolute inset-y-0 rounded-inner bg-line-soft/40"
            style={{ left: `${x(i, OPEN)}%`, width: `${seg}%` }}
          >
            <span className="absolute inset-y-0 left-1/2 w-px bg-line-soft" />
          </div>
        ))}

        {evRows > 0 && (
          <div className="relative mb-2" style={{ height: evRows * 40 }}>
            {timed.map((t, k) => {
              const past = todayIn && t.d === 0 && t.f <= now;
              return (
                <button
                  key={k}
                  type="button"
                  title={`${t.e.title} · ${t.e.when}`}
                  onClick={() => setPick({ kind: "event", e: t.e })}
                  className={`absolute h-9 overflow-hidden rounded-inner border border-line bg-neutral-100 px-1.5 dark:bg-ink-overlay text-left text-[11px] font-medium leading-tight hover:border-accent ${
                    past ? "opacity-40" : ""
                  }`}
                  style={{
                    top: evLane[k] * 40,
                    left: `${x(t.d, t.s)}%`,
                    width: `max(3rem,${x(t.d, t.f) - x(t.d, t.s)}%)`,
                  }}
                >
                  <span className="block truncate">{t.e.title}</span>
                  <span className="block truncate text-[9px] font-normal text-neutral-500">
                    {t.span ? clock(t.s) : "All day"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {bands.map((b) => (
          <div key={b.job.id} className="relative mb-2">
            <div className="relative truncate pb-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
              {b.job.name}
            </div>
            {b.runs.length === 0 && b.todos.length === 0 && (
              <div className="pb-1 text-[11px] text-neutral-500">Later this week.</div>
            )}
            {b.runs.map((r) => {
              const s =
                r.first === data.dates.indexOf(r.item.start)
                  ? (toMin(r.item.startTime) ?? OPEN)
                  : OPEN;
              const f =
                r.last === data.dates.indexOf(r.item.end)
                  ? (toMin(r.item.endTime) ?? CLOSE)
                  : CLOSE;
              const left = x(r.first, s);
              return (
                <div key={r.item.id} className="relative mb-1 h-8">
                  <button
                    type="button"
                    title={r.item.name}
                    onClick={() =>
                      setPick({ kind: "item", row: { job: r.job, item: r.item, day: r.first } })
                    }
                    className="absolute inset-y-0 overflow-hidden rounded-inner px-2 text-left text-[12px] font-medium text-[#14130F] hover:brightness-110"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(2, x(r.last, f) - left)}%`,
                      background: hue(b.job),
                    }}
                  >
                    <span className="block truncate">{r.item.name}</span>
                  </button>
                </div>
              );
            })}
            {b.todos.length > 0 && (
              <div className="relative h-8">
                {b.todos.map((t, k) => (
                  <button
                    key={t.item.id}
                    type="button"
                    title={`To-do: ${t.item.name}`}
                    aria-label={`To-do: ${t.item.name}`}
                    onClick={() =>
                      setPick({ kind: "item", row: { job: b.job, item: t.item, day: t.d } })
                    }
                    className="absolute top-0 flex size-8 -translate-x-full items-center justify-center"
                    style={{ left: `calc(${x(t.d, CLOSE)}% - ${k * 1.25}rem)` }}
                  >
                    <span
                      className="block size-3 rotate-45 rounded-[2px] ring-2 ring-white dark:ring-ink"
                      style={{ background: hue(b.job) }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* What is past, shaded; then the now rule. */}
        {todayIn && (
        <>
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-inner bg-white/50 dark:bg-ink/50"
          style={{ width: `${nowX}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent"
          style={{ left: `${nowX}%` }}
        >
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] font-medium text-accent">
            now
          </span>
        </div>
        </>
        )}
      </div>

      {bands.length === 0 && evRows === 0 && (
        <p className="text-[12px] text-neutral-500">Nothing on the schedule.</p>
      )}
    </div>
  );

  return (
    <>
      {wide ? (
        <div className="grid grid-cols-[15rem_minmax(0,1fr)] gap-5">
          <div>{nextCard}</div>
          {timeline}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {nextCard}
          {timeline}
          {later.length > 0 && (
            <ul className="divide-y divide-line-soft border-t border-line-soft">
              {later.map((l) => (
                <li key={l.d}>
                  <button
                    type="button"
                    onClick={() => setPick({ kind: "day", i: l.i })}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-1 text-left hover:bg-line-soft"
                  >
                    <span className="text-[13px] font-medium">{dayName(l.d)}</span>
                    <MetaLine
                      items={[
                        l.evs ? `${l.evs} on calendar` : null,
                        l.tasks ? `${l.tasks} ${l.tasks === 1 ? "task" : "tasks"}` : null,
                        l.todos ? `${l.todos} ${l.todos === 1 ? "to-do" : "to-dos"}` : null,
                        l.evs + l.tasks + l.todos ? null : "Nothing",
                      ]}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pick?.kind === "item" && (
        <Dialog onClose={() => setPick(null)} label={pick.row.item.name}>
          <ItemForm
            key={`${pick.row.item.kind}-${pick.row.item.id}`}
            entry={pick.row}
            editable={can("home")}
            onClose={() => setPick(null)}
            onSaved={(patch) => {
              setData(patchItem(data, pick.row.item.kind, pick.row.item.id, patch));
              setPick(null);
            }}
          />
        </Dialog>
      )}
      {pick?.kind === "event" && (
        <Dialog
          onClose={() => setPick(null)}
          title={pick.e.title}
          size="sm"
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setPick(null)}>
                Close
              </Button>
            </div>
          }
        >
          <MetaLine
            items={[
              dayName(pick.e.day),
              pick.e.when,
              pick.e.where || null,
              pick.e.calendar || null,
            ]}
          />
        </Dialog>
      )}
      {pick?.kind === "day" && (
        <Dialog onClose={() => setPick(null)} title={dayName(data.dates[pick.i])} pad={false}>
          <DayList
            data={data}
            events={events.filter((e) => e.day === data.dates[pick.i])}
            i={pick.i}
            onPick={setPick}
          />
        </Dialog>
      )}
    </>
  );
}

/** A later day's list: calendar first in clock order, then each job's work. */
function DayList({
  data,
  events,
  i,
  onPick,
}: {
  data: WeekActivity;
  events: CalEvent[];
  i: number;
  onPick: (p: Pick) => void;
}) {
  const sorted = [...events].sort((a, b) => (eventSpan(a)?.[0] ?? -1) - (eventSpan(b)?.[0] ?? -1));
  const rows = data.jobs.flatMap((job) => job.days[i].map((item) => ({ job, item })));
  if (!sorted.length && !rows.length)
    return <p className="px-4 py-3 text-[13px] text-neutral-500">Nothing on the schedule.</p>;
  const row =
    "flex min-h-11 w-full flex-col justify-center px-4 py-1.5 text-left hover:bg-line-soft";
  return (
    <ul className="divide-y divide-line-soft">
      {sorted.map((e, k) => (
        <li key={`e${k}`}>
          <button type="button" className={row} onClick={() => onPick({ kind: "event", e })}>
            <span className="truncate text-[13px] font-medium">{e.title}</span>
            <MetaLine items={["Calendar", e.when, e.where || null]} />
          </button>
        </li>
      ))}
      {rows.map(({ job, item }) => (
        <li key={`${job.id}:${item.kind}:${item.id}`}>
          <button
            type="button"
            className={row}
            onClick={() => onPick({ kind: "item", row: { job, item, day: i } })}
          >
            <span className="truncate text-[13px] font-medium">{item.name}</span>
            <MetaLine items={[item.kind === "task" ? "Task" : "To-do", job.name]} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One task or to-do, editable when the viewer has `home`. */
function ItemForm({
  entry,
  editable,
  onClose,
  onSaved,
}: {
  entry: PickedItem;
  editable: boolean;
  onClose: () => void;
  onSaved: (patch: ItemPatch) => void;
}) {
  const { item, job } = entry;
  const id = useId();
  const todo = item.kind === "todo";
  const [name, setName] = useState(item.name);
  const [start, setStart] = useState(item.start);
  const [end, setEnd] = useState(item.end);
  const [description, setDescription] = useState(item.description);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: ItemPatch = {};
    if (name.trim() !== item.name) patch.name = name.trim();
    if (description !== item.description) patch.description = description;
    // A schedule task's dates go as a pair; the route checks start <= end.
    if (end !== item.end || (!todo && start !== item.start)) {
      patch.end = end;
      if (!todo) patch.start = start;
    }
    if (done) patch.done = true;
    if (!Object.keys(patch).length) return onClose();
    if (patch.name === "") return setError("It needs a name.");
    setBusy(true);
    setError("");
    const r = await fetch("/api/home/week/task", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, kind: item.kind, ...patch }),
    }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as {
      ok?: boolean;
      previewed?: boolean;
      error?: string;
    } | null;
    setBusy(false);
    if (!r?.ok || !j?.ok) return setError(j?.error ?? "Could not save to JobTread.");
    if (j.previewed) {
      toast("Writes are off. Nothing was saved.");
      return onClose();
    }
    toast("Saved");
    onSaved(patch);
  }

  const field = (key: string) => `${id}-${key}`;
  const off = !editable || busy;

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold tracking-tight">
          {todo ? "To-do" : "Schedule task"}
        </div>
        <MetaLine
          items={[
            job.name,
            item.phase ? `Phase: ${item.phase}` : null,
            item.startTime
              ? `${clock(toMin(item.startTime)!)}${item.endTime ? ` – ${clock(toMin(item.endTime)!)}` : ""}`
              : null,
          ]}
        />
      </div>

      <div>
        <Label htmlFor={field("name")}>Name</Label>
        <Input
          id={field("name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={off}
        />
      </div>

      {todo ? (
        <div>
          <Label htmlFor={field("due")}>Due</Label>
          <Input
            id={field("due")}
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            disabled={off}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={field("start")}>Start</Label>
            <Input
              id={field("start")}
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
              disabled={off}
            />
          </div>
          <div>
            <Label htmlFor={field("end")}>End</Label>
            <Input
              id={field("end")}
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
              required
              disabled={off}
            />
          </div>
        </div>
      )}

      <div>
        <Label htmlFor={field("desc")}>Description</Label>
        <Textarea
          id={field("desc")}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={off}
        />
      </div>
      {editable && (
        <Checkbox
          label="Done"
          checked={done}
          onChange={(e) => setDone(e.target.checked)}
          disabled={busy}
        />
      )}

      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant={editable ? "ghost" : "primary"}
          size="sm"
          onClick={onClose}
          disabled={busy}
        >
          {editable ? "Cancel" : "Close"}
        </Button>
        {editable && (
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
    </form>
  );
}
