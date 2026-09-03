/**
 * THE FINANCIAL JOURNAL — one append-only record of every write this app makes
 * to a money record.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * Every JobTread write from this app carries ONE grant key, so JobTread's own
 * history attributes all of it to the API rather than to a person. Twenty-six
 * routes here change bill amounts, sales tax, issue dates, vendor invoice
 * numbers, bill status, QuickBooks push flags, cost codes and time entries.
 * Before this module, one of them recorded anything, and a deleted bill line
 * left no trace whatsoever.
 *
 * ── HOW A ROUTE USES IT (two lines) ─────────────────────────────────────────
 *   const j = await openJournal("/api/bill-tax");     // once, before the write
 *   …
 *   await j.record([{ action: "bill.tax.set", entity: "bill", entityId: docId,
 *                     docId, field: "nonRecoverableTax",
 *                     before: prior, after: saved, beforeSource: "read",
 *                     amount: saved }]);
 *
 * `openJournal` resolves the actor from the SESSION — never from the request
 * body, which a browser controls — and mints one `requestId` so every row from
 * a single user action can be read back as that action.
 *
 * ── THE FOUR RULES ──────────────────────────────────────────────────────────
 * 1. APPEND ONLY. There is no update and no delete in this file, and no sweep
 *    trims the table. The Apps Script side's `writeAuditLog` drops its oldest
 *    500 rows past 2,000; an audit trail that expires first is the failure this
 *    must not repeat.
 * 2. NEVER BREAK A WRITE. Every function here swallows its own errors. A
 *    journal that can fail a bill save would be worse than no journal, because
 *    the office would learn to route around it.
 * 3. RECORD FAILURES TOO. An attempted change that JobTread rejected is part of
 *    the record — `outcome: "error"` with the message.
 * 4. BE HONEST ABOUT `before`. `beforeSource` says whether the prior value was
 *    read live ("read"), reported by the browser ("client"), or not captured
 *    ("none"). A journal that hides which of the three it holds is worse than
 *    one that admits it.
 *
 * The pure half (`valueToText`, `diffFields`, `redactMeta`, `describeEvent`) is
 * unit-tested in `financialJournal.test.ts`; the DB half is best-effort by
 * design and has nothing to assert.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { financialEvents } from "@/db/schema";

/** Where a `before` value came from. Stored next to it, never inferred later. */
export type BeforeSource = "read" | "client" | "none";

/** How the attempt ended. A rejected write is still a journal row. */
export type JournalOutcome = "ok" | "error" | "preview";

/** Who did it. Both fields come from the server session. */
export interface JournalActor {
  email: string;
  role: string;
}

/** One field-level change, or one whole-record create/delete. */
export interface JournalEventInput {
  /** Dotted verb — "bill.tax.set", "line.delete", "time-entry.update". */
  action: string;
  /** "bill" | "line" | "time-entry" | "invoice" | "document" | … */
  entity: string;
  entityId?: string;
  /** The parent document, when the entity is a line on one. */
  docId?: string;
  jobId?: string;
  /** "" for a whole-record create or delete. */
  field?: string;
  before?: unknown;
  after?: unknown;
  beforeSource?: BeforeSource;
  /** Dollars this event moved. Omit when the change has no figure. */
  amount?: number | null;
  outcome?: JournalOutcome;
  error?: string;
  meta?: Record<string, unknown>;
}

/**
 * A value longer than this is truncated with a marker.
 *
 * The cap exists so one pathological payload can't make the journal the biggest
 * table in the database. It is generous enough that no real bill field, cost
 * code or note reaches it.
 */
export const MAX_VALUE_CHARS = 2000;

/** Keys never worth keeping, whatever a caller passes in `meta`. */
const SECRET_KEY = /(grant|secret|token|password|authorization|cookie|apikey|api_key)/i;

/**
 * A value as journal text.
 *
 * Scalars stay readable ("142.75", "approved", "true") because most of the
 * journal is scalars and JSON-quoting them would make it unreadable. Anything
 * else becomes JSON. `null`/`undefined` become "" rather than "null", so an
 * absent value and an empty one read the same in the column — the distinction
 * lives in `beforeSource`, which is the one that matters.
 */
