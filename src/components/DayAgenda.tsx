"use client";

import { MetaLine } from "@/components/ui";
import type { PickedItem } from "@/lib/weekActivity";

/**
 * The details panel's day view, in three looks (workshop 2026-11-15; the owner
 * picks one and the other two go). Every look takes the same entries: calendar
 * events and schedule tasks with a clock time sort in order; to-dos and tasks
 * with no time sit above them as "Anytime".
 *
 *   agenda   — a time gutter and one row per entry.
 *   timeline — an hour grid, entries as blocks, overlaps side by side.
 *   now      — the agenda, with what is past dimmed and a rule at the clock.
 */
export interface DayEntry {
  key: string;
  title: string;
  kind: "event" | "task" | "todo";
  meta: (string | null)[];
  /** Minutes since midnight; null when it has no clock time. */
  start: number | null;
  end: number | null;
  row?: PickedItem;
}

export type DayLook = "agenda" | "timeline" | "now";
export const LOOKS: { id: DayLook; label: string }[] = [
  { id: "agenda", label: "Agenda" },
  { id: "timeline", label: "Timeline" },
  { id: "now", label: "Now" },
];

export const toMin = (t: string) =>
  /^\d{2}:\d{2}/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null;

export const clock = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};

export const KIND = { event: "Calendar", task: "Task", todo: "To-do" } as const;

/** Timed entries in clock order, then the untimed ones in the order given. */
export function splitDay(entries: DayEntry[]) {
  const timed = entries.filter((e) => e.start !== null).sort((a, b) => a.start! - b.start!);
  return { timed, anytime: entries.filter((e) => e.start === null) };
}

interface Props {
  entries: DayEntry[];
  look: DayLook;
  /** Minutes since midnight now, when the day shown is today; else null. */
  nowMin: number | null;
  editingKey: string;
  onEdit: (e: PickedItem) => void;
}

export function DayAgenda({ entries, look, nowMin, editingKey, onEdit }: Props) {
  const { timed, anytime } = splitDay(entries);
  // The "now" rule sits before the first entry that starts after the clock.
  const nowAt =
    look === "now" && nowMin !== null
      ? (timed.findIndex((e) => e.start! >= nowMin) + timed.length + 1) % (timed.length + 1)
      : -1;
  const open = (e: DayEntry) => (e.row ? () => onEdit(e.row!) : undefined);
  const active = (e: DayEntry) => !!e.row && e.key === editingKey;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {anytime.length > 0 && (
        <Group label="Anytime">
          {anytime.map((e) => (
            <Row key={e.key} e={e} gutter="" onClick={open(e)} active={active(e)} />
          ))}
        </Group>
      )}
      {timed.length > 0 &&
        (look === "timeline" ? (
          <Timeline timed={timed} nowMin={nowMin} onOpen={open} isActive={active} />
        ) : (
          <Group label={anytime.length ? "Scheduled" : ""}>
            {timed.map((e, i) => (
              <div key={e.key}>
                {i === nowAt && <NowRule at={nowMin!} />}
                <Row
                  e={e}
                  gutter={clock(e.start!)}
                  dim={look === "now" && nowMin !== null && (e.end ?? e.start!) < nowMin}
                  onClick={open(e)}
                  active={active(e)}
                />
              </div>
            ))}
            {nowAt === timed.length && <NowRule at={nowMin!} />}
          </Group>
        ))}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      {label && (
        <div className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          {label}
        </div>
      )}
      <ul className="divide-y divide-line-soft">{children}</ul>
    </div>
  );
}

function NowRule({ at }: { at: number }) {
  return (
    <div
      className="flex items-center gap-2 py-1 text-[11px] font-semibold text-accent"
      aria-label="Now"
    >
      <span className="w-14 shrink-0 text-right tabular-nums">{clock(at)}</span>
      <span className="h-px flex-1 bg-accent" />
    </div>
  );
}

