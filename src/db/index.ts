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
      created_at TEXT NOT NULL
    )
  `);
  ensured = true;
}

export { schema };
