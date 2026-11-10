"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, btn, Button, Card, Checkbox, Chip, Dialog, EmptyState, ListCard, Loading, MetaLine, PageHeader, SectionHeading, Segmented, tableCls } from "@/components/ui";
import { matchesAllWords } from "@/lib/searchWords";
import { addDays, calendarWeeks } from "@/lib/timeEntryDates";
import { dayNum } from "@/lib/toolSchedule";
import { setUrlParam } from "@/lib/urlParam";
import type { RuleMatch } from "@/lib/toolSchedule";
import type { ToolSchedulePayload, ToolScheduleRow } from "@/lib/toolScheduleData";
import { BookingForm } from "./BookingForm";
import { assignLanes, filterScheduleByJobs, jobColourIndex, jobsInView, needsOnDay, weeksOfNeed } from "@/lib/toolScheduleView";

/**
 * The tool schedule: which tool types each job needs on which days, from the
 * JobTread schedules, against what the company owns (docs/plans/TOOL_SCHEDULE_PLAN.md).
 * Three views of the same answer — Gantt, calendar, list — and a detail dialog
 * per tool type. Read only; the office edits what it counts on /tool-schedule/edit.
 */

type View = "gantt" | "calendar" | "list";
const VIEWS: readonly View[] = ["gantt", "calendar", "list"];
type Months = "1" | "3" | "6";

const VIEW_OPTIONS = [
  { value: "gantt", label: "Gantt" },
  { value: "calendar", label: "Calendar" },
  { value: "list", label: "List" },
] as const;
const RANGE_OPTIONS = [
  { value: "1", label: "1 month" },
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
] as const;

const fmt = (iso: string, year = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
  });
