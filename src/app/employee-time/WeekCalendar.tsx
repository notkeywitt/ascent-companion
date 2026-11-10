"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  Button,
  Card,
  ChipScroller,
  FilterChip,
  IconButton,
  Loading,
  MetaLine,
  Select,
} from "@/components/ui";
import { addDays, shortDay, weekStart } from "@/lib/timeEntryDates";
import { orgDay } from "@/lib/orgTime";
import { JobPicker, type JobRef } from "@/components/JobPicker";
import {
  defaultCostCode,
  matchPayType,
  type CostCodeDefault,
  type PayTypeRule,
} from "@/lib/payTypeMatch";
import {
  DEFAULT_OTHER,
  EntryEditor,
  NewEntry,
  ReadEntry,
  type Entry,
  type NewEntryCtx,
  type User,
} from "./WeekCompare";
import { entrySpan, fmtClock, hourRange, placeBlocks, rowLabel, toMin } from "./weekGrid";

/**
 * SPLIT VIEW — CALENDAR MODE (beta). The same weeks Split View reads, drawn on
 * one time-of-day calendar instead of two customer grids. You are always on
 * it; tap other people on to lay their time beside yours. Each day column
 * splits into one lane per person, in that person's colour.
 *
 * Tap an entry to open its details below, the way a Split View cell does. Your
 * own entries edit there (the same `op: "edit"` / `op: "delete"` writes);
 * everyone else's only read. Tap an empty spot in a person's lane, or
 * "+ Add time", to log time there for that person — you or anyone else (this
 * view is admin + office only). Pick the job, and the new entry is Split
 * View's NewEntry — the Log-a-range POST /api/employee-time with that
 * person's `userId`. The server's acting-as rule (src/lib/timeSubject.ts)
 * allows someone else's only for admin and office, and the Time Entries log
 * records who filed it. Other people's time comes through
 * /api/employee-time/history `actingAs`, which the server allows for admin and
 * office only.
 */

interface Side {
  entries: Entry[];
  loading: boolean;
  err: string;
}

// One colour per person, in pick order. Literal class names so Tailwind keeps them.
const HUES = [
  { block: "border-sky-500 bg-sky-500/15", dot: "bg-sky-500" },
  { block: "border-emerald-500 bg-emerald-500/15", dot: "bg-emerald-500" },
  { block: "border-violet-500 bg-violet-500/15", dot: "bg-violet-500" },
  { block: "border-rose-500 bg-rose-500/15", dot: "bg-rose-500" },
  { block: "border-amber-500 bg-amber-500/15", dot: "bg-amber-500" },
  { block: "border-teal-500 bg-teal-500/15", dot: "bg-teal-500" },
] as const;
const MAX_PEOPLE = HUES.length;
const HOUR_PX = 44;
const SNAP_MIN = 15;

