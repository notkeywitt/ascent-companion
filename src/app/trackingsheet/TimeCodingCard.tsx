"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import { JobPicker, jobLabel, type JobRef } from "@/components/JobPicker";
import { Banner, Button, Card, Chip, Input, Label, Loading, Select } from "@/components/ui";
import { JtLink } from "@/components/JtLink";
import { jtTimeUrl } from "@/lib/jtLinks";
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
 * FIVE EDITS, one write. Cost code, the hours worked, the day, the job, and the
 * PAY TYPE — the labor rate the entry is charged at. They travel together
 * because they're one correction: "that was Thursday, on the other house, six
 * hours not eight, and at the Ruhmann rate."
 *
 * APPROVING IS A FIFTH PRESS, not a fifth field. It writes `isApproved` on its
 * own, so approving hours can never also rewrite them — and it is disabled
 * while an edit is pending, because the write reloads the board under it.
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
 *     fetch of the target job's own leaves below;
 *   - a PAY TYPE change RE-RATES the entry (probed 2026-09-08): sending
 *     `type: "Ruhmann-Warren - PM"` on an $85/h entry came back hourlyRate 95
 *     and cost 170 → 190, minutes untouched. Only a type the MEMBER already
 *     carries is legal — anything else is HTTP 400 "Unknown time entry type
 *     '<name>' for user <who>" — which is why a rate this person lacks has to
 *     be added to their membership first, and why the panel offers that.
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
  /** The JobTread user id behind `employee` — the link out, and the key the
   *  member's own pay types are looked up by. */
  userId?: string;
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
  const [payType, setPayType] = useState(entry.type);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
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
    setPayType(entry.type);
    setNewRate(null);
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  /* ---- the labor rate ----
     JobTread keeps rates on the MEMBERSHIP, as named pay types, and an entry
     names one of them. So the choices here are this person's own types, read
     off the same route /labor-rates uses — no second endpoint, and no second
     idea of what a rate is.

     THE FETCH IS ALLOWED TO FAIL, silently. /api/labor-rates is office/admin;
     Tracking Sheets reaches further down the roles. A lead therefore sees the
     entry's rate written on the card and no control to change it, which is the
     correct outcome — the route the Save would call refuses the field for that
     role too. */
  const [rates, setRates] = useState<{ name: string; hourlyRate: number }[] | null>(null);
  const [membershipId, setMembershipId] = useState("");
  const [newRate, setNewRate] = useState<{ name: string; rate: string } | null>(null);
  const [addingRate, setAddingRate] = useState(false);

  const loadRates = useCallback(async () => {
    if (!entry.userId) return;
    try {
      const r = await fetch("/api/labor-rates/members", { cache: "no-store" });
      if (!r.ok) return;
      const b = await r.json();
      const me = (b.members ?? []).find(
        (m: { userId?: string }) => m.userId === entry.userId,
      ) as { membershipId?: string; types?: { name: string; hourlyRate: number }[] } | undefined;
      if (!me) return;
      setMembershipId(me.membershipId ?? "");
      setRates(me.types ?? []);
    } catch {
      /* read-only nicety — the panel works without it */
    }
  }, [entry.userId]);

  useEffect(() => {
    setRates(null);
    setMembershipId("");
    void loadRates();
  }, [loadRates]);

  const rateOf = (name: string) => rates?.find((t) => t.name === name)?.hourlyRate ?? null;
  const typeChanged = payType !== entry.type;

  /** Add a pay type to THIS person's membership, then select it.
   *  Additive server-side (mode "applyRate" reads their current set and writes
   *  it back with this one upserted), so it can't drop another rate. */
  async function addRate() {
    const name = (newRate?.name ?? "").trim();
    const hourlyRate = Number(String(newRate?.rate ?? "").replace(/[$,\s]/g, ""));
    if (!name || !Number.isFinite(hourlyRate) || hourlyRate < 0 || !membershipId) return;
    setAddingRate(true);
    setMsg(null);
    try {
      const r = await fetch("/api/labor-rates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "applyRate", membershipIds: [membershipId], rate: { name, hourlyRate } }),
      });
      const b = await r.json();
      if (b.error) setMsg({ tone: "error", text: b.error });
      else if (b.previewed) setMsg({ tone: "info", text: b.message });
      else {
        await loadRates();
        setPayType(name);
        setNewRate(null);
        setMsg({ tone: "success", text: `Added ${name} to ${entry.employee}. Save to charge this entry at it.` });
      }
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Failed to add the rate" });
    } finally {
      setAddingRate(false);
    }
  }

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
  /** The hours a re-rate would be charged on. JobTread multiplies by its OWN
   *  minute count unless the span is being rewritten in the same save. */
  const ratedHours = timeChanged ? (spanned ?? entry.hours) : entry.hours;
  const codeChanged = leafId !== (entry.costItemId ?? "");
  const dirty = timeChanged || codeChanged || movingJob || typeChanged;

  // An entry with no end time is still running — JobTread derives nothing to
  // rewrite, and clock-out belongs on the Employee Time page, not here.
  const openEntry = !entry.endedAt;

  const canSave =
    writes &&
    dirty &&
    !saving &&
    !approving &&
    !openEntry &&
    Boolean(date && start) &&
    (!movingJob || Boolean(leafId)) &&
    (!timeChanged || (spanned != null && spanned > 0));

  // An entry that is already approved has nothing to press, and a running one
  // has no hours to approve yet.
  const canApprove = writes && !entry.isApproved && !openEntry && !saving && !approving && !dirty;

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body: Record<string, string> = { id: entry.id };
      if (movingJob && job) body.jobId = job.id;
      if (codeChanged || movingJob) body.costItemId = leafId;
      if (typeChanged) body.type = payType;
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

  /* ---- approving the hours ----
     A separate press and a separate write, sending nothing but the flag. The
     office reads the entry, then says the hours are good for payroll; folding
     that into Save would let one press both approve the time and rewrite it.
     Disabled while the panel is dirty for the same reason — approving reloads
     the board, and an unsaved edit would go with it. */
  async function approve() {
    setApproving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/time-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, isApproved: true }),
      });
      const b = await r.json();
      if (b.error) {
        setMsg({ tone: "error", text: b.error });
      } else if (b.previewed) {
        setMsg({ tone: "info", text: b.message });
      } else {
        setMsg({ tone: "success", text: "Approved in JobTread." });
        onSaved();
      }
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Failed to approve" });
    } finally {
      setApproving(false);
    }
  }

  function revert() {
    setJob(null);
    setLeafId(entry.costItemId ?? "");
    setDate(started.date);
    setStart(started.time);
    setEnd(ended.time);
    setHoursText(entry.hours ? entry.hours.toFixed(2) : "");
    setPayType(entry.type);
    setNewRate(null);
    setMsg(null);
  }

  return (
    <Card className="max-h-[85dvh] overflow-y-auto">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold">{entry.employee}</p>
        <span className="flex shrink-0 items-baseline gap-3">
          {/* `timeEntryId` OPENS the entry on JobTread's time page, rather than
              filtering to its day — see lib/jtLinks. */}
          <JtLink
            href={jtTimeUrl({ jobId, userId: entry.userId, entryId: entry.id })}
            title="Open this entry on JobTread"
            className="text-xs font-semibold text-neutral-400 transition hover:text-accent"
          >
            JT ↗
          </JtLink>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-neutral-400 transition hover:text-accent"
          >
            Close
          </button>
        </span>
      </div>
      {/* The pay rate is cost ÷ hours, not a stored field — JobTread keeps the
          rate on the pay TYPE, and what this entry was actually charged at is
          the only rate that describes it. It is also what makes the re-time
          warning below concrete: change the hours and the cost moves by this. */}
      <p className="mb-2 min-w-0 truncate text-xs text-neutral-500">
        {money(entry.cost)} · {entry.hours.toFixed(2)}h
        {entry.hours > 0 ? ` · ${money(entry.cost / entry.hours)}/h` : ""}
        {entry.type ? ` · ${entry.type}` : ""}
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
          This entry has no clock-out yet. It gets its hours when it&apos;s closed out — edit it
          after that.
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
        {!openEntry &&
          Math.abs(entry.minutes - (spanHours(started.time, ended.time) ?? 0) * 60) > 1 && (
            <Banner tone="warning" className="!py-1.5 !text-[11px]">
              JobTread counts {(entry.minutes / 60).toFixed(2)}h on this entry, but its clock reads{" "}
              {(spanHours(started.time, ended.time) ?? 0).toFixed(2)}h — usually a deducted break.
              Saving new times replaces both figures with the span you set.
            </Banner>
          )}
        {timeChanged && (
          <Banner tone="info" className="!py-1.5 !text-[11px]">
            The cost follows the hours — JobTread recalculates it as the new hours × this
            entry&apos;s pay rate.
          </Banner>
        )}

        {/* ---- the labor rate ----
            Under the hours because it multiplies them: cost is minutes × this
            rate, so changing it changes the dollars exactly the way a re-time
            does. Only the person's own pay types are offered — JobTread rejects
            any other name outright — and the "+ New rate" row below adds one to
            their membership when the one you want isn't there yet. */}
        {rates !== null && (
          <div>
            <Label htmlFor="te-rate">Labor rate</Label>
            <Select
              id="te-rate"
              value={payType}
              disabled={!writes || openEntry}
              onChange={(e) => setPayType(e.target.value)}
            >
              {/* The entry's own type stays listed even when the membership has
                  dropped it, or the box would silently claim another rate. */}
              {!rates.some((t) => t.name === entry.type) && entry.type && (
                <option value={entry.type}>{entry.type} (not on this member)</option>
              )}
              {rates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} — {money(t.hourlyRate)}/h
                </option>
              ))}
            </Select>
            {typeChanged && rateOf(payType) != null && (
              <Banner tone="warning" className="mt-1 !py-1.5 !text-[11px]">
                {/* The hours JobTread will multiply are ITS OWN minute count,
                    not the clock span — a break deduction makes the two differ.
                    Only a re-time replaces that count with the span. */}
                Re-rates the entry: {ratedHours.toFixed(2)}h × {money(rateOf(payType) as number)} ={" "}
                {money(ratedHours * (rateOf(payType) as number))}, from {money(entry.cost)}.
              </Banner>
            )}

            {/* ADDING A RATE writes to the PERSON, not to this entry — it puts
                the pay type on their JobTread membership, the same write
                /labor-rates makes. The entry then has to be saved onto it. */}
            {writes && membershipId ? (
              newRate ? (
                <div className="mt-2 space-y-2 rounded-lg border border-line-soft p-2">
                  <Input
                    value={newRate.name}
                    placeholder="Rate name — e.g. Ruhmann-Warren - PM"
                    onChange={(e) => setNewRate({ ...newRate, name: e.target.value })}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      value={newRate.rate}
                      inputMode="decimal"
                      placeholder="$ per hour"
                      onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })}
                      className="tabular-nums"
                    />
                    <Button
                      size="sm"
                      onClick={addRate}
                      disabled={addingRate || !newRate.name.trim() || !newRate.rate.trim()}
                    >
                      {addingRate ? "Adding…" : "Add"}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setNewRate(null)}>
                      Cancel
                    </Button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                    Adds this rate to {entry.employee} in JobTread, alongside the ones they already
                    have. It changes no entry until you Save.
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setNewRate({ name: "", rate: "" })}
                  className="mt-1 text-[11px] font-semibold text-accent"
                >
                  + New rate for {entry.employee}
                </button>
              )
            ) : null}
          </div>
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

      {/* APPROVING is its own press, under the edit rather than beside it: the
          office reads the entry, fixes what's wrong, and only then says the
          hours are good for payroll. Gone once the entry is approved — JobTread
          keeps the mark, and un-approving is not this panel's job. */}
      {!entry.isApproved && (
        <div className="mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={approve}
            disabled={!canApprove}
            className="w-full"
          >
            {approving ? "Approving…" : "Approve time"}
          </Button>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {dirty
              ? "Save or revert your changes first — approving reloads the entry."
              : "Marks the hours approved in JobTread. It changes nothing else — not the coding, not the cost."}
          </p>
        </div>
      )}
    </Card>
  );
}