export function valueToText(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") s = String(v);
  else {
    try {
      s = JSON.stringify(v) ?? "";
    } catch {
      s = "[unserializable]";
    }
  }
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}…[truncated]` : s;
}

/** `meta` as storable JSON, with anything secret-looking dropped by key name. */
export function redactMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta) return "{}";
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = v;
  }
  try {
    const s = JSON.stringify(out);
    return s.length > MAX_VALUE_CHARS ? JSON.stringify({ truncated: true }) : s;
  } catch {
    return "{}";
  }
}

/**
 * Turn a before-map and an after-map into one event per field that actually
 * changed.
 *
 * Only CHANGED fields produce a row. A route that sends the whole header on
 * every save (the bill page does) would otherwise write "issueDate: same →
 * same" rows forever, and a journal full of non-changes is a journal nobody
 * reads. A field present in `after` but missing from `before` is a change with
 * `beforeSource` left to the caller — absence is not evidence of emptiness.
 */
export function diffFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  base: Omit<JournalEventInput, "field" | "before" | "after">,
): JournalEventInput[] {
  const out: JournalEventInput[] = [];
  for (const [field, next] of Object.entries(after)) {
    if (next === undefined) continue;
    const prior = before ? before[field] : undefined;
    if (before && valueToText(prior) === valueToText(next)) continue;
    out.push({ ...base, field, before: prior, after: next });
  }
  return out;
}

/** One human line for a journal row — what the viewer and any export render. */
export function describeEvent(e: {
  action: string;
  field: string;
  before: string;
  after: string;
  beforeSource: string;
}): string {
  const what = e.field ? `${e.action} · ${e.field}` : e.action;
  if (!e.field) return what;
  const from = e.beforeSource === "none" ? "?" : e.before === "" ? "(empty)" : e.before;
  const to = e.after === "" ? "(empty)" : e.after;
  return `${what}: ${from} → ${to}`;
}

/**
 * A fresh id grouping every row one user action writes.
 *
 * `crypto.randomUUID` is available in both Node and edge runtimes here; the
 * fallback keeps this importable anywhere without a feature check at each call.
 */
export function newRequestId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? "";
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The actor for this request, from the session.
 *
 * Imported lazily so this module stays usable from a context that has no
 * NextAuth request (a cron, a detached task) — those pass their own actor.
 */
export async function resolveActor(): Promise<JournalActor> {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    const user = session?.user as { email?: string | null; role?: string | null } | undefined;
    return {
      email: (user?.email ?? "").trim().toLowerCase(),
      role: (user?.role ?? "").trim(),
    };
  } catch {
    return { email: "", role: "" };
  }
}

/** A journal bound to one route and one user action. */
export interface Journal {
  actor: JournalActor;
  requestId: string;
  route: string;
  /** Append rows. Best-effort: never throws, never blocks on failure. */
  record(events: JournalEventInput[]): Promise<void>;
}

/**
 * Open the journal for one request. Call it once, before the write, so the
 * actor is resolved even if the write throws.
 *
 * Pass `actor` explicitly for a caller with no session (a cron, a detached
 * task) — leaving it out reads the signed-in user, which is what a route wants.
 */
export async function openJournal(route: string, actor?: JournalActor): Promise<Journal> {
  const who = actor ?? (await resolveActor());
  const requestId = newRequestId();
  return {
    actor: who,
    requestId,
    route,
    record: (events) => writeEvents(events, { actor: who, route, requestId }),
  };
}

/**
 * Append rows. The only writer in this module, and it has no counterpart.
 *
 * Every failure is swallowed: a journal that can fail a bill save would teach
 * the office to route around it, which costs more than the missing row.
 */
async function writeEvents(
  events: JournalEventInput[],
  ctx: { actor: JournalActor; route: string; requestId: string },
): Promise<void> {
  if (!Array.isArray(events) || events.length === 0) return;
  const at = new Date().toISOString();
  try {
    await ensureDb();
    await db.insert(financialEvents).values(
      events.map((e) => ({
        at,
        actor: ctx.actor.email,
        actorRole: ctx.actor.role,
        action: e.action,
        entity: e.entity ?? "",
        entityId: e.entityId ?? "",
        docId: e.docId ?? "",
        jobId: e.jobId ?? "",
        field: e.field ?? "",
        before: valueToText(e.before),
        after: valueToText(e.after),
        beforeSource: e.beforeSource ?? (e.before === undefined ? "none" : "client"),
        amount: typeof e.amount === "number" && Number.isFinite(e.amount) ? e.amount : null,
        route: ctx.route,
        requestId: ctx.requestId,
        outcome: e.outcome ?? "ok",
        error: (e.error ?? "").slice(0, MAX_VALUE_CHARS),
        meta: redactMeta(e.meta),
      })),
    );
  } catch {
    /* rule 2: the journal never breaks a write */
  }
}

/** One stored row, as the viewer reads it. */
export interface JournalRow {
  id: number;
  at: string;
  actor: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  docId: string;
  jobId: string;
  field: string;
  before: string;
  after: string;
  beforeSource: string;
  amount: number | null;
  route: string;
  requestId: string;
  outcome: string;
  error: string;
  /** The one-line rendering — built here so every reader shows the same words. */
  summary: string;
}

export interface JournalFilter {
  /** Everything about one bill (or invoice) — the common case. */
  docId?: string;
  /** Everything on one job. */
  jobId?: string;
  /** Everything one person did. */
  actor?: string;
  /** Page size. Capped, because this table only grows. */
  limit?: number;
  /** Rows older than this id, for paging. */
  beforeId?: number;
}

/** Most rows a single read returns, however large a `limit` is asked for. */
export const MAX_JOURNAL_PAGE = 200;

/** Read the journal, newest first. Returns [] on any failure — never throws. */
export async function readJournal(filter: JournalFilter = {}): Promise<JournalRow[]> {
  const limit = Math.max(1, Math.min(filter.limit ?? 100, MAX_JOURNAL_PAGE));
  try {
    await ensureDb();
    const where = [
      filter.docId ? eq(financialEvents.docId, filter.docId) : undefined,
      filter.jobId ? eq(financialEvents.jobId, filter.jobId) : undefined,
      filter.actor ? eq(financialEvents.actor, filter.actor.trim().toLowerCase()) : undefined,
      filter.beforeId ? lt(financialEvents.id, filter.beforeId) : undefined,
    ].filter(Boolean);
    const rows = await db
      .select()
      .from(financialEvents)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(financialEvents.id))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      actorRole: r.actorRole,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      docId: r.docId,
      jobId: r.jobId,
      field: r.field,
      before: r.before,
      after: r.after,
      beforeSource: r.beforeSource,
      amount: r.amount,
      route: r.route,
      requestId: r.requestId,
      outcome: r.outcome,
      error: r.error,
      summary: describeEvent(r),
    }));
  } catch {
    return [];
  }
}
