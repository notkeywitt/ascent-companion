import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// The libSQL client and its Drizzle wrapper are built LAZILY — on first use, not
// at module import.
//
// `next build` imports every route to collect page data, and a module-scope
// createClient() opened ./data/companion.db at IMPORT time. `data/` is
// gitignored, so a clean clone failed the entire build with ConnectionFailed —
// it only ever passed on a machine that already had the directory. Deferring
// construction to the first query means the build never touches the DB, and an
// unreachable database now fails at the query (with a useful stack) instead of
// at import of an unrelated route.
let _client: ReturnType<typeof createClient> | null = null;

function getClient(): ReturnType<typeof createClient> {
  if (!_client) {
    // Local file by default; point DATABASE_URL at Turso/hosted libSQL for deploy.
    const url = process.env.DATABASE_URL ?? "file:./data/companion.db";
    const authToken = process.env.DATABASE_AUTH_TOKEN; // only needed for hosted
    _client = createClient(authToken ? { url, authToken } : { url });
  }
  return _client;
}

/**
 * The raw libSQL client, for the few call sites that need `batch()` (many writes
 * in one round trip) or FTS5 SQL Drizzle can't model — e.g. the bill-search
 * indexer in src/lib/billSearch.ts. Prefer the typed `db` handle everywhere else.
 */
export function rawDb(): ReturnType<typeof createClient> {
  return getClient();
}

function buildDb() {
  return drizzle(getClient(), { schema });
}
type Db = ReturnType<typeof buildDb>;
let _db: Db | null = null;

function getDb(): Db {
  if (!_db) _db = buildDb();
  return _db;
}

/**
 * The Drizzle handle. A Proxy so `import { db } from "@/db"` stays unchanged
 * across all call sites: nothing is constructed until the first property access
 * (i.e. the first real query), which is what keeps the client out of the build.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    // Read off the real instance directly (this === real), NOT via a receiver of
    // the Proxy — that would route any `this`-using getter back through here.
    // Methods are bound to real so `db.select()` keeps its receiver.
    const real = getDb();
    const value = (real as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

/**
 * Idempotent schema creation, run before queries in each route so we don't need a
 * separate migration step for the local file during early dev.
 *
 * In production the DB is hosted (Turso), so every statement in `applySchema` is a
 * network round trip — and a serverless instance starts cold with `ensured` unset,
 * so the whole block used to re-run on the first request each instance served
 * (~24 sequential round trips in front of a one-row lookup). Now a warm database
 * costs ONE read: `applySchema`'s own source is hashed into a fingerprint stored in
 * `schema_meta`, and a match short-circuits. Fingerprinting the source (not a
 * hand-maintained version number) means editing any statement below automatically
 * invalidates the marker — there is nothing to remember to bump. Worst case after a
 * deploy that changes the bundled output, one request re-runs the block and rewrites
 * the marker; the statements are all idempotent, so that is harmless.
 *
 * The in-flight promise is shared, so concurrent first-callers in one instance wait
 * on a single run instead of each starting their own; a failure clears it so the
 * next caller retries rather than inheriting a rejected promise.
 */
let ensuring: Promise<void> | null = null;

export function ensureDb(): Promise<void> {
  if (!ensuring) {
    ensuring = runEnsure().catch((err) => {
      ensuring = null;
      throw err;
    });
  }
  return ensuring;
}

/**
 * FNV-1a over a string. Deliberately hand-rolled rather than `node:crypto`: this
 * module is reachable from the Edge middleware bundle (via auth.ts), which cannot
 * import node: builtins. It only has to detect change, not resist anything.
 */