const span = (a: string, b: string) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`);
const jobColour = (i: number | undefined) => `var(--viz-${(i ?? 0) + 1})`;

const HIDDEN_KEY = "toolSchedule.hiddenJobs";

/** Where a task's tools came from, under its name in the detail dialog. */
const VIA_TEXT: Record<RuleMatch, string> = {
  task: "Tools set for this task",
  name: "Tools set for this task name",
  taskType: "Tools from its task type",
  phase: "Tools from its phase",
};

function readPref<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && ok.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private window: the choice just isn't remembered */
  }
}

export function ToolSchedule({ canEdit }: { canEdit: boolean }) {
  const [view, setView] = useState<View>("gantt");
  const [months, setMonths] = useState<Months>("6");
  const [data, setData] = useState<ToolSchedulePayload | null>(null);
  const [error, setError] = useState("");
  const [openKind, setOpenKind] = useState<string | null>(null);
  // Jobs the person hid. Hidden, not chosen, so a job that is new shows by default.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // The booking dialog: null closed, "" open with no tool type chosen, else that type.
  const [booking, setBooking] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    // A link's ?view (from a notice, or a pasted address) wins over the device's last choice.
    const linked = new URLSearchParams(window.location.search).get("view") as View | null;
    const start = linked && VIEWS.includes(linked) ? linked : readPref<View>("toolSchedule.view", VIEWS, "gantt");
    setView(start);
    // Shown in the address bar too, so copying it copies the view on screen.
    setUrlParam("view", start);
    setMonths(readPref<Months>("toolSchedule.months", ["1", "3", "6"], "6"));
    try {
      const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
      if (Array.isArray(saved)) setHidden(new Set(saved.map(String)));
    } catch {
      /* nothing saved, or storage is blocked */
    }
  }, []);

  function changeHidden(next: Set<string>) {
    setHidden(next);
    writePref(HIDDEN_KEY, JSON.stringify([...next]));
  }

  useEffect(() => {
    let cancelled = false;
    setError("");
    fetch(`/api/tool-schedule?months=${months}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        return j as ToolSchedulePayload;
      })
      .then((j) => !cancelled && setData(j))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [months, reload]);

  // Every job in the data, so a job or place with only a booking can be hidden too. Colours follow
  // the full list, so hiding a job does not recolour the others.
  const allJobs = useMemo(() => (data ? jobsInView(data.jobs, data.rows) : []), [data]);
  const colours = useMemo(() => jobColourIndex([...(data?.jobs ?? []).map((j) => j.id), ...allJobs.map((j) => j.id)]), [data, allJobs]);
  const hiddenCount = allJobs.filter((j) => hidden.has(j.id)).length;
  // The schedule for the jobs on view: shortfalls and missing tools are found again for them.
  const shown = useMemo<ToolSchedulePayload | null>(() => {
    if (!data) return null;
    const f = filterScheduleByJobs(data.rows, data.moves, hidden, data.from, data.to);
    return {
      ...data,
      rows: f.rows,
      moves: f.moves,
      jobs: allJobs.filter((j) => !hidden.has(j.id)),
      endsEarly: data.endsEarly.filter((j) => !hidden.has(j.id)),
    };
  }, [data, hidden, allJobs]);
  const shortCount = shown?.rows.reduce((n, r) => n + (r.missing ? 0 : r.shortfalls.length), 0) ?? 0;
  const missingCount = shown?.rows.filter((r) => r.missing).length ?? 0;
  const kind = shown?.rows.find((r) => r.kindId === openKind) ?? null;

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6 lg:max-w-6xl">
      <PageHeader
        title="Tool Schedule"
        actions={
          canEdit ? (
            <>
              <Button size="sm" onClick={() => setBooking("")}>
                Book a tool
              </Button>
              <Link href="/tool-schedule/edit" className={btn("secondary", "sm")}>
                Edit catalogue
              </Link>
            </>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Show as"
            value={view}
            options={VIEW_OPTIONS}
            onChange={(v) => {
              setView(v);
              writePref("toolSchedule.view", v);
              setUrlParam("view", v);
            }}
          />
          {data && allJobs.length > 0 && <JobFilter jobs={allJobs} hidden={hidden} onChange={changeHidden} />}
        </div>
        <Segmented
          label="How far ahead"
          value={months}
          options={RANGE_OPTIONS}
          onChange={(v) => {
            setMonths(v);
            setData(null);
            writePref("toolSchedule.months", v);
          }}
        />
      </div>

      {error && <Banner tone="error" className="mb-3">Could not load the tool schedule: {error}</Banner>}
      {!data && !error && <Loading label="Reading the JobTread schedules…" />}

      {data && shown && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {shortCount > 0 && <Chip tone="danger">{shortCount} {shortCount === 1 ? "conflict" : "conflicts"}</Chip>}
            {missingCount > 0 && <Chip tone="danger">{missingCount} missing</Chip>}
            {shown.moves.length > 0 && <Chip tone="warning">{shown.moves.length} {shown.moves.length === 1 ? "move" : "moves"} coming up</Chip>}
            <MetaLine
              items={[
                span(data.from, data.to) + ", " + data.to.slice(0, 4),
                hiddenCount > 0 ? `Showing ${allJobs.length - hiddenCount} of ${allJobs.length} jobs` : `${allJobs.length} ${allJobs.length === 1 ? "job" : "jobs"}`,
              ]}
            />
          </div>

          {data.toolsError && (
            <Banner tone="warning" className="mb-3">
              The Tools list could not be read, so every tool counts as not owned. {data.toolsError}
            </Banner>
          )}
          {data.unresolvedCount > 0 && (
            <Banner tone="warning" className="mb-3">
              {data.unresolvedCount} task {data.unresolvedCount === 1 ? "name has" : "names have"} no cost code yet, so
              {data.unresolvedCount === 1 ? " its" : " their"} tool needs are not counted.{" "}
              {canEdit && (
                <Link href="/tool-schedule/edit?tab=tasks" className="font-semibold underline">
                  Map them
                </Link>
              )}
            </Banner>
          )}

          {data.rows.length === 0 ? (
            <EmptyState>
              No tool types yet.{" "}
              {canEdit ? (
                <Link href="/tool-schedule/edit" className="font-semibold underline">
                  Add the first one
                </Link>
              ) : (
                "The office adds them."
              )}
            </EmptyState>
          ) : shown.jobs.length === 0 && allJobs.length > 0 ? (
            <EmptyState>
              No jobs selected.{" "}
              <button type="button" className="font-semibold underline" onClick={() => changeHidden(new Set())}>
                Show all
              </button>
            </EmptyState>
          ) : view === "gantt" ? (
            <Gantt data={shown} colours={colours} onOpen={setOpenKind} months={Number(months)} />
          ) : view === "calendar" ? (
            <Calendar data={shown} onOpen={setOpenKind} />
          ) : (
            <List data={shown} colours={colours} onOpen={setOpenKind} />
          )}

          {data.rows.length > 0 && view !== "calendar" && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-500 dark:text-neutral-400">
              {shown.jobs.map((j) => (
                <span key={j.id} className="inline-flex items-center gap-1.5">
                  <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: jobColour(colours.get(j.id)) }} />
                  {j.name}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-danger bg-danger/15" />
                Needs more than owned
              </span>
            </div>
          )}

          {shown.endsEarly.length > 0 && (
            <p className="mt-4 text-[12px] text-neutral-500 dark:text-neutral-400">
              Schedule ends before {fmt(data.to, true)}:{" "}
              {shown.endsEarly.map((j) => `${j.name} (${fmt(j.lastDay)})`).join(", ")}. Tool needs after those dates are not counted.
              {data.excludes.length > 0 && ` Left out by the office: ${data.excludes.map((e) => e.jobName || e.jobId).join(", ")}.`}
            </p>
          )}
        </>
      )}

      {kind && shown && (
        <KindDialog
          row={kind}
          data={shown}
          colours={colours}
          canEdit={canEdit}
          onClose={() => setOpenKind(null)}
          onBook={() => {
            setOpenKind(null);
            setBooking(kind.kindId);
          }}
        />
      )}
      {booking !== null && (
        <Dialog onClose={() => setBooking(null)} title="Book a tool" description="For a job or a place, with no JobTread task." size="md">
          <BookingForm
            kindId={booking}
            onSaved={() => {
              setBooking(null);
              setReload((n) => n + 1);
            }}
          />
        </Dialog>
      )}
    </main>
  );
}