/** A new entry being placed: whose, the day, the tapped start ("" = after the day's last stop), and its job. */
interface Draft {
  who: string;
  day: string;
  start: string;
  job: { id: string; label: string } | null;
}

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const orgToday = () => orgDay(new Date().toISOString());
const hourLabel = (h: number) =>
  h === 0 || h === 24 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`;

export function WeekCalendar({
  users,
  appUserIds,
  myId,
  jobs,
  orgTypes,
  payRules,
  codeDefaults,
  onExit,
}: {
  users: User[];
  appUserIds: string[];
  myId: string;
  /** Every open job — the new entry's job list, same as Split View's. */
  jobs: JobRef[];
  orgTypes: string[];
  /** Your own job + cost code → pay type rules (/labor-rates). Anyone else's load on demand. */
  payRules: PayTypeRule[];
  /** Your own default cost code per job (/labor-rates). */
  codeDefaults: CostCodeDefault[];
  /** Back to the grid Split View. */
  onExit: () => void;
}) {
  // Everyone who signs into the app, you first.
  const people = useMemo(() => {
    const app = new Set(appUserIds);
    const rest = users
      .filter((u) => app.has(u.id) && u.id !== myId)
      .sort((a, b) => a.name.localeCompare(b.name));
    const me = users.find((u) => u.id === myId);
    return me ? [me, ...rest] : rest;
  }, [users, appUserIds, myId]);

  const [week, setWeek] = useState(() => weekStart(orgToday()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  // You, then the default comparison — the same start Split View makes.
  const [others, setOthers] = useState<string[]>(() => {
    const ty = people.find((u) => u.id !== myId && DEFAULT_OTHER.test(u.name));
    return ty ? [ty.id] : [];
  });
  const shown = useMemo(() => [myId, ...others], [myId, others]);
  const [sides, setSides] = useState<Record<string, Side>>({});
  const [sel, setSel] = useState<{ who: string; id: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Sent, not yet read back from JobTread (the create is detached), per person.
  const [pending, setPending] = useState<{ who: string; e: Entry }[]>([]);
  // Another person's pay-type rules and default cost codes, read when you add time for them.
  const [rulesFor, setRulesFor] = useState<
    Record<string, { rules: PayTypeRule[]; codeDefaults: CostCodeDefault[] }>
  >({});

  const keyOf = useCallback((id: string) => `${id}|${week}`, [week]);

  const load = useCallback(
    async (id: string, quiet = false) => {
      const key = `${id}|${days[0]}`;
      const put = (s: Side) => setSides((m) => ({ ...m, [key]: s }));
      if (!quiet) put({ entries: [], loading: true, err: "" });
      const actingAs = id && id !== myId ? `&actingAs=${encodeURIComponent(id)}` : "";
      try {
        const res = await fetch(
          `/api/employee-time/history?start=${days[0]}&end=${days[6]}${actingAs}`,
          {
            cache: "no-store",
          },
        );
        const j = await res.json();
        if (!res.ok || j.ok === false)
          put({ entries: [], loading: false, err: j.error || "Could not load the week." });
        else put({ entries: j.entries ?? [], loading: false, err: "" });
      } catch {
        put({ entries: [], loading: false, err: "Couldn't reach the server." });
      }
    },
    [days, myId],
  );

  // Load each shown person's week once; adding a person loads only that person.
  useEffect(() => {
    for (const id of shown) if (!sides[keyOf(id)]) load(id);
  }, [shown, sides, keyOf, load]);

  const nameOf = (id: string) =>
    id === myId ? "You" : (users.find((u) => u.id === id)?.name ?? "Employee");
  const hueOf = (id: string) => HUES[Math.max(0, shown.indexOf(id)) % HUES.length];

  const perPerson = shown.map((id) => {
    const side = sides[keyOf(id)];
    let entries = (side?.entries ?? []).filter((e) => days.includes(e.date));
    // A new entry shows at once, then gives way to the real one (job, day, start).
    const real = entries;
    entries = [
      ...real,
      ...pending
        .filter((p) => p.who === id)
        .map((p) => p.e)
        .filter(
          (p) =>
            days.includes(p.date) &&
            !real.some(
              (e) => e.jobId === p.jobId && e.date === p.date && e.startTime === p.startTime,
            ),
        ),
    ];
    return { id, side, entries, total: entries.reduce((s, e) => s + e.minutes, 0) };
  });

  const range = hourRange(perPerson.flatMap((p) => p.entries.map(entrySpan)));
  const hours = Array.from({ length: range.to - range.from }, (_, i) => range.from + i);
  const height = (range.to - range.from) * HOUR_PX;
  const loading = perPerson.some((p) => !p.side || p.side.loading);
  const errors = perPerson.filter((p) => p.side?.err);
  const today = orgToday();

  const picked = sel
    ? perPerson.find((p) => p.id === sel.who)?.entries.find((e) => e.id === sel.id)
    : undefined;

  // Whose time the new entry is: you, or the person whose lane you tapped.
  const subject = draft?.who ?? myId;
  const subjectRules = subject === myId ? { rules: payRules, codeDefaults } : rulesFor[subject];
  useEffect(() => {
    if (!subject || subject === myId || rulesFor[subject]) return;
    let alive = true;
    fetch(`/api/employee-time/pay-rules?actingAs=${encodeURIComponent(subject)}`)
      .then((r) => r.json())
      .then((j) =>
        j.ok === false
          ? { rules: [], codeDefaults: [] }
          : { rules: j.rules ?? [], codeDefaults: j.codeDefaults ?? [] },
      )
      .catch(() => ({ rules: [], codeDefaults: [] }))
      .then((r) => alive && setRulesFor((m) => ({ ...m, [subject]: r })));
    return () => {
      alive = false;
    };
  }, [subject, myId, rulesFor]);

  const entriesOf = (id: string) => perPerson.find((p) => p.id === id)?.entries ?? [];
  const theirs = entriesOf(subject);
  const subjectTypes = users.find((u) => u.id === subject)?.types?.map((t) => t.name) ?? orgTypes;
  const lastStop = (day: string) =>
    theirs
      .filter((e) => e.date === day && e.endTime)
      .map((e) => e.endTime)
      .sort()
      .pop() ?? "07:00";
  const ctx: NewEntryCtx = {
    myId: subject,
    myName: users.find((u) => u.id === subject)?.name ?? "",
    payTypes: subjectTypes,
    payFor: (jobId, costCode) => {
      const t = matchPayType(subjectRules?.rules ?? [], { jtUserId: subject, jobId, costCode });
      return subjectTypes.includes(t) ? t : "";
    },
    payHint: theirs.find((e) => e.payType)?.payType ?? "",
    codeFor: (jobId) =>
      defaultCostCode(subjectRules?.codeDefaults ?? [], { jtUserId: subject, jobId }),
    costHint: (jobId) =>
      perPerson.flatMap((p) => p.entries).find((e) => e.jobId === jobId && e.costItemId)
        ?.costItemId ?? "",
    startHint: (day) => (draft?.day === day && draft.start ? draft.start : lastStop(day)),
    onCreated: (e) => {
      const who = subject;
      setPending((p) => [...p, { who, e }]);
      setDraft(null);
      setSel({ who, id: e.id });
      // The JobTread write finishes after the answer, so look twice.
      setTimeout(() => load(who, true), 5000);
      setTimeout(() => load(who, true), 15000);
    },
  };

  /** Open a new entry for `who` on `day`. The job starts as the one they were on just before. */
  function startDraft(who: string, day: string, start: string) {
    const before = entriesOf(who)
      .filter((e) => e.date === day && e.jobId && (!start || e.startTime <= start))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .pop();
    setSel(null);
    setDraft({
      who,
      day,
      start,
      job: before ? { id: before.jobId, label: rowLabel(before) } : null,
    });
  }

  /** Change whose entry it is. Someone not on the calendar yet is added, so the new entry shows. */
  function setDraftWho(who: string) {
    if (!draft) return;
    if (!shown.includes(who) && others.length + 1 < MAX_PEOPLE) setOthers((o) => [...o, who]);
    setDraft({ ...draft, who });
  }

  function toggle(id: string) {
    setOthers((o) =>
      o.includes(id) ? o.filter((x) => x !== id) : o.length + 1 < MAX_PEOPLE ? [...o, id] : o,
    );
    if (sel?.who === id) setSel(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label="Previous week" onClick={() => setWeek((w) => addDays(w, -7))}>
          ‹
        </IconButton>
        <span className="min-w-40 text-center text-sm font-bold tabular-nums">
          {shortDay(days[0])} – {shortDay(days[6])}, {days[6].slice(0, 4)}
        </span>
        <IconButton label="Next week" onClick={() => setWeek((w) => addDays(w, 7))}>
          ›
        </IconButton>
        <Button variant="secondary" size="sm" onClick={() => setWeek(weekStart(orgToday()))}>
          This week
        </Button>
        <Button
          size="sm"
          onClick={() => startDraft(myId, days.includes(orgToday()) ? orgToday() : days[0], "")}
        >
          + Add time
        </Button>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Beta
          </span>
          <Button variant="secondary" size="xs" onClick={onExit}>
            Back to Split View
          </Button>
        </span>
      </div>

      <ChipScroller>
        {people.map((u) => {
          const me = u.id === myId;
          const on = me || others.includes(u.id);
          const full = !on && others.length + 1 >= MAX_PEOPLE;
          return (
            <FilterChip
              key={u.id}
              on={on}
              onClick={() => !me && !full && toggle(u.id)}
              title={
                me
                  ? "Your time is always shown"
                  : full
                    ? `Up to ${MAX_PEOPLE} people at once`
                    : undefined
              }
            >
              {on && <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${hueOf(u.id).dot}`} />}
              {me ? `${u.name} (you)` : u.name}
            </FilterChip>
          );
        })}
      </ChipScroller>

      <MetaLine
        items={perPerson.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`h-2 w-2 rounded-full ${hueOf(p.id).dot}`} />
            {nameOf(p.id)} {fmtClock(p.total) || "0:00"}
          </span>
        ))}
      />

      {errors.map((p) => (
        <Banner key={p.id} tone="error">
          {nameOf(p.id)}: {p.side?.err}
        </Banner>
      ))}

      <Card pad={false} className="overflow-x-auto">
        {loading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : (
          <div
            className="grid"
            style={{
              gridTemplateColumns: `3.25rem repeat(7, minmax(${Math.max(6, shown.length * 3)}rem, 1fr))`,
            }}
          >
            {/* Day headings. */}
            <div className="sticky left-0 z-10 border-b border-line-soft bg-white dark:bg-ink-raised" />
            {days.map((d) => (
              <div
                key={d}
                className={`border-b border-l border-line-soft px-2 py-1.5 text-center text-xs font-semibold ${
                  d === today ? "text-accent" : "text-neutral-500"
                }`}
              >
                {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
                  timeZone: "UTC",
                  weekday: "short",
                })}
                <span className="block font-normal tabular-nums">
                  {d.slice(5).replace("-", "/")}
                </span>
              </div>
            ))}

            {/* Hour gutter. */}
            <div className="sticky left-0 z-10 bg-white dark:bg-ink-raised" style={{ height }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="pr-1.5 text-right text-[10px] text-neutral-500 tabular-nums"
                  style={{ height: HOUR_PX }}
                >
                  {hourLabel(h)}
                </div>
              ))}
            </div>

            {days.map((d) => (
              <div
                key={d}
                className="relative cursor-cell border-l border-line-soft"
                style={{ height }}
                title="Tap to add time here"
                onClick={(ev) => {
                  // An empty spot: a new entry for the person whose lane you tapped,
                  // starting where you tapped.
                  const box = ev.currentTarget.getBoundingClientRect();
                  const lane = Math.min(
                    shown.length - 1,
                    Math.max(0, Math.floor(((ev.clientX - box.left) / box.width) * shown.length)),
                  );
                  const min =
                    range.from * 60 +
                    Math.floor((((ev.clientY - box.top) / HOUR_PX) * 60) / SNAP_MIN) * SNAP_MIN;
                  startDraft(shown[lane], d, hhmm(Math.min(Math.max(min, 0), 24 * 60 - SNAP_MIN)));
                }}
              >
                {draft?.day === d && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute rounded border-2 border-dashed border-accent"
                    style={{
                      top: ((toMin(ctx.startHint(d)) - range.from * 60) / 60) * HOUR_PX,
                      height: HOUR_PX,
                      left: `calc(${(Math.max(0, shown.indexOf(draft.who)) * 100) / shown.length}% + 1px)`,
                      width: `calc(${100 / shown.length}% - 2px)`,
                    }}
                  />
                )}
                {hours.map((h) => (
                  <div
                    key={h}
                    aria-hidden
                    className="absolute inset-x-0 border-t border-line-soft"
                    style={{ top: (h - range.from) * HOUR_PX }}
                  />
                ))}
                {perPerson.map((p, lane) =>
                  placeBlocks(p.entries.filter((e) => e.date === d)).map((b) => {
                    const laneW = 100 / shown.length;
                    const on = sel?.who === p.id && sel.id === b.e.id;
                    const label = rowLabel(b.e);
                    return (
                      <button
                        key={`${p.id}-${b.e.id}`}
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setDraft(null);
                          setSel(on ? null : { who: p.id, id: b.e.id });
                        }}
                        title={`${nameOf(p.id)} · ${label} · ${b.e.startTime}–${b.e.endTime || "now"} · ${fmtClock(b.e.minutes) || "open"}`}
                        className={`absolute overflow-hidden rounded border-l-[3px] px-1 py-0.5 text-left text-[10px] leading-tight ${
                          hueOf(p.id).block
                        } ${on ? "z-10 ring-2 ring-accent" : "hover:brightness-95"}`}
                        style={{
                          top: ((b.start - range.from * 60) / 60) * HOUR_PX,
                          height: Math.max(((b.end - b.start) / 60) * HOUR_PX - 1, 18),
                          left: `calc(${lane * laneW + (b.col * laneW) / b.cols}% + 1px)`,
                          width: `calc(${laneW / b.cols}% - 2px)`,
                        }}
                      >
                        <span className="block font-semibold tabular-nums">
                          {fmtClock(b.e.minutes) || "open"}
                          {(b.e.open || b.e.pending) && " •"}
                        </span>
                        <span className="block break-words">{label}</span>
                      </button>
                    );
                  }),
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {sel && picked && (
        <Card className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500">
            <span aria-hidden className={`h-2 w-2 rounded-full ${hueOf(sel.who).dot}`} />
            {nameOf(sel.who)} · {rowLabel(picked)} · {shortDay(picked.date)}
          </p>
          {sel.who === myId && !picked.pending && !picked.open ? (
            <EntryEditor
              key={picked.id}
              e={picked}
              label={rowLabel(picked)}
              onSaved={() => load(myId, true)}
            />
          ) : (
            <ReadEntry e={picked} />
          )}
        </Card>
      )}
      {draft && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-neutral-500">
            <span aria-hidden className={`h-2 w-2 rounded-full ${hueOf(draft.who).dot}`} />
            New entry for
            <Select
              aria-label="Employee"
              value={draft.who}
              onChange={(ev) => setDraftWho(ev.target.value)}
              className="w-auto"
            >
              {people
                .filter((u) => shown.includes(u.id) || others.length + 1 < MAX_PEOPLE)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.id === myId ? " (you)" : ""}
                  </option>
                ))}
            </Select>
            on
            <Select
              aria-label="Day"
              value={draft.day}
              onChange={(ev) => setDraft({ ...draft, day: ev.target.value, start: "" })}
              className="w-auto"
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {shortDay(d)}
                </option>
              ))}
            </Select>
          </div>
          <div className="max-w-sm">
            <JobPicker
              value={draft.job?.id ?? ""}
              onChange={() => {}}
              onSelect={(j) =>
                setDraft({
                  ...draft,
                  job: j
                    ? { id: j.id, label: rowLabel({ customer: j.customer ?? "", jobName: j.name }) }
                    : null,
                })
              }
              jobs={jobs}
              includeAll={false}
              placeholder={draft.job?.label ?? "Pick a job…"}
            />
          </div>
          {draft.job && draft.who !== myId && !subjectRules ? (
            <Loading />
          ) : draft.job ? (
            <NewEntry
              key={`${draft.who}-${draft.job.id}-${draft.day}-${draft.start}`}
              jobId={draft.job.id}
              label={draft.job.label}
              day={draft.day}
              open
              ctx={ctx}
              onCancel={() => setDraft(null)}
            />
          ) : (
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          )}
        </Card>
      )}
      {!sel && !draft && !loading && (
        <p className="text-center text-xs text-neutral-500">
          Tap an entry to see its note and details. Tap an empty spot in a lane to add time for that
          person.
        </p>
      )}
    </div>
  );
}