function Row({
  e,
  gutter,
  dim,
  onClick,
  active,
}: {
  e: DayEntry;
  gutter: string;
  dim?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <span className="block truncate text-[13px] font-medium">{e.title}</span>
      <MetaLine items={[KIND[e.kind], ...e.meta]} />
    </>
  );
  const cls = `flex min-h-11 w-full gap-2 rounded-md px-1 py-1.5 text-left ${dim ? "opacity-50" : ""} ${
    active ? "bg-accent/10" : ""
  }`;
  const time = (
    <span className="w-14 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-neutral-500">
      {gutter}
    </span>
  );
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          className={`${cls} hover:bg-line-soft`}
        >
          {time}
          <span className="min-w-0 flex-1">{body}</span>
        </button>
      ) : (
        <div className={cls}>
          {time}
          <span className="min-w-0 flex-1">{body}</span>
        </div>
      )}
    </li>
  );
}

export const HOUR = 44; // px per hour

export const endOf = (e: DayEntry) => Math.max(e.end ?? e.start! + 60, e.start! + 30);

/** Lanes: an entry takes the first lane free at its start; a cluster's width is its widest overlap. */
export function layoutDay(timed: DayEntry[]) {
  const lane: number[] = [];
  const ends: number[] = [];
  timed.forEach((e, i) => {
    let l = ends.findIndex((x) => x <= e.start!);
    if (l < 0) l = ends.length;
    ends[l] = endOf(e);
    lane[i] = l;
  });
  const cluster = timed.map(
    (e, i) =>
      1 +
      Math.max(
        ...timed.map((o, j) => (o.start! < endOf(e) && e.start! < endOf(o) ? lane[j] : 0)),
        lane[i],
      ),
  );
  return { lane, cluster };
}

function Timeline({
  timed,
  nowMin,
  onOpen,
  isActive,
}: {
  timed: DayEntry[];
  nowMin: number | null;
  onOpen: (e: DayEntry) => (() => void) | undefined;
  isActive: (e: DayEntry) => boolean;
}) {
  const from = Math.max(
    0,
    Math.min(7, Math.floor(Math.min(...timed.map((e) => e.start!)) / 60)) * 60,
  );
  const to = Math.min(
    24 * 60,
    Math.max(17 * 60, Math.ceil(Math.max(...timed.map(endOf)) / 60) * 60),
  );
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from / 60 + i);
  const y = (m: number) => ((m - from) / 60) * HOUR;

  const { lane, cluster } = layoutDay(timed);

  return (
    <div className="relative ml-1" style={{ height: y(to) + 8 }}>
      {hours.map((h) => (
        <div
          key={h}
          className="absolute inset-x-0 flex items-start gap-2"
          style={{ top: y(h * 60) }}
        >
          <span className="-mt-1.5 w-12 shrink-0 text-right text-[10px] tabular-nums text-neutral-500">
            {h < 24 ? clock(h * 60) : ""}
          </span>
          <span className="h-px flex-1 bg-line-soft" />
        </div>
      ))}
      <div className="absolute inset-y-0 left-14 right-0">
        {timed.map((e, i) => {
          const n = cluster[i];
          const style = {
            top: y(e.start!),
            height: Math.max(22, y(endOf(e)) - y(e.start!) - 2),
            left: `${(lane[i] / n) * 100}%`,
            width: `calc(${100 / n}% - 2px)`,
          };
          const cls = `absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[12px] leading-tight ${
            e.kind === "event" ? "border-line bg-line-soft" : "border-accent/40 bg-accent/10"
          } ${isActive(e) ? "ring-1 ring-accent" : ""}`;
          const inner = (
            <>
              <span className="block truncate font-medium">{e.title}</span>
              <span className="block truncate text-[10px] text-neutral-500">
                {clock(e.start!)} · {KIND[e.kind]}
              </span>
            </>
          );
          const go = onOpen(e);
          return go ? (
            <button key={e.key} type="button" onClick={go} style={style} className={cls}>
              {inner}
            </button>
          ) : (
            <div key={e.key} style={style} className={cls}>
              {inner}
            </div>
          );
        })}
        {nowMin !== null && nowMin >= from && nowMin <= to && (
          <span className="absolute inset-x-0 h-px bg-accent" style={{ top: y(nowMin) }} />
        )}
      </div>
    </div>
  );
}
