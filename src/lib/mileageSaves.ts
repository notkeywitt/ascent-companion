/**
 * A FINISHED-TRIP SAVE IS WRITTEN ONCE — the server half of the mileage outbox.
 *
 * The phone keeps every trip save it has not seen confirmed
 * (`src/lib/mileageOutbox.ts`) and sends it again when the app next opens. That
 * second send can follow a first one that DID reach the Mileage sheet: the app
 * closed before the reply came back. Apps Script `logMileage` appends a row
 * each time it runs, so this module claims each client key in the companion DB
 * (table `mileage_saves`) before the route calls Apps Script.
 *
 *   no row        → claim it ("saving") and save.
 *   "saved"       → answer the first save's reply again; write nothing.
 *   "saving", new → another send of this trip is still running: answer 409.
 *   "saving", old, or "failed"
 *                 → unknown whether the sheet got the row. Look for the client
 *                   key on the sheet (`listMileage`); save only if it is absent.
 *
 * The DB is a guard, not a gate: if it cannot be reached the route saves as it
 * always did.
 */
import { rawDb, ensureDb } from "@/db";
import { callAppsScript } from "@/lib/appsScript";

/** A "saving" claim younger than this belongs to a send still in flight. */
export const SAVE_LOCK_MS = 90_000;
/** Rows older than this are swept; the phone gives up on a save long before. */
const SAVE_TTL_DAYS = 30;

export type SaveState = "saving" | "saved" | "failed";
export interface SaveRow {
  state: string;
  result: string;
  updatedAt: string;
}
export type SaveDecision = "saved" | "busy" | "check";

/** What to do with a key that already has a row. Pure, for the tests. */
export function decideExisting(row: SaveRow, now = Date.now()): SaveDecision {
  if (row.state === "saved") return "saved";
  const age = now - Date.parse(row.updatedAt);
  if (row.state === "saving" && Number.isFinite(age) && age < SAVE_LOCK_MS) return "busy";
  return "check";
}

/**
 * The sheet months a trip can land in. The sheet dates a trip in local time and
 * the server runs in UTC, so each timestamp also counts 12 hours either side.
 */
export function monthsFor(body: Record<string, unknown>, now = new Date()): string[] {
  const out = new Set<string>();
  for (const k of ["startTime", "endTime"]) {
    const t = Date.parse(String(body[k] ?? ""));
    if (!Number.isFinite(t)) continue;
    for (const d of [-12, 0, 12]) out.add(new Date(t + d * 3_600_000).toISOString().slice(0, 7));
  }
  const date = String(body.date ?? "");
  if (/^\d{4}-\d{2}/.test(date)) out.add(date.slice(0, 7));
  if (!out.size) out.add(now.toISOString().slice(0, 7));
  return [...out];
}

export type Claim =
  | { kind: "new" } // claimed: save it
  | { kind: "saved"; result: Record<string, unknown> } // already saved: answer this
  | { kind: "busy" } // another send is running
  | { kind: "unchecked"; error: string } // could not look at the sheet
  | { kind: "off" }; // no key, or the DB is down: save without the guard