/* --------------------------------------------------------------- Job filter */

/** Pick which jobs the schedule shows. A panel of checkboxes; a search box once the list is long. */
function JobFilter({ jobs, hidden, onChange }: { jobs: { id: string; name: string }[]; hidden: Set<string>; onChange: (h: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const hiddenCount = jobs.filter((j) => hidden.has(j.id)).length;
  const label = hiddenCount === 0 ? "All jobs" : `${jobs.length - hiddenCount} of ${jobs.length} jobs`;
  const listed = jobs.filter((j) => matchesAllWords(j.name, q));
  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setQ("");
        }}
        className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold lg:min-h-7 ${hiddenCount ? "bg-accent/15 text-accent dark:text-accent-soft" : "bg-neutral-100 text-neutral-700 dark:bg-white/[0.07] dark:text-neutral-200"}`}
      >
        {label}
        <span aria-hidden className="text-[10px]">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-2 shadow-xl shadow-black/10 dark:bg-ink-overlay dark:shadow-black/40">
          {jobs.length > 8 && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search jobs…"
              aria-label="Search jobs"
              className="mb-1 w-full rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-sm outline-none"
            />
          )}
          <div className="mb-1 flex gap-1">
            <Button variant="ghost" size="xs" onClick={() => onChange(new Set())} disabled={hiddenCount === 0}>
              All
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onChange(new Set(jobs.map((j) => j.id)))} disabled={hiddenCount === jobs.length}>
              None
            </Button>
          </div>
          <ul className="max-h-64 overflow-auto">
            {listed.map((j) => (
              <li key={j.id} className="flex min-h-9 items-center">
                <Checkbox checked={!hidden.has(j.id)} onChange={() => toggle(j.id)} label={j.name} className="w-full" />
              </li>
            ))}
            {listed.length === 0 && <li className="px-2 py-2 text-sm text-neutral-500">No job matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Gantt */

function Gantt({
  data,
  colours,
  onOpen,
  months,
}: {
  data: ToolSchedulePayload;
  colours: Map<string, number>;
  onOpen: (id: string) => void;
  months: number;
}) {
  const f = dayNum(data.from);
  const days = dayNum(data.to) - f + 1;
  const ppd = months <= 1 ? 28 : months <= 3 ? 11 : 6.5; // pixels per day
  const width = Math.round(days * ppd);
  const x = (iso: string) => Math.round((dayNum(iso) - f) * ppd);
  const clampX = (iso: string) => Math.min(width, Math.max(0, x(iso)));

  const monthTicks: { left: number; label: string }[] = [];
  const weekTicks: { left: number; label: string }[] = [];
  for (let d = 0; d < days; d++) {
    const iso = addDays(data.from, d);
    const dt = new Date(`${iso}T00:00:00Z`);
    if (d === 0 || dt.getUTCDate() === 1)
      monthTicks.push({
        left: d * ppd,
        label: dt.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", ...(d === 0 || dt.getUTCMonth() === 0 ? { year: "numeric" } : {}) }),
      });
    if (dt.getUTCDay() === 1) weekTicks.push({ left: d * ppd, label: months <= 1 ? fmt(iso) : String(dt.getUTCDate()) });
  }

  return (
    <Card pad={false} className="overflow-x-auto">
      <div className="grid min-w-max grid-cols-[9rem_auto] sm:grid-cols-[11rem_auto]">
        <div className="sticky left-0 z-20 flex h-11 items-end border-b border-r border-line bg-white px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-ink-raised dark:text-neutral-400">
          Tool
        </div>
        <div className="relative h-11 border-b border-line" style={{ width }}>
          {monthTicks.map((t) => (
            <span key={`m${t.left}`} className="absolute top-1 h-10 whitespace-nowrap border-l border-line-strong pl-1 text-[11px] font-semibold" style={{ left: t.left }}>
              {t.label}
            </span>
          ))}
          {weekTicks.map((t) => (
            <span key={`w${t.left}`} className="absolute bottom-0.5 pl-0.5 text-[10px] tabular-nums text-neutral-400" style={{ left: t.left }}>
              {t.label}
            </span>
          ))}
        </div>

        {data.rows.map((r) => {
          const { spans, lanes } = assignLanes(r.spans);
          const height = Math.max(54, lanes * 20 + 14);
          return (
            <GanttRow key={r.kindId} row={r} height={height} onOpen={onOpen}>
              <div className="relative" style={{ width, height }}>
                {weekTicks.map((t) => (
                  <span key={t.left} aria-hidden className="absolute inset-y-0 border-l border-line-soft" style={{ left: t.left }} />
                ))}
                {r.shortfalls.map((s) => (
                  <span
                    key={s.startDate}
                    title={`${span(s.startDate, s.endDate)}: need ${s.need}, own ${s.owned}`}
                    className={`absolute inset-y-0 border-x border-danger bg-danger/15 ${r.owned === 0 ? "bg-[repeating-linear-gradient(135deg,rgb(var(--danger)/0.18)_0_6px,transparent_6px_12px)]" : ""}`}
                    style={{ left: clampX(s.startDate), width: Math.max(3, clampX(addDays(s.endDate, 1)) - clampX(s.startDate)) }}
                  />
                ))}
                {spans.map((s, i) => {
                  const l = clampX(s.startDate);
                  const w = Math.max(4, clampX(addDays(s.endDate, 1)) - l - 1);
                  const what = s.source.type === "task" ? s.source.taskName : `Booked${s.source.note ? `: ${s.source.note}` : ""}`;
                  return (
                    <span
                      key={i}
                      title={`${s.jobName} · ${what} · ${span(s.startDate, s.endDate)}`}
                      className={`absolute h-4 truncate rounded px-1 text-[10px] font-medium leading-4 text-white ${s.source.type === "hold" ? "bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.28)_0_4px,transparent_4px_8px)]" : ""}`}
                      style={{ left: l, width: w, top: 7 + s.lane * 20, backgroundColor: jobColour(colours.get(s.jobId)) }}
                    >
                      {s.jobName}
                    </span>
                  );
                })}
              </div>
            </GanttRow>
          );
        })}
      </div>
    </Card>
  );
}

function GanttRow({ row, height, onOpen, children }: { row: ToolScheduleRow; height: number; onOpen: (id: string) => void; children: React.ReactNode }) {
  const state = row.missing ? (
    <span className="text-danger">None owned</span>
  ) : row.shortfalls.length ? (
    <span className="text-danger">
      Own {row.owned} · short {row.shortfalls.length}×
    </span>
  ) : (
    <span>Own {row.owned}</span>
  );
  return (
    <>
      <button
        type="button"
        onClick={() => onOpen(row.kindId)}
        className="sticky left-0 z-10 flex flex-col justify-center border-b border-r border-line-soft bg-white px-3 text-left last-of-type:border-b-0 dark:bg-ink-raised"
        style={{ height }}
      >
        <span className="truncate text-sm font-semibold">{row.name}</span>
        <span className="text-[12px] text-neutral-500 dark:text-neutral-400">{state}</span>
      </button>
      <button type="button" onClick={() => onOpen(row.kindId)} aria-label={`${row.name} details`} className="block border-b border-line-soft text-left">
        {children}
      </button>
    </>
  );
}

/* ---------------------------------------------------------------- Calendar */

function Calendar({ data, onOpen }: { data: ToolSchedulePayload; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(data.from.slice(0, 7));
  const [day, setDay] = useState(data.from);
  const first = `${month}-01`;
  const d = new Date(`${first}T00:00:00Z`);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const weeks = calendarWeeks(first, last);
  const shift = (n: number) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 7);
    if (t >= data.from.slice(0, 7) && t <= data.to.slice(0, 7)) setMonth(t);
  };
  const today = data.from;
  const sel = needsOnDay(data.rows, day);
  const navCls = "inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-line-strong text-lg disabled:opacity-30";

  return (
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <button type="button" className={navCls} onClick={() => shift(-1)} disabled={month <= data.from.slice(0, 7)} aria-label="Previous month">
          ‹
        </button>
        <span className="text-sm font-semibold">
          {d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}
        </span>
        <button type="button" className={navCls} onClick={() => shift(1)} disabled={month >= data.to.slice(0, 7)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
          <div key={w} className="border-b border-line px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {w}
          </div>
        ))}
        {weeks.flat().map((iso) => {
          const inMonth = iso.slice(0, 7) === month;
          const inRange = iso >= data.from && iso <= data.to;
          const needs = inRange ? needsOnDay(data.rows, iso) : [];
          return (
            <button
              key={iso}
              type="button"
              onClick={() => setDay(iso)}
              aria-label={`${fmt(iso)}: ${needs.length} tools needed`}
              className={`flex min-h-[3.25rem] min-w-0 flex-col gap-0.5 border-b border-r border-line-soft p-1 text-left sm:min-h-24 ${inMonth ? "" : "opacity-35"} ${iso === day ? "outline outline-2 -outline-offset-2 outline-accent" : ""}`}
            >
              <span className={`self-start text-[12px] font-semibold tabular-nums ${iso === today ? "rounded-full bg-accent px-1.5 text-accent-fg" : ""}`}>
                {Number(iso.slice(8))}
              </span>
              <span className="hidden flex-col gap-0.5 sm:flex">
                {needs.slice(0, 3).map((n) => (
                  <span key={n.kindId} className={`truncate text-[11px] ${n.short ? "font-semibold text-danger" : ""}`}>
                    {n.short ? "⚠ " : ""}
                    {n.name}
                    {n.need > 1 ? ` ×${n.need}` : ""}
                  </span>
                ))}
                {needs.length > 3 && <span className="text-[11px] text-neutral-500">+{needs.length - 3} more</span>}
              </span>
              <span className="flex gap-0.5 sm:hidden" aria-hidden>
                {needs.slice(0, 4).map((n) => (
                  <i key={n.kindId} className={`h-1.5 w-1.5 rounded-full ${n.short ? "bg-danger" : "bg-neutral-400"}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-1 border-t border-line p-3">
        <SectionHeading>{new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric", year: "numeric" })}</SectionHeading>
        {sel.length === 0 ? (
          <p className="text-sm text-neutral-500">The schedule needs no tools this day.</p>
        ) : (
          sel.map((n) => (
            <button key={n.kindId} type="button" onClick={() => onOpen(n.kindId)} className="flex min-h-11 items-center justify-between gap-3 text-left">
              <span className="min-w-0">
                <span className="text-sm font-semibold">{n.name}</span>{" "}
                <span className="text-[12px] text-neutral-500">{n.jobs.map((j) => j.name).join(", ")}</span>
              </span>
              <span className={`shrink-0 text-[12px] tabular-nums ${n.short ? "font-semibold text-danger" : "text-neutral-500"}`}>
                need {n.need} · own {n.owned}
              </span>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------- List */

function List({ data, colours, onOpen }: { data: ToolSchedulePayload; colours: Map<string, number>; onOpen: (id: string) => void }) {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const weeks = weeksOfNeed(data.rows, data.from, data.to)
    .map((w) => ({ ...w, needs: problemsOnly ? w.needs.filter((n) => n.short) : w.needs }))
    .filter((w) => w.needs.length);
  return (
    <div className="grid gap-5">
      <Segmented
        label="Which weeks"
        value={problemsOnly ? "short" : "all"}
        onChange={(v) => setProblemsOnly(v === "short")}
        options={[
          { value: "all", label: "Every need" },
          { value: "short", label: "Shortfalls only" },
        ]}
      />
      {data.moves.length > 0 && !problemsOnly && (
        <section>
          <SectionHeading>Moves coming up</SectionHeading>
          <ListCard className="divide-y divide-line-soft">
            {data.moves.slice(0, 12).map((m) => (
              <button key={`${m.kindId}-${m.jobId}`} type="button" onClick={() => onOpen(m.kindId)} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {m.kindName} → {m.jobName}
                  </span>
                  <span className="block truncate text-[12px] text-neutral-500">Now at {[...new Set(m.toolsAt.map((t) => t.at))].join(", ")}</span>
                </span>
                <span className="shrink-0 text-[12px] tabular-nums text-warn">by {fmt(m.by)}</span>
              </button>
            ))}
          </ListCard>
        </section>
      )}
      {weeks.length === 0 ? (
        <EmptyState>{problemsOnly ? "No shortfalls in this range." : "The schedule needs no tools in this range."}</EmptyState>
      ) : (
        weeks.map((w) => {
          const short = w.needs.filter((n) => n.short).length;
          return (
            <section key={w.week}>
              <SectionHeading trailing={short ? <span className="text-[12px] font-semibold text-danger">{short} short</span> : undefined}>
                Week of {fmt(w.week, w.week.slice(0, 4) !== data.from.slice(0, 4))}
              </SectionHeading>
              <ListCard className="divide-y divide-line-soft">
                {w.needs.map((n) => (
                  <button key={n.kindId} type="button" onClick={() => onOpen(n.kindId)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3 py-2.5 text-left">
                    <span className="text-sm font-semibold">{n.name}</span>
                    <span className={`text-right text-[12px] tabular-nums ${n.short ? "font-semibold text-danger" : "text-neutral-500"}`}>
                      {n.owned === 0 ? "None owned" : `need ${n.need} · own ${n.owned}`}
                    </span>
                    <span className="col-span-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                      {n.jobs.map((j) => (
                        <span key={j.id} className="inline-flex items-center gap-1.5">
                          <i aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: jobColour(colours.get(j.id)) }} />
                          {j.name}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </ListCard>
            </section>
          );
        })
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Detail */

function KindDialog({
  row,
  data,
  colours,
  canEdit,
  onClose,
  onBook,
}: {
  row: ToolScheduleRow;
  data: ToolSchedulePayload;
  colours: Map<string, number>;
  canEdit: boolean;
  onClose: () => void;
  onBook: () => void;
}) {
  const moves = data.moves.filter((m) => m.kindId === row.kindId);
  return (
    <Dialog
      onClose={onClose}
      title={row.name}
      description={`Own ${row.owned}${row.tools.length > row.owned ? ` usable (${row.tools.length} in the Tools list)` : ""} · ${span(data.from, data.to)}`}
      size="lg"
      footer={
        canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onBook}>
              Book this tool
            </Button>
            <Link href="/tool-schedule/edit" className={btn("secondary", "sm")}>
              Edit catalogue
            </Link>
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-5">
        <section>
          <SectionHeading>Shortfalls</SectionHeading>
          {row.shortfalls.length === 0 ? (
            <p className="text-sm text-neutral-500">None in this range.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {row.shortfalls.map((s) => (
                <li key={s.startDate} className="text-danger">
                  {span(s.startDate, s.endDate)}: need {s.need}, own {s.owned} —{" "}
                  {s.jobIds.map((id) => data.jobs.find((j) => j.id === id)?.name ?? id).join(", ")}
                </li>
              ))}
            </ul>
          )}
        </section>
        {moves.length > 0 && (
          <section>
            <SectionHeading>Moves coming up</SectionHeading>
            <ul className="grid gap-1 text-sm">
              {moves.map((m) => (
                <li key={m.jobId}>
                  To <b className="font-semibold">{m.jobName}</b> by {fmt(m.by)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <SectionHeading>Owned</SectionHeading>
          {row.tools.length === 0 ? (
            <p className="text-sm text-danger">None in the Tools list. Buy, rent or borrow one.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {row.tools.map((t) => (
                <li key={t.id} className="flex justify-between gap-3">
                  <span className={t.usable ? "" : "text-neutral-400 line-through"}>{t.name}</span>
                  <span className="text-[12px] text-neutral-500">
                    {t.usable ? `Now at ${t.at}` : t.condition}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <SectionHeading>Needed by</SectionHeading>
          {row.spans.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing scheduled in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls.root}>
                <thead>
                  <tr>
                    <th className={tableCls.th}>Job</th>
                    <th className={tableCls.th}>Task</th>
                    <th className={tableCls.th}>Dates</th>
                  </tr>
                </thead>
                <tbody>
                  {row.spans.map((s, i) => (
                    <tr key={i} className={tableCls.tr}>
                      <td className={tableCls.td}>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <i aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: jobColour(colours.get(s.jobId)) }} />
                          {s.jobName}
                        </span>
                      </td>
                      <td className={tableCls.td}>
                        {s.source.type === "task" ? (
                          <>
                            {s.source.taskName}
                            <div className="text-[11px] text-neutral-500">{VIA_TEXT[s.source.via]}</div>
                          </>
                        ) : (
                          `Booked${s.source.note ? `: ${s.source.note}` : ""}${s.qty > 1 ? ` (×${s.qty})` : ""}`
                        )}
                      </td>
                      <td className={`${tableCls.td} whitespace-nowrap tabular-nums`}>{span(s.startDate, s.endDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
