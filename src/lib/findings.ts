/**
 * THE FINDINGS STORE — one inbox for every warning in the app.
 *
 * A source calls `report(source, findings, scope)` with everything it sees
 * right now. The store keeps one row per (source, scope, key):
 *
 *   • a finding seen for the first time gets a row, dated now;
 *   • a finding seen again moves its last-seen time (and reopens if it had
 *     resolved, keeping its first-seen time and its dismissal);
 *   • an open row of that source + scope that is NOT in the report resolves.
 *
 * So a source never says "this is fixed". It stops reporting the finding.
 * The rule that follows: A SOURCE WHOSE READ FAILED MUST NOT CALL `report`.
 * An empty report means "I looked and found nothing", and resolves every row.
 *
 * `scope` splits one source into independent reports: the month for invoice
 * review, the reader's email for a per-user finding, "" for the rest. A scope
 * that holds an "@" belongs to that reader alone (`list` hides it from others).
 *
 * The reader's own state is three columns: snoozed until, dismissed by, and
 * resolved. `list` hides a snoozed or dismissed row unless asked.
 *
 * How to wire a source: docs/plans/OVERHAUL_PLAN.md, Phase 5.
 */
import { and, eq } from "drizzle-orm";

import { db, ensureDb, rawDb } from "@/db";
import { findings, type FindingRow } from "@/db/schema";

export type { FindingRow };
export type FindingSeverity = "error" | "warning" | "info";

/** One warning, as a source reports it. */
export interface FindingInput {
  /** Stable within source + scope. The same problem must give the same key. */
  key: string;
  /** What is wrong, in one line. */
  title: string;
  kind?: string;
  /** What it is about: a job id, a vendor name. */
  subject?: string;
  severity?: FindingSeverity;
  /** The page where the fix lives today. */
  link?: string;
  /** Inline fix id. None exist yet. */
  fixAction?: string;
  /**
   * Only for a source that keeps its own dismissals (invoice review's
   * rulings). An object sets the dismissal; null clears it. Leave it out and
   * the inbox's own dismissal stands.
   */
  dismissed?: { by: string; reason: string; at: string } | null;
}

const COLUMNS =
  "source, scope, key, kind, subject, severity, title, link, fix_action, first_seen_at, last_seen_at, dismissed_by, dismissed_at, dismiss_reason";
const REFRESH =
  "kind = excluded.kind, subject = excluded.subject, severity = excluded.severity, title = excluded.title, " +
  "link = excluded.link, fix_action = excluded.fix_action, last_seen_at = excluded.last_seen_at, resolved_at = ''";
const DISMISSAL =
  ", dismissed_by = excluded.dismissed_by, dismissed_at = excluded.dismissed_at, dismiss_reason = excluded.dismiss_reason";

/**
 * Everything `source` sees now, for one scope. Upserts each finding and
 * resolves the open rows that are missing. One transaction. Throws when the
 * database is unreachable; a caller that must not fail wraps it.
 */
