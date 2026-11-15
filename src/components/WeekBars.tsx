"use client";

import { useEffect, useId, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { toast } from "@/components/Toast";
import {
  Banner,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Label,
  MetaLine,
  Textarea,
  btn,
} from "@/components/ui";
import { jtScheduleUrl, jtToDoUrl } from "@/lib/jtLinks";
import {
  nearness,
  patchItem,
  pickedItems,
  type ItemPatch,
  type PickedItem,
  type WeekActivity,
  type WeekItem,
  type WeekJob,
  type WeekPick,
} from "@/lib/weekActivity";

/**
 * HOME'S WEEK BARS (owner, 2026-11-15; reworked 2026-11-14). One row per job,
 * labelled "Customer - Job", one column per day, Sunday to Saturday. A bar's
 * height is how much is on that job that day: open schedule tasks plus to-dos
 * due (src/lib/weekActivity.ts). Bars sit centred in their row.
 *
 * Today's bars are lit; every other day draws as strong as it is near
 * (`nearness`). The rule under the day letters fills with the week. The clock
 * ticks once a minute; nothing loops.
 *
 * Nothing here navigates away. The details panel on the right lists a pick:
 *   Tap a job  → its tasks and to-dos for the week.
 *   Tap a day  → every task and to-do that day.
 *   Tap a bar  → that job on that day.
 *   Tap an item in the panel → the week flips over to its edit form.
 * No pick shows today.
 *
 * Editing (owner approved 2026-11-15): any schedule task or to-do on an open
 * job saves through PATCH /api/home/week/task: name, dates, description, done.
 *
 * Calendar: the shared office calendars' events for the rest of the week, from
 * GET /api/home/week/events. A row of marks under the day rule, and listed
 * read-only in the panel when a day is picked.
 *
 * Data: /api/home/week (the `home` view). It reloads when the day turns over.
 */

type Week = WeekActivity;
interface CalEvent {
  day: string;
  title: string;
  when: string;
  where: string;
  calendar: string;
}

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const ROWS = 8;

/** Days since this week's Sunday 00:00, local time: Wednesday 3 PM is 3.625. */
function weekTime(sunday: string): number {
  const start = new Date(
    +sunday.slice(0, 4),
    +sunday.slice(5, 7) - 1,
    +sunday.slice(8, 10),
  ).getTime();
  return (Date.now() - start) / 86_400_000;
}

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const counts = (items: WeekItem[]) => {
  const tasks = items.filter((i) => i.kind === "task").length;
  const todos = items.length - tasks;
  return [
    tasks && `${tasks} ${tasks === 1 ? "task" : "tasks"}`,
    todos && `${todos} ${todos === 1 ? "to-do" : "to-dos"}`,
  ]
    .filter(Boolean)
    .join(", ");
};

const inPick = (p: WeekPick, job: string, day: number) =>
  (p.job === null || p.job === job) && (p.day === null || p.day === day);

export function WeekBars() {
  const { can } = useAccess();
  const [data, setData] = useState<Week | null>(null);
  const [failed, setFailed] = useState(false);
  const [t, setT] = useState(0);
  const [grown, setGrown] = useState(false);
  const [reload, setReload] = useState(0);
  const [pick, setPick] = useState<WeekPick | null>(null);
  const [editing, setEditing] = useState<PickedItem | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);

  useEffect(() => {
    const stop = new AbortController();
    fetch("/api/home/week/events", { signal: stop.signal })
      .then((r) => r.json())
      .then((d: { events?: CalEvent[] }) => setEvents(d.events ?? []))
      .catch(() => {});
    fetch("/api/home/week", { signal: stop.signal })
      .then((r) => r.json())
      .then((d: Week & { error?: string }) => {
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
  const sel: WeekPick = pick ?? { job: null, day: today };
  const choose = (p: WeekPick) => {
    setPick(p);
    setEditing(null);
  };
  const jobs = data.jobs.slice(0, ROWS);
  const hidden = data.jobs.length - jobs.length;
  const max = Math.max(1, ...data.jobs.flatMap((j) => j.days.map((d) => d.length)));
  const editable = can("home");
  const eventsOn = (i: number) => events.filter((e) => e.day === data.dates[i]);

  const grid =
    data.jobs.length === 0 ? (
      <EmptyState>Nothing on the schedule this week.</EmptyState>
    ) : (
      <div className="grid grid-cols-[minmax(0,7.5rem)_repeat(7,minmax(0,1fr))_1.75rem] items-center gap-x-[3px] text-[11px] tabular-nums pad:grid-cols-[minmax(0,12rem)_repeat(7,minmax(0,1fr))_1.75rem]">
        {/* The day row: each day lists its tasks and to-dos. */}
        <span />
        {data.dates.map((d, i) => {
          const on = sel.job === null && sel.day === i;
          return (
            <button
              key={d}
              type="button"
              onClick={() => choose({ job: null, day: i })}
              aria-pressed={on}
              aria-label={`${dayLabel(d)}: show its tasks and to-dos`}
              className={`flex min-h-11 flex-col items-center justify-end rounded-t-md pb-1 transition-colors hover:bg-neutral-100 dark:hover:bg-ink-overlay ${
                on ? "bg-accent/10" : ""
              } ${i === today ? "font-bold text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}
            >
              <span>{LETTERS[i]}</span>
              <span className="text-[10px] font-normal opacity-70">{+d.slice(8, 10)}</span>
            </button>
          );
        })}
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

        {events.length > 0 && (
          <>
            <span className="flex h-8 items-center justify-end pr-2 text-neutral-500">Calendar</span>
            {data.dates.map((d, i) => {
              const n = eventsOn(i).length;
              if (!n) return <span key={d} className="h-8" />;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => choose({ job: null, day: i })}
                  aria-label={`${dayLabel(d)}: ${n} calendar ${n === 1 ? "event" : "events"}`}
                  className={`flex h-8 items-center justify-center gap-[3px] rounded-md transition-colors hover:bg-neutral-100 dark:hover:bg-ink-overlay ${
                    sel.job === null && sel.day === i ? "bg-accent/10" : ""
                  }`}
                >
                  {Array.from({ length: Math.min(n, 3) }, (_, k) => (
                    <span
                      key={k}
                      className={`block size-1.5 rounded-full ${i === today ? "bg-accent" : "bg-neutral-500"}`}
                    />
                  ))}
                </button>
              );
            })}
            <span className="flex h-8 items-center justify-end text-neutral-500">{events.length}</span>
          </>
        )}

        {jobs.map((j) => (
          <JobRow
            key={j.id}
            job={j}
            max={max}
            t={t}
            today={today}
            grown={grown}
            sel={sel}
            choose={choose}
          />
        ))}
      </div>
    );

  return (
    <div className="grid gap-4 pad:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {/* The week, which flips over to the edit form. */}
      <div className="[perspective:1600px]">
        <div
          className={`relative min-h-[19rem] transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none ${
            editing ? "[transform:rotateY(180deg)]" : ""
          }`}
        >
          <div className="[backface-visibility:hidden]" inert={!!editing}>
            {grid}
            {hidden > 0 && (
              <div className="mt-2 text-[11px] text-neutral-500">
                {hidden} more {hidden === 1 ? "job" : "jobs"}: tap a day to see them.
              </div>
            )}
          </div>
          <div
            className="absolute inset-0 overflow-y-auto [backface-visibility:hidden] [transform:rotateY(180deg)]"
            inert={!editing}
          >
            {editing && (
              <ItemForm
                key={`${editing.item.kind}-${editing.item.id}`}
                entry={editing}
                editable={editable}
                onClose={() => setEditing(null)}
                onSaved={(patch) => {
                  setData(patchItem(data, editing.item.kind, editing.item.id, patch));
                  setEditing(null);
                }}
              />
            )}
          </div>
        </div>
      </div>

      <Details
        data={data}
        sel={sel}
        events={sel.job === null && sel.day !== null ? eventsOn(sel.day) : []}
        isToday={pick === null}
        onToday={() => choose({ job: null, day: today })}
        editingKey={editing ? `${editing.job.id}:${editing.item.kind}:${editing.item.id}` : ""}
        onEdit={setEditing}
      />
    </div>
  );
}

function JobRow({
  job,
  max,
  t,
  today,
  grown,
  sel,
  choose,
}: {
  job: WeekJob;
  max: number;
  t: number;
  today: number;
  grown: boolean;
  sel: WeekPick;
  choose: (p: WeekPick) => void;
}) {
  const jobOn = sel.job === job.id && sel.day === null;
  const strong =
    sel.job === job.id
      ? "font-semibold text-neutral-900 dark:text-neutral-100"
      : "text-neutral-500";
  return (
    <>
      <button
        type="button"
        onClick={() => choose({ job: job.id, day: null })}
        aria-pressed={jobOn}
        title={job.name}
        className={`flex h-10 min-w-0 items-center justify-end rounded-l-md pr-2 text-right transition-colors hover:bg-neutral-100 dark:hover:bg-ink-overlay ${
          jobOn ? "bg-accent/10" : ""
        } ${strong}`}
      >
        <span className="truncate">{job.name}</span>
      </button>
      {job.days.map((items, i) => {
        const n = items.length;
        const lit = inPick(sel, job.id, i) ? "bg-accent/10" : "";
        const cell = `flex h-10 items-center justify-center border-b border-line-soft ${lit}`;
        if (!n) return <span key={i} className={cell} />;
        const one = sel.job === job.id && sel.day === i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => choose({ job: job.id, day: i })}
            aria-pressed={one}
            aria-label={`${job.name}, ${LETTERS[i]}: ${counts(items)}`}
            className={`${cell} transition-colors hover:bg-neutral-100 dark:hover:bg-ink-overlay ${
              one ? "rounded-md ring-2 ring-inset ring-accent" : ""
            }`}
          >
            <span
              className={`block w-[62%] rounded-[2px] transition-[height,opacity] duration-700 ${
                i === today ? "bg-accent" : "bg-neutral-900 dark:bg-neutral-100"
              }`}
              style={{
                height: grown ? `${Math.max(12, (n / max) * 80)}%` : "0%",
                opacity: nearness(i, t),
              }}
            />
          </button>
        );
      })}
      <span className={`flex h-10 items-center justify-end ${strong}`}>{job.total}</span>
    </>
  );
}

/** The right-hand panel: what the pick covers, each item a button to edit it. */
function Details({
  data,
  sel,
  events,
  isToday,
  onToday,
  editingKey,
  onEdit,
}: {
  data: Week;
  sel: WeekPick;
  events: CalEvent[];
  isToday: boolean;
  onToday: () => void;
  editingKey: string;
  onEdit: (e: PickedItem) => void;
}) {
  const job = sel.job === null ? null : (data.jobs.find((j) => j.id === sel.job) ?? null);
  const day = sel.day === null ? null : data.dates[sel.day];
  const rows = pickedItems(data, sel);
  const title = job ? job.name : day ? dayLabel(day) : "";
  const sub = job && day ? dayLabel(day) : job ? "This week" : isToday ? "Today" : "";

  return (
    <section className="flex min-w-0 flex-col gap-2 border-t border-line-soft pt-3 pad:max-h-[24rem] pad:border-l pad:border-t-0 pad:pl-4 pad:pt-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-tight">{title}</h3>
          <div className="text-[12px] text-neutral-500">
            {[
              sub,
              rows.length ? counts(rows.map((r) => r.item)) : "",
              events.length ? `${events.length} on the calendar` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {!isToday && (
          <Button variant="ghost" size="xs" onClick={onToday}>
            Today
          </Button>
        )}
      </div>
      {events.length > 0 && (
        <ul className="max-h-40 shrink-0 divide-y divide-line-soft overflow-y-auto">
          {events.map((e, k) => (
            <li key={k} className="px-1 py-1.5">
              <span className="block truncate text-[13px] font-medium">{e.title}</span>
              <MetaLine items={["Calendar", e.when, e.where || null, e.calendar || null]} />
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? (
        <p className="text-[12px] text-neutral-500">Nothing on the schedule.</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto">
          {rows.map((r) => {
            const key = `${r.job.id}:${r.item.kind}:${r.item.id}`;
            const when =
              r.item.kind === "todo"
                ? `Due ${shortDate(r.item.end)}`
                : r.item.start === r.item.end
                  ? shortDate(r.item.start)
                  : `${shortDate(r.item.start)} – ${shortDate(r.item.end)}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onEdit(r)}
                  aria-pressed={key === editingKey}
                  className={`block min-h-11 w-full rounded-md px-1 py-1.5 text-left hover:bg-line-soft ${
                    key === editingKey ? "bg-accent/10" : ""
                  }`}
                >
                  <span className="block truncate text-[13px] font-medium">{r.item.name}</span>
                  <MetaLine
                    items={[
                      r.item.kind === "task" ? "Task" : "To-do",
                      job ? null : r.job.name,
                      day && r.item.kind === "todo" ? null : when,
                      r.item.phase || null,
                    ]}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The back of the week: one task or to-do, editable when the viewer has `home`. */
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
    <form onSubmit={save} className="flex h-full flex-col gap-3 rounded-lg border border-line p-3">
      <div>
        <div className="text-sm font-semibold tracking-tight">
          {todo ? "To-do" : "Schedule task"}
        </div>
        <MetaLine items={[job.name, item.phase ? `Phase: ${item.phase}` : null]} />
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

      <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
        <a
          href={todo ? jtToDoUrl(item.id) : jtScheduleUrl(job.id, item.id)}
          target="_blank"
          rel="noreferrer"
          className={btn(editable ? "ghost" : "secondary", "sm")}
        >
          Open in JobTread
        </a>
        <Button
          variant={editable ? "ghost" : "primary"}
          size="sm"
          onClick={onClose}
          disabled={busy}
        >
          {editable ? "Cancel" : "Back"}
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
