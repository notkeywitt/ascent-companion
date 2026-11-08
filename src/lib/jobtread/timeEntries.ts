// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { pageAll, pageEach, pave, type PaveConfig } from "./core";
// ---------------------------------------------------------------------------
// TIME ENTRIES — createTimeEntry / updateTimeEntry / deleteTimeEntry / a
// per-user read, all confirmed LIVE 2026-07-23 via probeTimeEntryClockInOut()
// (ascent-appscript EmployeeTime.js): an OPEN entry (startedAt only, no
// endedAt), updateTimeEntry to set endedAt later (the clock-out),
// deleteTimeEntry (cancel/cleanup), and user.timeEntries for the "my time"
// list — each verified by actually creating, updating, and deleting a
// [PROBE]-tagged entry against live JobTread.
// ---------------------------------------------------------------------------

/**
 * TIMESTAMPS ARE TRUE UTC INSTANTS — confirmed live 2026-07-24 by creating,
 * reading back, and deleting three probe entries:
 *
 *   sent "2026-07-24T09:00:00"       → stored "2026-07-24T09:00:00.000Z"
 *   sent "2026-07-24T09:00:00-07:00" → stored "2026-07-24T16:00:00.000Z"
 *   sent "2026-07-24T16:00:00Z"      → stored "2026-07-24T16:00:00.000Z"
 *
 * A zoneless string is read as UTC, never as local time, and JobTread's UI then
 * renders the instant in the org's timezone. Handing it a bare wall clock made
 * every entry land 7 hours early (a 9:00 AM entry displayed as 2:00 AM PDT), so
 * ALWAYS convert local↔UTC at this boundary with the two helpers below.
 *
 * JobTread's CSV IMPORTER does the opposite — it reads a zoneless stamp as
 * ORG-local (an 08:00 import row is stored as 15:00Z). That's why /labor-import
 * deliberately emits offset-free stamps, and why it must stay that way: the
 * importer and this API disagree, so don't "unify" them.
 */
export const JT_ORG_TZ = "America/Los_Angeles";

/** How far ahead of UTC `tz` is at `instant` (negative west of UTC), in ms. */
export function tzOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  // That zone's wall clock read as-if-UTC, minus the real instant, IS the offset.
  return (
    Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - instant
  );
}

/**
 * A local wall clock ("YYYY-MM-DDTHH:MM[:SS]", no zone) → the UTC instant it
 * names in `tz`, as the ISO string JobTread should store. "" if unparseable.
 */
export function orgLocalToJtIso(local: string, tz: string = JT_ORG_TZ): string {
  // One-digit hours too: the Time Entries sheet reads "2026-09-23 7:00", and a
  // two-digit-only pattern turned every morning record into "no start time".
  const m = (local ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return "";
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // Two passes: the second resolves the offset against the real instant, so a
  // time on a DST-shift day isn't converted with the previous day's offset.
  const instant = naive - tzOffsetMs(naive - tzOffsetMs(naive, tz), tz);
  return new Date(instant).toISOString();
}

/**
 * The inverse — a JobTread timestamp → the "YYYY-MM-DDTHH:MM:SS" wall clock it
 * reads as in `tz`, i.e. exactly what JobTread's own UI shows. "" if unparseable.
 */
export function jtIsoToOrgLocal(iso: string, tz: string = JT_ORG_TZ): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  return new Date(t + tzOffsetMs(t, tz)).toISOString().slice(0, 19);
}

/** One time entry on a job, as AscentBot reads it: who, when, on what. Never pay or cost. */
export interface JobTimeLine {
  person: string;
  /** Org-local "YYYY-MM-DDTHH:MM:SS". */
  start: string;
  /** Org-local; "" while the person is still clocked in. */
  end: string;
  minutes: number;
  costCode: string;
  costItem: string;
  notes: string;
}

/** Pages read by `getJobTimeLines`. The totals stay exact past it; only the line list stops. */
export const JOB_TIME_PAGES = 10;

/**
 * A job's time entries, newest first, narrowed to an org-local date window
 * (`from`/`to` inclusive, "YYYY-MM-DD") and to entries mentioning EVERY one
 * of `words`, each in any of: the person's name, the cost code's number or
 * name, the cost item's name, the notes. Every word, so "exterior finish"
 * does not also count Exterior Painting into a total. The match runs in Pave (`like` is
 * case-insensitive). `count` and `minutes` come from Pave's own aggregate, so
 * they are exact even when the line list stops at JOB_TIME_PAGES pages (`more`).
 * Read-only. Fields and the `like` paths confirmed live 2026-10-28.
 */