/** Claim a client key before the save. Never throws. */
export async function claimSave(
  clientKey: string,
  email: string,
  body: Record<string, unknown>,
): Promise<Claim> {
  if (!clientKey) return { kind: "off" };
  let row: SaveRow | undefined;
  try {
    await ensureDb();
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - SAVE_TTL_DAYS * 86_400_000).toISOString();
    await rawDb().execute({ sql: "DELETE FROM mileage_saves WHERE updated_at < ?", args: [cutoff] });
    const ins = await rawDb().execute({
      sql: `INSERT INTO mileage_saves (client_key, email, state, result, updated_at)
            VALUES (?, ?, 'saving', '', ?) ON CONFLICT(client_key) DO NOTHING`,
      args: [clientKey, email, now],
    });
    if (ins.rowsAffected === 1) return { kind: "new" };
    const r = await rawDb().execute({
      sql: "SELECT state, result, updated_at FROM mileage_saves WHERE client_key = ?",
      args: [clientKey],
    });
    const x = r.rows[0];
    if (!x) return { kind: "off" };
    row = { state: String(x.state), result: String(x.result), updatedAt: String(x.updated_at) };
  } catch {
    return { kind: "off" };
  }

  const decision = decideExisting(row);
  if (decision === "saved") return { kind: "saved", result: parseResult(row.result) };
  if (decision === "busy") return { kind: "busy" };

  // Unknown outcome. Take the claim again first, so a parallel retry waits.
  try {
    const cutoff = new Date(Date.now() - SAVE_LOCK_MS).toISOString();
    const re = await rawDb().execute({
      sql: `UPDATE mileage_saves SET state = 'saving', updated_at = ?
            WHERE client_key = ? AND (state = 'failed' OR (state = 'saving' AND updated_at < ?))`,
      args: [new Date().toISOString(), clientKey, cutoff],
    });
    if (re.rowsAffected !== 1) return { kind: "busy" };
  } catch {
    return { kind: "off" };
  }

  const found = await findOnSheet(clientKey, email, body);
  if (found === "error") {
    await finishSave(clientKey, "failed");
    return { kind: "unchecked", error: "Could not check the Mileage sheet. The phone will try again." };
  }
  if (found) {
    await finishSave(clientKey, "saved", found);
    return { kind: "saved", result: found };
  }
  return { kind: "new" };
}

/** Record how the save ended. Never throws. */
export async function finishSave(clientKey: string, state: SaveState, result?: unknown): Promise<void> {
  if (!clientKey) return;
  try {
    await rawDb().execute({
      sql: "UPDATE mileage_saves SET state = ?, result = ?, updated_at = ? WHERE client_key = ?",
      args: [state, result === undefined ? "" : JSON.stringify(result), new Date().toISOString(), clientKey],
    });
  } catch {}
}

function parseResult(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object") return v as Record<string, unknown>;
  } catch {}
  return { ok: true };
}

/** The trip row carrying this client key, as a save reply; null if absent. */
async function findOnSheet(
  clientKey: string,
  email: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null | "error"> {
  for (const month of monthsFor(body)) {
    const r = await callAppsScript({ action: "listMileage", requesterEmail: email, month, user: "" });
    const data = r.data as { ok?: boolean; trips?: Record<string, unknown>[] } | undefined;
    if (r.error || !data || data.ok === false) return "error";
    const t = (data.trips ?? []).find((x) => String(x["Client Key"] ?? "") === clientKey);
    if (t) {
      const miles = Number(t["Miles"]);
      return {
        ok: true,
        tripId: String(t["TripID"] ?? ""),
        miles: Number.isFinite(miles) && String(t["Miles"] ?? "") !== "" ? miles : null,
        date: String(t["Date"] ?? ""),
        startAddress: String(t["Start Address"] ?? ""),
        endAddress: String(t["End Address"] ?? ""),
        via: String(t["Via"] ?? ""),
        deduped: true,
      };
    }
  }
  return null;
}

/** The trip is saved: drop the server's open-trip copy if it is this trip. */
export async function closeOpenTrip(email: string, clientKey: string): Promise<void> {
  if (!email || !clientKey) return;
  try {
    await rawDb().execute({
      sql: `DELETE FROM mileage_open_trips
            WHERE email = ? AND json_extract(payload, '$.tripKey') = ?`,
      args: [email.trim().toLowerCase(), clientKey],
    });
  } catch {}
}

/** True when this trip's save has landed. False when unknown. Never throws. */
export async function isSaved(clientKey: string): Promise<boolean> {
  if (!clientKey) return false;
  try {
    const r = await rawDb().execute({
      sql: "SELECT 1 FROM mileage_saves WHERE client_key = ? AND state = 'saved'",
      args: [clientKey],
    });
    return r.rows.length > 0;
  } catch {
    return false;
  }
}
