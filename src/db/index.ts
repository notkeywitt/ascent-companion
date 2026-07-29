import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Local file by default; point DATABASE_URL at Turso/hosted libSQL for deploy.
const url = process.env.DATABASE_URL ?? "file:./data/companion.db";
const authToken = process.env.DATABASE_AUTH_TOKEN; // only needed for hosted

const client = createClient(authToken ? { url, authToken } : { url });
export const db = drizzle(client, { schema });

// Idempotent schema creation. Cheap to call; run before queries in each route so
// we don't need a separate migration step for the local file during early dev.
let ensured = false;
export async function ensureDb() {
  if (ensured) return;
  await client.execute(`
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
      await client.execute(alter);
    } catch {
      /* column already exists */
    }
  }
  await client.execute(`
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
  await client.execute(`
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
      await client.execute(alter);
    } catch {
      /* column already exists */
    }
  }
  await client.execute(`
    CREATE TABLE IF NOT EXISTS saved_bills (
      doc_id TEXT PRIMARY KEY,
      saved_at TEXT NOT NULL DEFAULT '',
      saved_by TEXT NOT NULL DEFAULT '',
      reviewed INTEGER NOT NULL DEFAULT 0,
      reviewed_at TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT ''
    )
  `);
  // Migrations for the saved_bills table shipped before the reviewed columns
  // existed (idempotent — each throws once the column is present).
  for (const alter of [
    "ALTER TABLE saved_bills ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE saved_bills ADD COLUMN reviewed_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE saved_bills ADD COLUMN reviewed_by TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      await client.execute(alter);
    } catch {
      /* column already exists */
    }
  }
  await client.execute(`
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
  await client.execute(`
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
  await client.execute(`
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
  await client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS leave_balances_emp_type
       ON leave_balances (employee_id, leave_type)`,
  );
  await client.execute(`
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
  await client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS leave_tx_accrual_period
       ON leave_transactions (employee_id, leave_type, period)
       WHERE kind = 'accrual'`,
  );
  // User activity log (login + page-view events) for the Admin → Activity view.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '',
      view_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
  // Indexed on time (window scans for the dashboard) and email (per-user rollups).
  await client.execute(
    `CREATE INDEX IF NOT EXISTS usage_events_created_at ON usage_events (created_at)`,
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS usage_events_email ON usage_events (email)`,
  );
  await client.execute(`
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
  // Labor-rate catalog (assistant-owned; JobTread has no central pay-type catalog).
  await client.execute(`
    CREATE TABLE IF NOT EXISTS labor_rate_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hourly_rate TEXT NOT NULL DEFAULT '0',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // The name IS the JobTread pay-type name (the join key), so it must be unique.
  await client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS labor_rate_catalog_name ON labor_rate_catalog (name)`,
  );
  ensured = true;
}

export { schema };
