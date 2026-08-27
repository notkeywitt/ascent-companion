"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JobPicker, jobLabel, type JobRef } from "@/components/JobPicker";
import { Banner, Button, Card, Chip, Input, Label, Loading, SectionLabel } from "@/components/ui";
import { clockOfMinutes, minutesOfClock, orgParts, prettyClock, spanHours } from "@/lib/orgTime";

/**
 * THE TIME & LABOR PANEL — the bill coding card's twin, for one time entry.
 *
 * Tracking Sheets' "Time & labor" block used to be a reference list with a
 * link out to Labor Review: you could see that Tuesday's eight hours landed on
 * General Labor, and then you left the page to do anything about it. This is
 * the panel that closes that loop — click an entry, fix it in the same column
 * the bills are coded in.
 *
 * FOUR EDITS, one write. Cost code, the hours worked, the day, and the job. They
 * travel together because they're one correction: "that was Thursday, on the
 * other house, and it was six hours not eight."
 *
 * SAVES IMMEDIATELY — deliberately unlike the board around it. Bill-line recodes
 * stage because the whole point is trying a month of moves against the budget
 * before committing them; an entry that was logged on the wrong day is simply
 * wrong, and there is nothing to try. It follows the coding card's own rule for
 * structural edits (combine, buyback, delete): those write now, coding stages.
 *
 * WHAT JOBTREAD DOES WITH IT — all of it probe-confirmed (2026-08-25; the note
 * on updateTimeEntry in lib/jobtread.ts carries the numbers):
 *   - a RECODE moves the labor between cost codes at exactly the cost already on
 *     the entry;
 *   - a RE-TIME changes the dollars. JobTread derives minutes from the new span
 *     and cost is minutes × the pay type's rate, so 2h → 3h took $150 to $225.
 *     The panel warns on screen rather than letting that surprise anyone;
 *   - a JOB MOVE only works together with a cost code on the target job — cost
 *     items are per-job, and JobTread rejects the move without one. Hence the
 *     fetch of the target job's own leaves below.
 */

/** The entry as the board holds it — same shape as lib's MonthTimeEntry. */
export interface TimeEntryRow {
  id: string;
  employee: string;
  startedAt: string | null;
  endedAt: string | null;
  hours: number;
  minutes: number;
  cost: number;
  code: string;
  codeName: string;
  notes: string;
  isApproved: boolean;
  costItemId: string | null;
  type: string;
}