export async function getJobTimeLines(
  cfg: PaveConfig,
  jobId: string,
  opts: { from?: string; to?: string; words?: string[] } = {},
): Promise<{ lines: JobTimeLine[]; count: number; minutes: number; more: boolean }> {
  const clauses: unknown[] = [];
  const from = opts.from ? orgLocalToJtIso(`${opts.from}T00:00`) : "";
  if (from) clauses.push(["startedAt", ">=", from]);
  if (opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to)) {
    const next = new Date(`${opts.to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    clauses.push(["startedAt", "<", orgLocalToJtIso(`${next.toISOString().slice(0, 10)}T00:00`)]);
  }
  const like = (path: string[], w: string) => [path, "like", `%${w}%`];
  for (const w of (opts.words ?? []).map((x) => x.replace(/[%_]/g, "")).filter(Boolean)) {
    clauses.push({
      or: [
        like(["user", "name"], w),
        like(["costItem", "costCode", "number"], w),
        like(["costItem", "costCode", "name"], w),
        like(["costItem", "name"], w),
        like(["notes"], w),
      ],
    });
  }
  const where = clauses.length ? { where: clauses.length === 1 ? clauses[0] : { and: clauses } } : {};

  const [totals, rows] = await Promise.all([
    pave<any>(cfg, {
      job: { $: { id: jobId }, id: {}, timeEntries: { $: { ...where }, count: {}, sum: { $: "minutes" } } },
    }),
    pageAll<any>(cfg, {
      label: "job.timeEntries (AscentBot)",
      stopAfterPages: JOB_TIME_PAGES,
      query: (args) => ({
        job: {
          $: { id: jobId },
          id: {},
          timeEntries: {
            $: { ...args, ...where, sortBy: [{ field: "startedAt", order: "desc" }] },
            nextPage: {},
            nodes: {
              id: {},
              startedAt: {},
              endedAt: {},
              minutes: {},
              notes: {},
              user: { name: {} },
              costItem: { name: {}, costCode: { number: {}, name: {} } },
            },
          },
        },
      }),
      pick: (r) => r?.job?.timeEntries,
    }),
  ]);
  const count = Number(totals?.job?.timeEntries?.count) || 0;
  return {
    lines: rows.map((n) => ({
      person: String(n.user?.name ?? ""),
      start: jtIsoToOrgLocal(n.startedAt),
      end: n.endedAt ? jtIsoToOrgLocal(n.endedAt) : "",
      minutes: Number(n.minutes) || 0,
      costCode: [n.costItem?.costCode?.number, n.costItem?.costCode?.name].filter(Boolean).join(" "),
      costItem: String(n.costItem?.name ?? ""),
      notes: String(n.notes ?? ""),
    })),
    count,
    minutes: Number(totals?.job?.timeEntries?.sum) || 0,
    more: count > rows.length,
  };
}

export interface CreateTimeEntryArgs {
  userId: string; // JobTread user id (the member's `user.id`)
  jobId: string;
  costItemId: string; // the job's budget-leaf jobCostItemId (JT requires a cost item)
  startedAt: string; // UTC instant ISO, e.g. "2026-07-22T21:30:00.000Z" — build it with orgLocalToJtIso()
  endedAt?: string; // same shape; OMIT for an OPEN/running entry (clock-in). JT derives minutes.
  type: string; // pay-type NAME (a rate; per worker × job) — REQUIRED (JT 400s without it).
  notes: string;
  isApproved?: boolean; // default false → office reviews before it counts
}

// JobTread gates time tracking on the cost ITEM's cost TYPE, not on the cost
// code: `costType.isTimeTrackable`, which IS queryable and is read into
// `BudgetItem.timeTrackable` above. (An older note here said no such field
// existed — that probe tried `costCode`, which indeed carries none.)
//
// So the message must not send anyone looking for a different CODE. One code
// routinely carries a Materials leaf and a Labor leaf, and the code they picked
// is usually right — it is the row under it that will not take an hour.
export function rewriteTimeEntryError(message: string): string {
  if (/cost type that is not able to be time tracked/i.test(message)) {
    return (
      "JobTread won't take time on this budget line — its cost type isn't Labor. " +
      "The cost code may still be right: pick the code's Labor line, or add one to the job's budget."
    );
  }
  return message;
}

/**
 * WRITE — create a JobTread time entry. Omit `endedAt` for an OPEN/running
 * entry (clock-in); JobTread leaves it null until a later updateTimeEntry
 * (clock-out) sets it. Coordinates are deliberately NOT sent — that optional
 * field's shape is unverified, and the GPS is recorded in our own Time
 * Entries log instead.
 */
export async function createTimeEntry(
  cfg: PaveConfig,
  args: CreateTimeEntryArgs,
): Promise<{ id: string }> {
  const $: Record<string, unknown> = {
    organizationId: cfg.orgId,
    userId: args.userId,
    jobId: args.jobId,
    costItemId: args.costItemId,
    type: args.type,
    startedAt: args.startedAt,
    notes: args.notes ?? "",
    isApproved: args.isApproved ?? false,
  };
  if (args.endedAt) $.endedAt = args.endedAt;

  try {
    const r = await pave(cfg, {
      createTimeEntry: { $, createdTimeEntry: { id: {} } },
    });
    const id = r?.createTimeEntry?.createdTimeEntry?.id;
    if (!id) throw new Error("createTimeEntry returned no time entry id.");
    return { id };
  } catch (e) {
    throw new Error(rewriteTimeEntryError(e instanceof Error ? e.message : "Unknown error"));
  }
}

/**
 * One TIME ENTRY, as the financial journal records it before an edit.
 *
 * Time is labor cost, so a recode moves real money between cost codes and
 * sometimes between jobs. JobTread keeps no history of that move, and the entry
 * itself is rewritten in place — which is why the prior job, code, hours and
 * rate are read here first.
 *
 * Returns `null` on ANY failure. Same rule as the bill and line snapshots: a
 * missing before-value is recorded honestly, never allowed to block the write.
 */
export async function getTimeEntryJournalSnapshot(
  cfg: PaveConfig,
  id: string,
): Promise<{
  jobId: string;
  jobName: string;
  costItemId: string;
  code: string;
  minutes: number | null;
  hourlyRate: number | null;
  cost: number | null;
  startedAt: string;
  endedAt: string;
  isApproved: boolean | null;
  notes: string;
  userName: string;
  /** The pay type (labor rate) name — a writable field, so a before-value. */
  type: string;
} | null> {
  try {
    const r: any = await pave(cfg, {
      timeEntry: {
        $: { id },
        id: {},
        startedAt: {},
        endedAt: {},
        minutes: {},
        hourlyRate: {},
        cost: {},
        isApproved: {},
        notes: {},
        type: {},
        user: { name: {} },
        job: { id: {}, name: {} },
        costItem: { id: {}, costCode: { number: {} } },
      },
    });
    const t = r?.timeEntry;
    if (!t) return null;
    return {
      jobId: t.job?.id ?? "",
      jobName: t.job?.name ?? "",
      costItemId: t.costItem?.id ?? "",
      code: t.costItem?.costCode?.number ?? "",
      minutes: typeof t.minutes === "number" ? t.minutes : null,
      hourlyRate: typeof t.hourlyRate === "number" ? t.hourlyRate : null,
      cost: typeof t.cost === "number" ? t.cost : null,
      startedAt: t.startedAt ?? "",
      endedAt: t.endedAt ?? "",
      isApproved: typeof t.isApproved === "boolean" ? t.isApproved : null,
      notes: t.notes ?? "",
      userName: t.user?.name ?? "",
      type: t.type ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * WRITE — the clock-out half: set `endedAt` (and/or revise notes) on an open
 * entry. The return selection needs its OWN `$: {id}` (confirmed — matches
 * updateDocument/updateCostItem's shape), not just the mutation's top-level $.
 *
 * `costItemId` RE-CODES the entry — this is Labor Review's whole write, and the
 * exact analogue of updateLine()'s `jobCostItemId` for a bill line. Confirmed
 * live 2026-08-10 (read → recode → read back → restore, on a real entry):
 * re-pointing costItemId moves the entry to the new budget leaf's cost code and
 * leaves `cost`, `minutes`, `type` and `isApproved` UNTOUCHED. That's the
 * important half — a time entry's cost is hours × the PAY TYPE's rate, so it
 * does NOT get recomputed from the cost item, and unlike createCostItem there is
 * no tax carve to lose money to. Recoding therefore moves labor between codes at
 * exactly the amount already on the entry.
 *
 * A cost code JobTread doesn't allow time against is rejected at write time (no
 * queryable "time-trackable" flag exists) — rewriteTimeEntryError turns that
 * into something the office can act on.
 *
 * `startedAt`/`endedAt` RE-TIME the entry and `jobId` MOVES it. Both confirmed
 * live 2026-08-25 (probeTimeEntryRetimeAndRejob — a [PROBE] entry cloned off a
 * real one, mutated, read back, deleted):
 *
 *   - RE-TIMING RECOMPUTES THE MONEY. A 2h window rewritten to 3h came back
 *     minutes 120 → 180 and cost 150 → 225, i.e. JobTread derives minutes from
 *     the new span and cost is minutes × the pay type's rate ($75/h here).
 *     Unlike a recode, this DOES change the dollars — say so on screen.
 *   - A JOB MOVE NEEDS ITS COST ITEM. `jobId` alone is rejected outright:
 *     HTTP 400 "A job & cost item are required for this time entry" — JobTread
 *     will not let an entry strand on another job's cost item. Sent together,
 *     `{ jobId, costItemId }` moves the entry and leaves cost and minutes
 *     untouched. Cost items are per-job, so the pair is the only legal form.
 *
 * `type` RE-RATES the entry — the pay type IS the labor rate. Confirmed live
 * 2026-09-08 (scripts/probe-time-entry-type.mjs: a [PROBE] 2h entry created at
 * "Regular Pay" $85, switched to "Ruhmann-Warren - PM" $95, read back, deleted):
 * minutes stayed 120, hourlyRate went 85 → 95 and cost 170 → 190. So this
 * changes the dollars, exactly like a re-time. Only a pay type the MEMBER
 * already carries is accepted — anything else is HTTP 400 "Unknown time entry
 * type '<name>' for user <who>" — so add the rate to their membership
 * (updateMembershipRates) before writing it onto an entry.
 *
 * Timestamps here are UTC INSTANTS — build them with orgLocalToJtIso(), never
 * from a bare wall clock (see the note at the top of this section).
 */
export async function updateTimeEntry(
  cfg: PaveConfig,
  id: string,
  fields: {
    startedAt?: string;
    endedAt?: string;
    notes?: string;
    costItemId?: string;
    jobId?: string;
    isApproved?: boolean;
    type?: string;
  },
): Promise<{
  id: string;
  startedAt?: string;
  endedAt?: string;
  minutes?: number;
  type?: string;
  hourlyRate?: number;
  cost?: number;
}> {
  const $: Record<string, unknown> = { id };
  if (fields.startedAt !== undefined) $.startedAt = fields.startedAt;
  if (fields.endedAt !== undefined) $.endedAt = fields.endedAt;
  if (fields.notes !== undefined) $.notes = fields.notes;
  if (fields.costItemId !== undefined) $.costItemId = fields.costItemId;
  if (fields.jobId !== undefined) $.jobId = fields.jobId;
  if (fields.isApproved !== undefined) $.isApproved = fields.isApproved;
  if (fields.type !== undefined) $.type = fields.type;
  try {
    const r = await pave(cfg, {
      updateTimeEntry: {
        $,
        timeEntry: {
          $: { id },
          id: {},
          startedAt: {},
          endedAt: {},
          minutes: {},
          type: {},
          hourlyRate: {},
          cost: {},
        },
      },
    });
    const t = r?.updateTimeEntry?.timeEntry;
    return {
      id: t?.id ?? id,
      startedAt: t?.startedAt,
      endedAt: t?.endedAt,
      minutes: t?.minutes,
      type: t?.type,
      hourlyRate: t?.hourlyRate,
      cost: t?.cost,
    };
  } catch (e) {
    throw new Error(rewriteTimeEntryError(e instanceof Error ? e.message : "Unknown error"));
  }
}

/**
 * WRITE — delete a time entry (cancel a mistaken clock-in). Confirmed live:
 * no return-selection object is needed, just the id argument.
 */
export async function deleteTimeEntry(cfg: PaveConfig, id: string): Promise<void> {
  await pave(cfg, { deleteTimeEntry: { $: { id } } });
}

/**
 * READ — the owning user's id for one time entry, via the root `timeEntry(id)`
 * accessor. Used to gate an edit: a signed-in employee may only change their
 * OWN time, and the entry id comes from the client, so the write path re-reads
 * the owner here and compares it to the session's resolved JobTread user id
 * rather than trusting the request. Returns null when the entry doesn't exist
 * (e.g. deleted since the timesheet was loaded).
 */
export async function getTimeEntryOwner(cfg: PaveConfig, id: string): Promise<string | null> {
  const r = await pave(cfg, { timeEntry: { $: { id }, id: {}, user: { id: {} } } });
  return r?.timeEntry?.user?.id ?? null;
}

/** What one time entry actually holds, for comparing against a record of intent. */
export interface TimeEntrySpan {
  id: string;
  startedAt: string;
  /** null while the entry is still OPEN (clocked in, never clocked out). */
  endedAt: string | null;
  /** JobTread's own duration, break-deducted. 0 while running. */
  minutes: number;
}

/**
 * READ — one time entry's span, via the root `timeEntry(id)` accessor. Returns
 * null when JobTread has no such entry, which is the answer that matters: a
 * Time Entries row naming an id JobTread does not have is a record that reached
 * JobTread and then left it (deleted there, or never really created).
 *
 * The audit in src/lib/timeSync.ts reads its window with `getOrgTimeEntries` and
 * only falls back to this for an id that pull didn't cover — an entry re-timed
 * out of the window, or genuinely gone. So this is the exception path, not the
 * bulk one; don't loop it over a whole sheet.
 */
export async function getTimeEntrySpan(cfg: PaveConfig, id: string): Promise<TimeEntrySpan | null> {
  const r = await pave(cfg, {
    timeEntry: { $: { id }, id: {}, startedAt: {}, endedAt: {}, minutes: {} },
  });
  const te = r?.timeEntry;
  if (!te?.id) return null;
  return {
    id: String(te.id),
    startedAt: String(te.startedAt ?? ""),
    endedAt: te.endedAt ? String(te.endedAt) : null,
    minutes: Number(te.minutes ?? 0),
  };
}

export interface UserTimeEntry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  /** JobTread's OWN duration for the entry (break-deducted), 0 while running. */
  minutes: number;
  /** timeEntry.isApproved — the payroll approval mark shown on the timesheet. */
  approved: boolean;
  notes: string;
  jobId: string;
  jobName: string;
  /** The job's customer account name, for the "job / customer" timesheet row. */
  customer: string;
  costItemId: string;
  costCode: string;
  costItemName: string;
  /** timeEntry.type — the pay-type NAME. */
  payType: string;
}

/**
 * READ — one user's time entries, every job. Confirmed live: `user.timeEntries`
 * returns the full field set (job, costItem/costCode, notes) and paginates via
 * `nextPage` like every other connection in this API.
 *
 * `user.timeEntries` DOES support a server-side `where` on `startedAt` and a
 * `sortBy` (confirmed live 2026-07-28 via probeTimeEntryWhereFilter in
 * ascent-appscript Diagnostics.js: `where {and:[["startedAt",">=",…],
 * ["startedAt","<",…]]}` and `sortBy:[{field:"startedAt",order:"desc"}]` both
 * apply correctly, and the filtered set matches a client-side filter of the
 * full pull — an earlier note here that no date filter existed was wrong).
 * Pass `opts.sinceIso`/`opts.untilIso` to bound the fetch (huge win for the
 * bi-monthly "My Time" view, which otherwise pages a worker's whole history to
 * keep ~15 days) and `opts.sortDesc` for newest-first. With no opts it fetches
 * every entry as before — the leave-accrual path relies on that. JobTread's own
 * ordering isn't guaranteed, so callers should still sort by startedAt.
 */
export async function getUserTimeEntries(
  cfg: PaveConfig,
  userId: string,
  opts: { sinceIso?: string; untilIso?: string; sortDesc?: boolean; maxPages?: number } = {},
): Promise<UserTimeEntry[]> {
  const out: UserTimeEntry[] = [];
  // `opts.maxPages` is a DELIBERATE bound — readLastUsed asks for one page of
  // newest-first entries and wants what that page held. Without it the walk is
  // complete or it throws; it never quietly returns part of a history.
  const pageLimit = opts.maxPages == null ? {} : { stopAfterPages: opts.maxPages };
  const range: unknown[] = [];
  if (opts.sinceIso) range.push(["startedAt", ">=", opts.sinceIso]);
  if (opts.untilIso) range.push(["startedAt", "<", opts.untilIso]);
  await pageEach<any>(
    cfg,
    {
      label: "user.timeEntries",
      ...pageLimit,
      query: (args) => ({
        user: {
          $: { id: userId },
          id: {},
          timeEntries: {
            $: {
              ...(range.length ? { where: range.length === 1 ? range[0] : { and: range } } : {}),
              ...(opts.sortDesc ? { sortBy: [{ field: "startedAt", order: "desc" }] } : {}),
              ...args,
            },
            nextPage: {},
            nodes: {
              id: {},
              type: {},
              startedAt: {},
              endedAt: {},
              minutes: {},
              isApproved: {},
              notes: {},
              job: { id: {}, name: {}, location: { account: { name: {} } } },
              costItem: { id: {}, name: {}, costCode: { number: {}, name: {} } },
            },
          },
        },
      }),
      pick: (r) => r?.user?.timeEntries,
    },
    (rows) => {
      for (const n of rows) {
        out.push({
          id: n.id,
          startedAt: n.startedAt,
          endedAt: n.endedAt ?? null,
          minutes: Number(n.minutes) || 0,
          approved: !!n.isApproved,
          notes: n.notes ?? "",
          jobId: n.job?.id ?? "",
          jobName: n.job?.name ?? "",
          customer: n.job?.location?.account?.name ?? "",
          costItemId: n.costItem?.id ?? "",
          costCode: n.costItem?.costCode?.number ?? "",
          costItemName: n.costItem?.costCode?.name || n.costItem?.name || "",
          payType: n.type ?? "",
        });
      }
    },
  );
  return out;
}

export interface OpenTimeEntry {
  id: string;
  startedAt: string; // UTC instant ISO, as JobTread stores it
  payType: string; // timeEntry.type — the pay-type NAME
  notes: string;
  jobId: string;
  jobName: string;
  customer: string;
  jobLabel: string; // "Customer - Job" when the customer is known, else the job name
  costItemId: string;
  costCode: string;
  costItemName: string;
}

/**
 * READ — a user's still-RUNNING time entries (clocked in, never clocked out):
 * `endedAt` is null. This is what makes a clock-in resumable from any device —
 * JobTread, not one phone's localStorage, is the source of truth for "am I on
 * the clock right now".
 *
 * Deliberately a separate function from getUserTimeEntries rather than a flag on
 * it: this one pulls a RICHER field set (`type` for the pay type, the job's
 * customer for the "Customer - Job" label, `costItem.id` so the clock-out can
 * log the same cost item) that the bi-monthly "My Time" list doesn't need, and
 * keeping them apart means a change here can't break that view.
 *
 * `endedAt` is filtered SERVER-side, so the answer is only the running entries
 * — normally none or one — at any age. The `{"=":[endedAt, null]}` form is the
 * one getOrgTimeEntries probe-confirmed; it was re-confirmed on a user's own
 * connection 2026-10-06, alone and combined with `startedAt`. The loop below
 * still skips a closed row, as a guard.
 *
 * `opts.sinceIso` is now a choice, not a cost. The page's resume passes a few
 * days back, so a long-forgotten clock-in does not resurface weeks later as if
 * it were live. The clock-in guard passes none: JobTread closes ANY running
 * entry when a new one opens, however old (see employeeClock.ts).
 */
export async function getOpenTimeEntries(
  cfg: PaveConfig,
  userId: string,
  opts: { sinceIso?: string; maxPages?: number } = {},
): Promise<OpenTimeEntry[]> {
  const out: OpenTimeEntry[] = [];
  // `opts.maxPages` is a DELIBERATE bound, not a guard — see getUserTimeEntries.
  const pageLimit = opts.maxPages == null ? {} : { stopAfterPages: opts.maxPages };
  const running = { "=": [{ field: "endedAt" }, { value: null }] };
  const where = opts.sinceIso ? { and: [running, ["startedAt", ">=", opts.sinceIso]] } : running;
  await pageEach<any>(
    cfg,
    {
      label: "user.timeEntries (still clocked in)",
      ...pageLimit,
      query: (args) => ({
        user: {
          $: { id: userId },
          id: {},
          timeEntries: {
            $: {
              sortBy: [{ field: "startedAt", order: "desc" }],
              where,
              ...args,
            },
            nextPage: {},
            nodes: {
              id: {},
              type: {},
              startedAt: {},
              endedAt: {},
              notes: {},
              job: { id: {}, name: {}, location: { account: { name: {} } } },
              costItem: { id: {}, name: {}, costCode: { number: {}, name: {} } },
            },
          },
        },
      }),
      pick: (r) => r?.user?.timeEntries,
    },
    (rows) => {
      for (const n of rows) {
        if (n.endedAt) continue; // closed — not a running clock
        const jobName = n.job?.name ?? "";
        const customer = n.job?.location?.account?.name ?? "";
        out.push({
          id: n.id,
          startedAt: n.startedAt,
          payType: n.type ?? "",
          notes: n.notes ?? "",
          jobId: n.job?.id ?? "",
          jobName,
          customer,
          jobLabel: customer && jobName ? `${customer} - ${jobName}` : jobName,
          costItemId: n.costItem?.id ?? "",
          costCode: n.costItem?.costCode?.number ?? "",
          costItemName: n.costItem?.costCode?.name || n.costItem?.name || "",
        });
      }
    },
  );
  // Newest first, so the caller can take [0] as "the" running clock.
  return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

export interface OrgTimeEntry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  notes: string;
  userName: string;
  jobId: string;
  jobName: string;
  customer: string;
  costItemId: string;
  costCode: string;
  costItemName: string;
  payType: string;
}

/**
 * READ — every user's time entries org-wide, for the Daily Digest's crew-activity
 * check: "who worked where yesterday" and "who's clocked in right now" both need
 * every employee at once, which `getUserTimeEntries`/`getOpenTimeEntries` can't
 * give (both are scoped to one user). Queries `organization.timeEntries` — the
 * root connection — rather than paging every user's own connection.
 *
 * Confirmed live via schema introspection (2026-08-31): `organization.timeEntries`
 * exists and returns `user.name` directly on each entry (no need to resolve a
 * JobTread user id back to a display name), the same `where`/`sortBy` grammar as
 * `getUserTimeEntries` applies (`{and:[["startedAt",">=",…],["startedAt","<",…]]}`),
 * and — unlike the caution on `getOpenTimeEntries` above — a server-side
 * `{"=":[{"field":"endedAt"},{"value":null}]}` filter for "still clocked in" was
 * probe-confirmed to work and to match a client-side filter of the full pull.
 * Filtering `endedAt` server-side here (rather than client-side like
 * `getOpenTimeEntries`) matters more at this scope: an org-wide pull without it
 * would page through every closed entry from every employee just to find the
 * handful still open.
 *
 * `opts.openOnly` and `opts.sinceIso`/`untilIso` are mutually exclusive uses (the
 * "who's clocked in now" question has no date bound; the "yesterday" question
 * does) but nothing stops combining them if a future caller needs to.
 */
export async function getOrgTimeEntries(
  cfg: PaveConfig,
  opts: { sinceIso?: string; untilIso?: string; openOnly?: boolean; maxPages?: number } = {},
): Promise<OrgTimeEntry[]> {
  const out: OrgTimeEntry[] = [];
  // `opts.maxPages` is a DELIBERATE bound, not a guard — see getUserTimeEntries.
  const pageLimit = opts.maxPages == null ? {} : { stopAfterPages: opts.maxPages };
  const clauses: unknown[] = [];
  if (opts.sinceIso) clauses.push(["startedAt", ">=", opts.sinceIso]);
  if (opts.untilIso) clauses.push(["startedAt", "<", opts.untilIso]);
  if (opts.openOnly) clauses.push({ "=": [{ field: "endedAt" }, { value: null }] });
  await pageEach<any>(
    cfg,
    {
      label: "organization.timeEntries",
      ...pageLimit,
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          timeEntries: {
            $: {
              sortBy: [{ field: "startedAt", order: "desc" }],
              ...(clauses.length
                ? { where: clauses.length === 1 ? clauses[0] : { and: clauses } }
                : {}),
              ...args,
            },
            nextPage: {},
            nodes: {
              id: {},
              type: {},
              startedAt: {},
              endedAt: {},
              minutes: {},
              notes: {},
              user: { name: {} },
              job: { id: {}, name: {}, location: { account: { name: {} } } },
              costItem: { id: {}, name: {}, costCode: { number: {}, name: {} } },
            },
          },
        },
      }),
      pick: (r) => r?.organization?.timeEntries,
    },
    (rows) => {
      for (const n of rows) {
        out.push({
          id: n.id,
          startedAt: n.startedAt,
          endedAt: n.endedAt ?? null,
          minutes: Number(n.minutes) || 0,
          notes: n.notes ?? "",
          userName: n.user?.name ?? "",
          jobId: n.job?.id ?? "",
          jobName: n.job?.name ?? "",
          customer: n.job?.location?.account?.name ?? "",
          costItemId: n.costItem?.id ?? "",
          costCode: n.costItem?.costCode?.number ?? "",
          costItemName: n.costItem?.costCode?.name || n.costItem?.name || "",
          payType: n.type ?? "",
        });
      }
    },
  );
  return out;
}

/** One time entry with every field JobTread's own time-entries CSV export carries. */
export interface ExportTimeEntry {
  id: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  isApproved: boolean;
  type: string;
  notes: string;
  userName: string;
  userEmail: string;
  customer: string;
  location: string;
  locationCountry: string;
  locationState: string;
  jobName: string;
  itemName: string;
  itemGroup: string;
  codeNumber: string;
  codeName: string;
  /** The entry's comment messages, oldest first. Almost always empty. */
  comments: string[];
}

/**
 * EVERY employee's time entries that START in [sinceIso, untilIso) — the
 * pay-period CSV the office emails to the bookkeeper (lib/timeEntriesEmail).
 * No filters: approved and unapproved, every job, every person.
 *
 * TWO PHASES. A nested `comments { nodes }` inside this paged connection is
 * the 413 rule (probed 2026-10-16: "Request Entity Too Large"), but
 * `comments { count }` is not. So the walk reads the count, and only an entry
 * that has comments is read again on its own. Most periods have none.
 *
 * Throws rather than returning a short period (pageAll), because the CSV is
 * what payroll reads.
 */
export async function getTimeEntriesForExport(
  cfg: PaveConfig,
  sinceIso: string,
  untilIso: string,
): Promise<ExportTimeEntry[]> {
  const nodes = await pageAll<any>(cfg, {
    label: `organization.timeEntries from ${sinceIso.slice(0, 10)}`,
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        id: {},
        timeEntries: {
          $: {
            sortBy: [{ field: "startedAt", order: "desc" }],
            where: {
              and: [
                ["startedAt", ">=", sinceIso],
                ["startedAt", "<", untilIso],
              ],
            },
            ...args,
          },
          nextPage: {},
          nodes: {
            id: {},
            type: {},
            startedAt: {},
            endedAt: {},
            minutes: {},
            isApproved: {},
            notes: {},
            comments: { count: {} },
            user: { name: {}, emailAddress: {} },
            job: { name: {}, location: { name: {}, country: {}, state: {}, account: { name: {} } } },
            costItem: { name: {}, costGroup: { name: {} }, costCode: { number: {}, name: {} } },
          },
        },
      },
    }),
    pick: (r) => r?.organization?.timeEntries,
  });

  const commentsById = new Map<string, string[]>();
  for (const n of nodes) {
    if (!(Number(n?.comments?.count) > 0)) continue;
    const r = await pave<any>(cfg, {
      timeEntry: {
        $: { id: n.id },
        comments: {
          $: { size: 100, sortBy: [{ field: "createdAt" }] },
          nodes: { message: {} },
        },
      },
    });
    commentsById.set(
      n.id,
      (r?.timeEntry?.comments?.nodes ?? [])
        .map((c: any) => String(c?.message ?? "").trim())
        .filter(Boolean),
    );
  }

  return nodes.map((n) => ({
    id: n.id,
    startedAt: n.startedAt,
    endedAt: n.endedAt ?? null,
    minutes: Number(n.minutes) || 0,
    isApproved: Boolean(n.isApproved),
    type: String(n.type ?? ""),
    notes: String(n.notes ?? ""),
    userName: n.user?.name ?? "",
    userEmail: n.user?.emailAddress ?? "",
    customer: n.job?.location?.account?.name ?? "",
    location: n.job?.location?.name ?? "",
    locationCountry: n.job?.location?.country ?? "",
    locationState: n.job?.location?.state ?? "",
    jobName: n.job?.name ?? "",
    itemName: n.costItem?.name ?? "",
    itemGroup: n.costItem?.costGroup?.name ?? "",
    codeNumber: String(n.costItem?.costCode?.number ?? ""),
    codeName: n.costItem?.costCode?.name ?? "",
    comments: commentsById.get(n.id) ?? [],
  }));
}
