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
 * How to wire a source: the findings section of docs/CODEBASE_DIRS.md.
 */
import { and, eq } from "drizzle-orm";

import { db, ensureDb, rawDb } from "@/db";
import { findings, type FindingRow } from "@/db/schema";
import { monthClosed } from "@/lib/invoiceReview/schedule";
import { DEFAULT_SETTINGS as REVIEW_SETTINGS } from "@/lib/invoiceReview/settings";

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
  /**
   * What an inline fix acts on, as "<action>:<id>" (components/findingFix.ts):
   * `approve-bill:<billId>` (invoice review / pre-send `qbo-never-approved`),
   * `bill:<billId>` (any other bill finding), `complete-todo:<taskId>`
   * (digest `jobtread-todos`). Empty when the row has no single target.
   */
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
/**
 * Open rows a report must leave alone because the source could not look at
 * them this run: every row of a kind in `kinds`, and every row whose subject
 * is in `subjects`. They keep their state until a run that did look.
 */
export interface ReportKeep {
  kinds?: string[];
  subjects?: string[];
}

export async function report(
  source: string,
  items: FindingInput[],
  scope = "",
  now = new Date().toISOString(),
  keep: ReportKeep = {},
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
      f.title.slice(0, 1200),
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
  // this source + scope with any other time was not reported: it is fixed,
  // unless `keep` says the source did not look at it.
  const kinds = keep.kinds ?? [];
  const subjects = keep.subjects ?? [];
  const notIn = (col: string, xs: string[]) => (xs.length ? ` AND ${col} NOT IN (${xs.map(() => "?").join(", ")})` : "");
  statements.push({
    sql:
      "UPDATE findings SET resolved_at = ? WHERE source = ? AND scope = ? AND resolved_at = '' AND last_seen_at <> ?" +
      notIn("kind", kinds) +
      notIn("subject", subjects),
    args: [now, source, scope, now, ...kinds, ...subjects],
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

/** Sources whose scope starts with a billing month ("2026-10", "2026-10:<jobId>"). */
const MONTH_SCOPED = new Set(["invoice-review", "pre-send"]);

/**
 * True when the row belongs to a billing month past its send day. No run looks
 * at that month again, so the row can never resolve. It is not resolved either:
 * nobody saw it fixed. `list` leaves it out, and Admin → Activity counts it as
 * "month closed". The review page for that month still shows it.
 */
export const isClosedRow = (r: { source: string; scope: string }, now = new Date()) =>
  MONTH_SCOPED.has(r.source) && monthClosed(r.scope, now, REVIEW_SETTINGS.schedule.sendDay);

/**
 * The open rows, worst first, then newest first. Rows of a closed billing
 * month (`isClosedRow`) are left out.
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
  const at = new Date();
  const now = at.toISOString();
  return rows
    .filter((r) => !r.scope.includes("@") || r.scope === opts.reader)
    .filter((r) => !isClosedRow(r, at))
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

/** One row of the Admin → Activity table: how a (source, kind) fared. */
export interface KindStats {
  source: string;
  kind: string;
  seen: number;
  open: number;
  selfResolved: number;
  /** Open when its billing month closed (`isClosedRow`): never fixed, never seen again. */
  closed: number;
  dismissed: number;
  snoozed: number;
}

/**
 * Count findings by (source, kind). Each finding lands in exactly one bucket,
 * checked in this order: dismissed, then resolved (the source stopped
 * reporting it), then month closed, then snoozed now, else open. So the five
 * sum to `seen`.
 */
export function tallyKinds(
  rows: { source: string; kind: string; resolved: boolean; closed?: boolean; dismissed: boolean; snoozed: boolean }[],
): KindStats[] {
  const by = new Map<string, KindStats>();
  for (const r of rows) {
    const k = `${r.source}\u0000${r.kind}`;
    let g = by.get(k);
    if (!g) by.set(k, (g = { source: r.source, kind: r.kind, seen: 0, open: 0, selfResolved: 0, closed: 0, dismissed: 0, snoozed: 0 }));
    g.seen += 1;
    if (r.dismissed) g.dismissed += 1;
    else if (r.resolved) g.selfResolved += 1;
    else if (r.closed) g.closed += 1;
    else if (r.snoozed) g.snoozed += 1;
    else g.open += 1;
  }
  return [...by.values()].sort((a, b) => b.seen - a.seen);
}

/**
 * Read-only counts for Admin → Activity, for findings first seen in the last
 * `days`. Invoice-review rows older than the `findings` store come from
 * `invoice_review_finding_state`; a (month, key) already in `findings` is not
 * counted twice. Those old rows have no snooze, and "set aside" (the ruling it
 * carried when last seen) stands in for dismissed.
 */
export async function findingKindStats(days = 90): Promise<KindStats[]> {
  await ensureDb();
  const now = new Date().toISOString();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const res = await rawDb().execute({
    sql:
      "SELECT source, scope, kind, resolved_at <> '' AS r, dismissed_by <> '' AS d, snoozed_until > ? AS s " +
      "FROM findings WHERE first_seen_at >= ? " +
      "UNION ALL " +
      "SELECT 'invoice-review', ym, kind, resolved_at <> '', was_suppressed, 0 FROM invoice_review_finding_state st " +
      "WHERE first_seen_at >= ? AND NOT EXISTS (SELECT 1 FROM findings f " +
      "WHERE f.source = 'invoice-review' AND f.scope = st.ym AND f.key = st.key)",
    args: [now, since, since],
  });
  return tallyKinds(
    res.rows.map((x) => ({
      source: String(x.source),
      kind: String(x.kind),
      resolved: Number(x.r) === 1,
      closed: isClosedRow({ source: String(x.source), scope: String(x.scope) }),
      dismissed: Number(x.d) === 1,
      snoozed: Number(x.s) === 1,
    })),
  );
}