export async function report(
  source: string,
  items: FindingInput[],
  scope = "",
  now = new Date().toISOString(),
): Promise<void> {
  await ensureDb();
  const statements = items.map((f) => ({
    sql:
      `INSERT INTO findings (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
      `ON CONFLICT (source, scope, key) DO UPDATE SET ${REFRESH}${f.dismissed !== undefined ? DISMISSAL : ""}`,
    args: [
      source,
      scope,
      f.key,
      f.kind ?? "",
      f.subject ?? "",
      f.severity ?? "warning",
      f.title.slice(0, 400),
      f.link ?? "",
      f.fixAction ?? "",
      now,
      now,
      f.dismissed?.by ?? "",
      f.dismissed?.at ?? "",
      f.dismissed?.reason ?? "",
    ],
  }));
  // Every row this report carried now has last_seen_at = now. An open row of
  // this source + scope with any other time was not reported: it is fixed.
  statements.push({
    sql: "UPDATE findings SET resolved_at = ? WHERE source = ? AND scope = ? AND resolved_at = '' AND last_seen_at <> ?",
    args: [now, source, scope, now],
  });
  await rawDb().batch(statements, "write");
}

async function patch(id: number, set: Partial<FindingRow>): Promise<void> {
  await ensureDb();
  await db.update(findings).set(set).where(eq(findings.id, id));
}

/** Close one row by hand. A source that reports it again reopens it. */
export const resolve = (id: number, now = new Date().toISOString()) => patch(id, { resolvedAt: now });

/** Hide one row until `until` (ISO time). */
export const snooze = (id: number, until: string) => patch(id, { snoozedUntil: until });

/** Hide one row for good. It stays dismissed if the source reports it again. */
export const dismiss = (id: number, by: string, reason = "", now = new Date().toISOString()) =>
  patch(id, { dismissedBy: by, dismissedAt: now, dismissReason: reason });

/** Undo a snooze and a dismissal. */
export const restore = (id: number) =>
  patch(id, { snoozedUntil: "", dismissedBy: "", dismissedAt: "", dismissReason: "" });

export async function get(id: number): Promise<FindingRow | undefined> {
  await ensureDb();
  return (await db.select().from(findings).where(eq(findings.id, id)))[0];
}

/** True when the reader has snoozed or dismissed the row. */
export const isHidden = (r: FindingRow, now = new Date().toISOString()) =>
  Boolean(r.dismissedBy) || r.snoozedUntil > now;

const RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

/**
 * The open rows, worst first, then newest first.
 *
 * `reader` hides the per-user rows of other people. `hidden: true` returns
 * the snoozed and dismissed rows as well.
 */
export async function list(
  opts: { source?: string; scope?: string; reader?: string; hidden?: boolean } = {},
): Promise<FindingRow[]> {
  await ensureDb();
  const rows = await db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.resolvedAt, ""),
        opts.source === undefined ? undefined : eq(findings.source, opts.source),
        opts.scope === undefined ? undefined : eq(findings.scope, opts.scope),
      ),
    );
  const now = new Date().toISOString();
  return rows
    .filter((r) => !r.scope.includes("@") || r.scope === opts.reader)
    .filter((r) => opts.hidden || !isHidden(r, now))
    .sort(
      (a, b) => (RANK[a.severity] ?? 1) - (RANK[b.severity] ?? 1) || b.firstSeenAt.localeCompare(a.firstSeenAt),
    );
}

/** Keys of every row of `source` that carries a dismissal, open or resolved. */
export async function dismissedKeys(source: string): Promise<Set<string>> {
  await ensureDb();
  const rows = await rawDb().execute({
    sql: "SELECT key FROM findings WHERE source = ? AND dismissed_by <> ''",
    args: [source],
  });
  return new Set(rows.rows.map((r) => String(r.key)));
}

/**
 * Dismiss by identity, for a caller that holds the key and not the row id.
 * With no row yet, it makes a resolved one: the next report reopens it, still
 * dismissed.
 */
export async function dismissByKey(
  source: string,
  scope: string,
  key: string,
  by: string,
  title = "",
  now = new Date().toISOString(),
): Promise<void> {
  await ensureDb();
  await rawDb().execute({
    sql:
      "INSERT INTO findings (source, scope, key, kind, severity, title, first_seen_at, last_seen_at, resolved_at, dismissed_by, dismissed_at) " +
      "VALUES (?, ?, ?, ?, 'info', ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (source, scope, key) DO UPDATE SET dismissed_by = excluded.dismissed_by, dismissed_at = excluded.dismissed_at",
    args: [source, scope, key, scope, title.slice(0, 400), now, now, now, by, now],
  });
}

/** Undo a dismissal by identity. No row means nothing to undo. */
export async function restoreByKey(source: string, scope: string, key: string): Promise<void> {
  await ensureDb();
  await rawDb().execute({
    sql:
      "UPDATE findings SET dismissed_by = '', dismissed_at = '', dismiss_reason = '' WHERE source = ? AND scope = ? AND key = ?",
    args: [source, scope, key],
  });
}