function fingerprintOf(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${source.length.toString(36)}-${h.toString(36)}`;
}

async function runEnsure(): Promise<void> {
  const fingerprint = fingerprintOf(applySchema.toString());
  try {
    const r = await getClient().execute("SELECT value FROM schema_meta WHERE key = 'fingerprint'");
    if (r.rows[0]?.value === fingerprint) return; // schema already at this revision
  } catch {
    /* schema_meta doesn't exist yet — first run against this database */
  }
  await applySchema();
  // Marker written LAST, so a run that dies partway leaves it stale and the next
  // caller re-applies rather than skipping an incomplete schema.
  await getClient().execute(
    `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );
  await getClient().execute({
    sql: `INSERT INTO schema_meta (key, value) VALUES ('fingerprint', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [fingerprint],
  });
}

/** Every DDL statement for the companion DB. Idempotent — safe to re-run in full. */
async function applySchema() {
  // email → JobTread identity, cached from the Employee roster so a page load
  // costs one DB read instead of a ~3 s Apps Script round trip (see the table's
  // note in db/schema.ts and lib/jtUserLink.ts).
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS jt_user_links (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      jt_user_id TEXT NOT NULL DEFAULT '',
      jt_user_name TEXT NOT NULL DEFAULT '',
      employee_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS rfis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      question TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      assignee TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      date_sent TEXT NOT NULL DEFAULT '',
      date_answered TEXT NOT NULL DEFAULT '',
      answer TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // Migrations for DBs created before these columns existed (idempotent).
  for (const alter of [
    "ALTER TABLE rfis ADD COLUMN date_sent TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE rfis ADD COLUMN date_answered TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await getClient().execute(alter);
    } catch {
      /* column already exists */
    }
  }
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS feature_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      requester TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS allowed_users (
      email TEXT PRIMARY KEY,
      added_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'field',
      views_allow TEXT NOT NULL DEFAULT '[]',
      views_deny TEXT NOT NULL DEFAULT '[]'
    )
  `);
  // Migrations for DBs created before roles/overrides existed (idempotent —
  // each throws once the column is present). Pre-existing members backfill to
  // 'field'; re-grade them on /admin after deploy.
  for (const alter of [
    "ALTER TABLE allowed_users ADD COLUMN role TEXT NOT NULL DEFAULT 'field'",
    "ALTER TABLE allowed_users ADD COLUMN views_allow TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE allowed_users ADD COLUMN views_deny TEXT NOT NULL DEFAULT '[]'",
  ]) {
    try {
      await getClient().execute(alter);
    } catch {
      /* column already exists */
    }
  }
  // Per-role view-set overrides (DB layer on top of the hardcoded ROLE_VIEWS
  // defaults) — lets /admin change what a whole role sees, not just one person.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS role_access (
      role TEXT PRIMARY KEY,
      views_allow TEXT NOT NULL DEFAULT '[]',
      views_deny TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
  // Per-check overrides on top of the hardcoded DIGEST_SETTINGS defaults — lets
  // /admin tune the Daily Digest without a redeploy. Read fresh on every run.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS digest_settings_overrides (
      check_id TEXT PRIMARY KEY,
      enabled INTEGER,
      config TEXT,
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS saved_bills (
      doc_id TEXT PRIMARY KEY,
      saved_at TEXT NOT NULL DEFAULT '',
      saved_by TEXT NOT NULL DEFAULT '',
      reviewed INTEGER NOT NULL DEFAULT 0,
      reviewed_at TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      needs_review INTEGER NOT NULL DEFAULT 0,
      review_note TEXT NOT NULL DEFAULT '',
      review_flagged_at TEXT NOT NULL DEFAULT '',
      review_flagged_by TEXT NOT NULL DEFAULT ''
    )
  `);
  // Migrations for the saved_bills table shipped before the reviewed / needs-
  // review columns existed (idempotent — each throws once the column is present).
  for (const alter of [
    "ALTER TABLE saved_bills ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE saved_bills ADD COLUMN reviewed_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE saved_bills ADD COLUMN reviewed_by TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE saved_bills ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE saved_bills ADD COLUMN review_note TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE saved_bills ADD COLUMN review_flagged_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE saved_bills ADD COLUMN review_flagged_by TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await getClient().execute(alter);
    } catch {
      /* column already exists */
    }
  }
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS sunset_statements (
      exp_id TEXT PRIMARY KEY,
      project TEXT NOT NULL DEFAULT '',
      statement_date TEXT NOT NULL DEFAULT '',
      pdf_url TEXT NOT NULL DEFAULT '',
      account_name TEXT NOT NULL DEFAULT '',
      statement_number TEXT NOT NULL DEFAULT '',
      total TEXT NOT NULL DEFAULT '',
      discount TEXT NOT NULL DEFAULT '',
      net TEXT NOT NULL DEFAULT '',
      extracted_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unpaid',
      paid_at TEXT NOT NULL DEFAULT '',
      paid_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // PTO / sick-time accrual (assistant-owned; JobTread has no accrual object).
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS leave_policies (
      leave_type TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      hours_per_hour_worked TEXT NOT NULL DEFAULT '0',
      annual_cap TEXT NOT NULL DEFAULT '0',
      carryover_cap TEXT NOT NULL DEFAULT '0',
      waiting_days INTEGER NOT NULL DEFAULT 0,
      tenure_tiers TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      jt_user_id TEXT NOT NULL DEFAULT '',
      leave_type TEXT NOT NULL,
      accrued TEXT NOT NULL DEFAULT '0',
      used TEXT NOT NULL DEFAULT '0',
      balance TEXT NOT NULL DEFAULT '0',
      accrued_through_period TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )
  `);
  await getClient().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS leave_balances_emp_type
       ON leave_balances (employee_id, leave_type)`,
  );
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS leave_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      kind TEXT NOT NULL,
      hours TEXT NOT NULL DEFAULT '0',
      period TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      jt_entry_id TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  // Re-running accrual for the same employee × leave type × pay period is a
  // no-op — only 'accrual' rows are constrained; 'taken'/'adjustment' carry an
  // empty period and are unconstrained.
  await getClient().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS leave_tx_accrual_period
       ON leave_transactions (employee_id, leave_type, period)
       WHERE kind = 'accrual'`,
  );
  // User activity log (login + page-view + coding events) for the Admin →
  // Activity view.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '',
      view_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  // Migration for DBs created before the coding-detail column existed (idempotent).
  try {
    await getClient().execute("ALTER TABLE usage_events ADD COLUMN detail TEXT NOT NULL DEFAULT ''");
  } catch {
    /* column already exists */
  }
  // Indexed on time (window scans for the dashboard) and email (per-user rollups).
  await getClient().execute(
    `CREATE INDEX IF NOT EXISTS usage_events_created_at ON usage_events (created_at)`,
  );
  await getClient().execute(
    `CREATE INDEX IF NOT EXISTS usage_events_email ON usage_events (email)`,
  );
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      jt_user_id TEXT NOT NULL DEFAULT '',
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      hours TEXT NOT NULL DEFAULT '0',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      decided_by TEXT NOT NULL DEFAULT '',
      decided_at TEXT NOT NULL DEFAULT '',
      jt_entry_id TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // Remembered CSV-line → employee mappings for the TSheets balance import.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS leave_import_aliases (
      csv_key TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )
  `);
  // Labor-rate catalog + groups (assistant-owned; JobTread has no central pay-type
  // catalog). A group (project) prepends its name to each rate on push.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS labor_rate_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await getClient().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS labor_rate_groups_name ON labor_rate_groups (name)`,
  );
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS labor_rate_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      group_id INTEGER NOT NULL DEFAULT 0,
      hourly_rate TEXT NOT NULL DEFAULT '0',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // Migration for catalogs created before groups existed (idempotent).
  try {
    await getClient().execute("ALTER TABLE labor_rate_catalog ADD COLUMN group_id INTEGER NOT NULL DEFAULT 0");
  } catch {
    /* column already exists */
  }
  // Uniqueness moved from (name) to (group_id, name) — the same short name can
  // exist in different groups. Drop the old single-column unique index if present.
  await getClient().execute(`DROP INDEX IF EXISTS labor_rate_catalog_name`);
  await getClient().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS labor_rate_catalog_group_name ON labor_rate_catalog (group_id, name)`,
  );
  // Lead tracking on top of JobTread's "New Lead" customers (JT owns the Status
  // custom field that defines the list; these tables hold what we're doing about
  // each one). Keyed by the JT account id — no autoincrement id of our own.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS leads (
      account_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL DEFAULT 'new',
      next_action TEXT NOT NULL DEFAULT '',
      next_action_date TEXT NOT NULL DEFAULT '',
      last_contact_date TEXT NOT NULL DEFAULT '',
      est_value TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS lead_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'note',
      note TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  await getClient().execute(
    `CREATE INDEX IF NOT EXISTS lead_activities_account ON lead_activities (account_id)`,
  );
  // Leads logged without JobTread — the website intake form, filled in by us.
  // Companion-OWNED (not a mirror): the row IS the lead until it's pushed, at
  // which point jt_account_id points at the customer JobTread then owns.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS lead_inquiries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      contact_method TEXT NOT NULL DEFAULT '',
      residency TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      services TEXT NOT NULL DEFAULT '',
      project_details TEXT NOT NULL DEFAULT '',
      design_status TEXT NOT NULL DEFAULT '',
      budget TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      target_date TEXT NOT NULL DEFAULT '',
      lead_source TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      source_message_id TEXT NOT NULL DEFAULT '',
      source_form TEXT NOT NULL DEFAULT '',
      related_files TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      jt_account_id TEXT NOT NULL DEFAULT '',
      pushed_at TEXT NOT NULL DEFAULT '',
      pushed_by TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // Provenance/review columns, for a table created before web-inquiry ingestion
  // existed (idempotent — same pattern as labor_rate_catalog.group_id).
  for (const column of [
    "source_message_id TEXT NOT NULL DEFAULT ''",
    "source_form TEXT NOT NULL DEFAULT ''",
    "related_files TEXT NOT NULL DEFAULT ''",
    "reviewed_at TEXT NOT NULL DEFAULT ''",
    "reviewed_by TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await getClient().execute(`ALTER TABLE lead_inquiries ADD COLUMN ${column}`);
    } catch {
      /* column already exists */
    }
  }
  await getClient().execute(
    `CREATE INDEX IF NOT EXISTS lead_inquiries_jt_account ON lead_inquiries (jt_account_id)`,
  );
  // The de-duplication guarantee for ingested submissions: one lead per Gmail
  // message. PARTIAL, so the many hand-logged rows (all "") don't collide.
  await getClient().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS lead_inquiries_source_message
       ON lead_inquiries (source_message_id) WHERE source_message_id != ''`,
  );
  // Tombstones for ingested website submissions deleted off the board. Deleting
  // an inquiry drops its row (and the de-dup guard with it), so without this the
  // next mailbox scan re-files it. The ingest treats an id here as already known.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS lead_inquiry_dismissals (
      source_message_id TEXT PRIMARY KEY,
      dismissed_at TEXT NOT NULL,
      dismissed_by TEXT NOT NULL DEFAULT ''
    )
  `);
  // "Flag for review" marks on JobTread time entries, set from Labor Review.
  // Companion-owned workflow state — JobTread has no such field on a time entry.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS flagged_time_entries (
      time_entry_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL DEFAULT '',
      flagged INTEGER NOT NULL DEFAULT 0,
      flagged_at TEXT NOT NULL DEFAULT '',
      flagged_by TEXT NOT NULL DEFAULT ''
    )
  `);
  await getClient().execute(
    `CREATE INDEX IF NOT EXISTS flagged_time_entries_job ON flagged_time_entries (job_id)`,
  );
  // Office-edited on-screen text (Admin → Page Text), keyed by the registry ids
  // in src/lib/copy.ts. Override-only: an absent row means the page renders the
  // English shipped in the code, so an empty table is the correct default state.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS page_copy (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT ''
    )
  `);
  // Admin notices — announcements pushed to users as a global popup. Companion-
  // owned; a notice_reads row per (notice, reader) is the "seen it" mark.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT 'info',
      audience_type TEXT NOT NULL DEFAULT 'all',
      audience_value TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS notice_reads (
      notice_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (notice_id, email)
    )
  `);
  // Bill search index (companion-owned CACHE, not a source of truth): the local
  // snapshot of every vendor bill + line item that makes /bill-search resolve in
  // under a second. `source='jobtread'` rows come from the live Pave sweep (keyed
  // by jt_doc_id); `source='sheet'` rows are the one-time pre-JobTread seed out of
  // the Expenditure/lineItem sheets (keyed by exp_id). See src/lib/billSearch.ts
  // and the table notes in db/schema.ts.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS bill_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'jobtread',
      jt_doc_id TEXT NOT NULL DEFAULT '',
      exp_id TEXT NOT NULL DEFAULT '',
      vendor TEXT NOT NULL DEFAULT '',
      vendor_id TEXT NOT NULL DEFAULT '',
      invoice_id TEXT NOT NULL DEFAULT '',
      bill_number TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      issue_date TEXT NOT NULL DEFAULT '',
      job_id TEXT NOT NULL DEFAULT '',
      job_name TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      csi TEXT NOT NULL DEFAULT '',
      pdf_file_id TEXT NOT NULL DEFAULT '',
      is_sunset INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
  // One bill per JobTread document / per sheet ExpID — partial uniques so the two
  // sources each dedupe on their own key without the empty other-key colliding.
  await getClient().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS bill_index_jt_doc ON bill_index (jt_doc_id) WHERE jt_doc_id != ''`,
  );
  await getClient().execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS bill_index_exp ON bill_index (exp_id) WHERE exp_id != ''`,
  );
  await getClient().execute(
    `CREATE INDEX IF NOT EXISTS bill_index_issue_date ON bill_index (issue_date)`,
  );
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS bill_line_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      line_id TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      csi TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0
    )
  `);
  await getClient().execute(
    `CREATE INDEX IF NOT EXISTS bill_line_index_bill ON bill_line_index (bill_id)`,
  );
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS bill_index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);
  // The full-text index itself: one FTS5 row per bill (rowid = bill_index.id),
  // carrying vendor / invoice # / concatenated line text. `porter` stems, so
  // "plumbing" also hits "plumb"; a search matches a bill by vendor OR any line.
  // Wrapped because a libSQL build without FTS5 would otherwise fail the whole
  // schema — the search lib falls back to LIKE when this table is absent.
  try {
    await getClient().execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS bill_fts USING fts5(vendor, invoice, lines, tokenize='porter unicode61')`,
    );
  } catch {
    /* FTS5 unavailable in this libSQL build — search degrades to LIKE (see billSearch.ts) */
  }
  // The Admin Daily Digest: one row per day holding each check's STRUCTURED
  // result plus the single Gemini summary paragraph over them. Rewritten in
  // place by "Refresh now", so a date has exactly one digest. The only thing
  // that feature writes anywhere — see src/lib/digest/.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS daily_digest (
      date TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      summary TEXT NOT NULL DEFAULT '',
      summary_source TEXT NOT NULL DEFAULT 'fallback',
      results TEXT NOT NULL DEFAULT '[]',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      log TEXT NOT NULL DEFAULT '[]'
    )
  `);

  // The monthly client-invoice review's standing rulings — the office's answers
  // to findings they have already overruled ("we know, it's fine, here's why"),
  // keyed by the finding's stable identity. The only thing that feature writes.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS invoice_review_rulings (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT '',
      job_id TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'finding',
      reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Every client-invoice review that has ever run — the feature's history, and
  // what the learning layer reads. Appended, never overwritten: many rows per
  // billing month, newest first. See db/schema.ts for why.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS invoice_review_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ym TEXT NOT NULL,
      ran_at TEXT NOT NULL,
      ran_by TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      error_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      info_count INTEGER NOT NULL DEFAULT 0,
      suppressed_count INTEGER NOT NULL DEFAULT 0,
      amount_at_stake REAL NOT NULL DEFAULT 0,
      capture_complete INTEGER NOT NULL DEFAULT 0,
      evidence_warning_count INTEGER NOT NULL DEFAULT 0,
      evidence_hash TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Reads are always "the newest run(s) for this billing month".
  await getClient().execute(`
    CREATE INDEX IF NOT EXISTS invoice_review_runs_ym_idx
      ON invoice_review_runs (ym, ran_at DESC)
  `);

  // The learning layer (see db/schema.ts for what each is FOR):
  //   finding_state — when each finding appeared, and whether it ever went away.
  //                   "is this new or has it been there since March", and the
  //                   per-check precision derived from what the office does next.
  //   misses        — billing mistakes the review did NOT catch. The training
  //                   set: the only input a genuinely new check can come from.
  //   instructions  — durable preferences injected into the summary prompt.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS invoice_review_finding_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ym TEXT NOT NULL,
      key TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      check_id TEXT NOT NULL DEFAULT '',
      job_id TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      runs_seen INTEGER NOT NULL DEFAULT 1,
      resolved_at TEXT NOT NULL DEFAULT '',
      was_suppressed INTEGER NOT NULL DEFAULT 0
    )
  `);
  // (ym, key), not key alone — a finding key is stable but not unique across
  // months, and merging two months into one row would report a brand-new
  // problem as nine months old.
  await getClient().execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS invoice_review_finding_state_ym_key_idx
      ON invoice_review_finding_state (ym, key)
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS invoice_review_misses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ym TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      job_id TEXT NOT NULL DEFAULT '',
      job_name TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      invoice_id TEXT NOT NULL DEFAULT '',
      how_caught TEXT NOT NULL DEFAULT '',
      should_have_been_caught_by TEXT NOT NULL DEFAULT '',
      addressed_at TEXT NOT NULL DEFAULT '',
      addressed_note TEXT NOT NULL DEFAULT '',
      recorded_by TEXT NOT NULL DEFAULT '',
      recorded_at TEXT NOT NULL
    )
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS invoice_review_instructions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  // Claude's verdict on each finding, from the investigation pass. Kept apart
  // from the findings themselves because a finding is what a check COMPUTED and
  // a disposition is what a model JUDGED — see db/schema.ts. A disposition
  // never suppresses anything; only a ruling does that.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS invoice_review_dispositions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ym TEXT NOT NULL,
      key TEXT NOT NULL,
      verdict TEXT NOT NULL DEFAULT 'needs-human',
      why TEXT NOT NULL DEFAULT '',
      suggested_action TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  await getClient().execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS invoice_review_dispositions_ym_key_idx
      ON invoice_review_dispositions (ym, key)
  `);

  // The Daily Digest's todo/reminder memory, sender ignore-rules, and reply audit
  // trail — written only by POST /api/digest/reply, read by the digest-todos
  // check and (ignore rules) the email-followups check. See db/schema.ts.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS digest_todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      snooze_until TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'reply',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT ''
    )
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS digest_ignore_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'email_sender',
      pattern TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS digest_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      digest_date TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      actions_applied TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  // The Daily Digest's STANDING INSTRUCTIONS — the owner's durable preferences
  // for how the morning brief is written, injected into the summary prompt on
  // every run (see src/lib/digest/instructions.ts + claude.ts). Distinct from
  // digest_todos (a one-time reminder); this is memory for Claude, not a note.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS digest_instructions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);

  // Unsynced Tracking Sheets coding, per user and per scope — the cross-device
  // BACKUP for a staged draft (localStorage is the primary; see
  // src/lib/codingDraft.ts and the table's note in db/schema.ts). Deleted on
  // Sync and on Revert, and swept once a row passes DRAFT_TTL_DAYS.
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS coding_drafts (
      email TEXT NOT NULL,
      key TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (email, key)
    )
  `);
  // Reads are always "this user's drafts", newest first.
  await getClient().execute(
    `CREATE INDEX IF NOT EXISTS coding_drafts_email_idx ON coding_drafts (email, updated_at DESC)`,
  );
}

export { schema };