interface BudgetLeaf {
  id: string;
  number: string;
  name: string;
  detail?: string;
  costType?: string;
  cost?: number;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The coding targets for LABOR: the job's Labor-typed leaves, plus whatever
 * leaf an entry already sits on even when it isn't typed Labor (otherwise the
 * dropdown would silently disagree with the entry it's describing). Same rule
 * Labor Review uses — and the exact opposite of the bill board's `codeOptions`,
 * which excludes Labor leaves because bills don't belong on them.
 */
export function laborOptions(budget: BudgetLeaf[], inUse: Iterable<string | null>): Option[] {
  const used = new Set([...inUse].filter(Boolean) as string[]);
  return budget
    .filter((b) => (b.costType ?? "").trim().toLowerCase() === "labor" || used.has(b.id))
    .map((b) => ({
      id: b.id,
      number: b.number,
      name: b.name,
      detail: b.detail,
      costType: b.costType,
      cost: b.cost,
    }));
}

export function TimeCodingCard({
  entry,
  jobId,
  codeOptions,
  writes,
  onSaved,
  onClose,
}: {
  entry: TimeEntryRow;
  jobId: string;
  /** The CURRENT job's labor leaves. A job move fetches the target's own. */
  codeOptions: Option[];
  writes: boolean;
  /** Reload the board — the entry's cost code, hours, day or job just moved. */
  onSaved: () => void;
  onClose: () => void;
}) {
  const started = useMemo(() => orgParts(entry.startedAt), [entry.startedAt]);
  const ended = useMemo(() => orgParts(entry.endedAt), [entry.endedAt]);

  const [job, setJob] = useState<JobRef | null>(null);
  const [leafId, setLeafId] = useState(entry.costItemId ?? "");
  const [date, setDate] = useState(started.date);
  const [start, setStart] = useState(started.time);
  const [end, setEnd] = useState(ended.time);
  const [hoursText, setHoursText] = useState(entry.hours ? entry.hours.toFixed(2) : "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  // Another entry clicked: the panel is describing something else now, so every
  // field resets to what JobTread has for THAT entry. Keyed on the id alone —
  // a reload that returns the same entry unchanged must not wipe an edit in
  // progress, and re-running on every `entry` identity would do exactly that.
  useEffect(() => {
    setJob(null);
    setLeafId(entry.costItemId ?? "");
    setDate(started.date);
    setStart(started.time);
    setEnd(ended.time);
    setHoursText(entry.hours ? entry.hours.toFixed(2) : "");
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  /* ---- moving the entry to another job ----
     Cost items are per-job, so the code picked on THIS job means nothing on the
     next one. The target job's own leaves are fetched and the coding is cleared
     back to "pick one" rather than carrying an id that would be rejected. */
  const [otherLeaves, setOtherLeaves] = useState<Option[]>([]);
  const [leavesLoading, setLeavesLoading] = useState(false);
  const [leavesError, setLeavesError] = useState("");
  const movingJob = Boolean(job && job.id !== jobId);

  useEffect(() => {
    if (!job || job.id === jobId) {
      // Back on the entry's own job — including "picked another job, then
      // picked this one again". The coding this effect cleared has to come
      // back with it, or Save would send an empty cost code.
      setOtherLeaves([]);
      setLeavesError("");
      setLeafId((prev) => (prev ? prev : (entry.costItemId ?? "")));
      return;
    }
    let alive = true;
    setLeavesLoading(true);
    setLeavesError("");
    setLeafId("");
    (async () => {
      try {
        const r = await fetch(`/api/time-entry?jobId=${encodeURIComponent(job.id)}`, {
          cache: "no-store",
        });
        const b = await r.json();
        if (!alive) return;
        if (b.error) setLeavesError(b.error);
        else setOtherLeaves(laborOptions((b.budget ?? []) as BudgetLeaf[], []));
      } catch (e) {
        if (alive) setLeavesError(e instanceof Error ? e.message : "Failed to load cost codes");
      } finally {
        if (alive) setLeavesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [job, jobId, entry.costItemId]);

  const options = movingJob ? otherLeaves : codeOptions;

  /* ---- hours ↔ end time ----
     Two ways to say the same thing, so each writes the other. Moving the START
     keeps the DURATION (the crew started an hour later, they didn't work an
     hour less), typing an END sets the duration, and typing HOURS sets the end. */
  const spanned = spanHours(start, end);

  const changeStart = useCallback(
    (v: string) => {
      const s = minutesOfClock(v);
      const keep = spanHours(start, end);
      setStart(v);
      if (s != null && keep != null && end) setEnd(clockOfMinutes(s + keep * 60));
    },
    [start, end],
  );
  const changeEnd = useCallback(
    (v: string) => {
      setEnd(v);
      const h = spanHours(start, v);
      if (h != null) setHoursText(h.toFixed(2));
    },
    [start],
  );
  const changeHours = useCallback(
    (v: string) => {
      setHoursText(v);
      const h = Number(v);
      const s = minutesOfClock(start);
      if (s != null && Number.isFinite(h) && h > 0 && h <= 24) setEnd(clockOfMinutes(s + h * 60));
    },
    [start],
  );

  const timeChanged = date !== started.date || start !== started.time || end !== ended.time;
  const codeChanged = leafId !== (entry.costItemId ?? "");
  const dirty = timeChanged || codeChanged || movingJob;

  // An entry with no end time is still running — JobTread derives nothing to
  // rewrite, and clock-out belongs on the Employee Time page, not here.
  const openEntry = !entry.endedAt;

  const canSave =
    writes &&
    dirty &&
    !saving &&
    !openEntry &&
    Boolean(date && start) &&
    (!movingJob || Boolean(leafId)) &&
    (!timeChanged || (spanned != null && spanned > 0));

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body: Record<string, string> = { id: entry.id };
      if (movingJob && job) body.jobId = job.id;
      if (codeChanged || movingJob) body.costItemId = leafId;
      if (timeChanged) {
        body.date = date;
        body.startTime = start;
        if (end) body.endTime = end;
      }
      const r = await fetch("/api/time-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const b = await r.json();
      if (b.error) {
        setMsg({ tone: "error", text: b.error });
      } else if (b.previewed) {
        setMsg({ tone: "info", text: b.message });
      } else {
        setMsg({ tone: "success", text: "Saved to JobTread." });
        onSaved();
      }
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  function revert() {
    setJob(null);
    setLeafId(entry.costItemId ?? "");
    setDate(started.date);
    setStart(started.time);
    setEnd(ended.time);
    setHoursText(entry.hours ? entry.hours.toFixed(2) : "");
    setMsg(null);
  }

  return (
    <Card className="max-h-[85dvh] overflow-y-auto">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold">{entry.employee}</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-xs font-semibold text-neutral-400 transition hover:text-accent"
        >
          Close
        </button>
      </div>
      <p className="mb-2 min-w-0 truncate text-xs text-neutral-500">
        {money(entry.cost)} · {entry.hours.toFixed(2)}h{entry.type ? ` · ${entry.type}` : ""}
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {entry.isApproved ? (
          <Chip tone="success">approved</Chip>
        ) : (
          <Chip tone="warning">unapproved</Chip>
        )}
        {openEntry && <Chip tone="info">still running</Chip>}
      </div>

      {!writes && (
        <Banner tone="warning" className="mb-3 !py-1.5 !text-[11px]">
          Writes are off, so this panel is read-only.
        </Banner>
      )}
      {openEntry && (
        <Banner tone="info" className="mb-3 !py-1.5 !text-[11px]">
          This entry has no clock-out yet. It gets its hours when it&apos;s closed out — edit it after
          that.
        </Banner>
      )}

      <div className="space-y-3">
        {/* ---- coding ---- */}
        <div>
          <Label>Cost code</Label>
          {leavesLoading ? (
            <Loading label="Loading that job's cost codes…" />
          ) : leavesError ? (
            <Banner tone="error" className="!py-1.5 !text-[11px]">
              {leavesError}
            </Banner>
          ) : options.length === 0 ? (
            <p className="text-xs text-neutral-500">
              This job has no labor budget lines to code time to.
            </p>
          ) : (
            <CostCodeSelect options={options} value={leafId} onChange={setLeafId} />
          )}
          {!codeChanged && !movingJob && entry.code && (
            <p className="mt-1 text-[11px] text-neutral-400">
              On {entry.code} {entry.codeName}
            </p>
          )}
        </div>

        {/* ---- the day ---- */}
        <div>
          <Label htmlFor="te-date">Date</Label>
          <Input
            id="te-date"
            type="date"
            value={date}
            disabled={!writes || openEntry}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* ---- the window worked ----
            Start and end are what JobTread stores; hours is the third side of
            the same triangle, offered because "make it six hours" is how the
            correction usually arrives. */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label htmlFor="te-start">Start</Label>
            <Input
              id="te-start"
              type="time"
              value={start}
              disabled={!writes || openEntry}
              onChange={(e) => changeStart(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="te-end">End</Label>
            <Input
              id="te-end"
              type="time"
              value={end}
              disabled={!writes || openEntry}
              onChange={(e) => changeEnd(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="te-hours">Hours</Label>
            <Input
              id="te-hours"
              type="number"
              inputMode="decimal"
              min="0"
              max="24"
              step="0.25"
              value={hoursText}
              disabled={!writes || openEntry}
              onChange={(e) => changeHours(e.target.value)}
              className="tabular-nums"
            />
          </div>
        </div>
        {start && end && (
          <p className="text-[11px] text-neutral-400">
            {prettyClock(start)} – {prettyClock(end)}
            {spanned != null ? ` · ${spanned.toFixed(2)}h` : ""}
            {spanned != null && minutesOfClock(end)! <= minutesOfClock(start)! ? " (next day)" : ""}
          </p>
        )}
        {/* JobTread's own minute count can be SHORTER than the span — a break
            deduction — so a rewritten span quietly drops that deduction. Say it
            where the difference is visible, not after the fact. */}
        {!openEntry && Math.abs(entry.minutes - (spanHours(started.time, ended.time) ?? 0) * 60) > 1 && (
          <Banner tone="warning" className="!py-1.5 !text-[11px]">
            JobTread counts {(entry.minutes / 60).toFixed(2)}h on this entry, but its clock reads{" "}
            {(spanHours(started.time, ended.time) ?? 0).toFixed(2)}h — usually a deducted break.
            Saving new times replaces both figures with the span you set.
          </Banner>
        )}
        {timeChanged && (
          <Banner tone="info" className="!py-1.5 !text-[11px]">
            The cost follows the hours — JobTread recalculates it as the new hours × this entry&apos;s
            pay rate.
          </Banner>
        )}

        {/* ---- the job ---- */}
        <div>
          <Label>Job</Label>
          <JobPicker
            value={job?.id ?? jobId}
            onChange={() => {
              /* the picker's id is mirrored through onSelect below */
            }}
            onSelect={(j) => setJob(j)}
            includeAll={false}
          />
          {movingJob && job && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              Moving to {jobLabel(job)} — pick a cost code on that job above. The entry leaves this
              month&apos;s board.
            </p>
          )}
        </div>

        {entry.notes && (
          <div>
            <Label>Note</Label>
            <p className="whitespace-pre-line rounded-lg bg-neutral-50 p-2 text-[11px] leading-snug text-neutral-600 dark:bg-ink-raised/60 dark:text-neutral-400">
              {entry.notes}
            </p>
          </div>
        )}
      </div>

      {msg && (
        <Banner tone={msg.tone} className="mt-3 !py-1.5 !text-[11px]">
          {msg.text}
        </Banner>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!canSave} className="flex-1">
          {saving ? "Saving…" : "Save to JobTread"}
        </Button>
        <Button variant="secondary" size="sm" onClick={revert} disabled={!dirty || saving}>
          Revert
        </Button>
      </div>
    </Card>
  );
}
