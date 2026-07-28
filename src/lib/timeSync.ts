/**
 * Time-record reconciliation — the redundancy layer. Every worked-time entry is
 * saved to the Apps Script "Time Entries" sheet BEFORE JobTread is contacted, so
 * a JobTread failure can never lose a record; this module surfaces any record
 * that hasn't reached JobTread yet and re-posts it on demand. Leave lives in the
 * companion DB and is handled by leaveService's listUnsyncedLeave/retryLeavePost.
 *
 * Worked-time retry reuses EXISTING Apps Script actions: `listTimeEntries`
 * returns every field needed to re-post (user/job/cost/pay type/times), and
 * `finalizeTimeEntryLog` (keyed by the row's EntryID = its idempotency key)
 * writes the JobTread id + status back. So no Apps Script change is needed.
 *
 * Server-only (JobTread grant + shared secret). The JobTread write is still
 * gated by COMPANION_WRITES_ENABLED.
 */
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { createTimeEntry, orgLocalToJtIso } from "@/lib/jobtread";

export interface WorkedRow {
  entryId: string;
  date: string;
  employee: string;
  jtUserId: string;
  jobLabel: string;
  jobId: string;
  costCode: string;
  costItemId: string;
  payType: string;
  start: string;
  end: string;
  note: string;
  jtStatus: string;
}

interface RawWorkedRow {
  entryId?: string;
  date?: string;
  employee?: string;
  jtUserId?: string;
  jobLabel?: string;
  jobId?: string;
  costCode?: string;
  costItemId?: string;
  payType?: string;
  start?: string;
  end?: string;
  note?: string;
  jtEntryId?: string;
  jtStatus?: string;
}

async function callAppsScript(payload: Record<string, unknown>): Promise<unknown> {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) throw new Error("APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret }),
    redirect: "follow",
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function allWorkedRows(): Promise<RawWorkedRow[]> {
  const data = (await callAppsScript({ action: "listTimeEntries" })) as {
    ok?: boolean;
    error?: string;
    rows?: RawWorkedRow[];
  };
  if (data?.ok === false) throw new Error(data.error || "Could not read the Time Entries sheet.");
  return data.rows ?? [];
}

const notInJt = (r: RawWorkedRow) => !String(r.jtEntryId ?? "").trim();

function toWorkedRow(r: RawWorkedRow): WorkedRow {
  return {
    entryId: String(r.entryId ?? "").trim(),
    date: String(r.date ?? "").trim(),
    employee: String(r.employee ?? "").trim(),
    jtUserId: String(r.jtUserId ?? "").trim(),
    jobLabel: String(r.jobLabel ?? "").trim(),
    jobId: String(r.jobId ?? "").trim(),
    costCode: String(r.costCode ?? "").trim(),
    costItemId: String(r.costItemId ?? "").trim(),
    payType: String(r.payType ?? "").trim(),
    start: String(r.start ?? "").trim(),
    end: String(r.end ?? "").trim(),
    note: String(r.note ?? "").trim(),
    jtStatus: String(r.jtStatus ?? "").trim(),
  };
}

/** Worked-time entries saved to the sheet but not yet in JobTread, plus counts. */
export async function listUnsyncedWorked(): Promise<{ rows: WorkedRow[]; total: number; unsynced: number }> {
  const all = await allWorkedRows();
  const rows = all.filter(notInJt).map(toWorkedRow);
  return { rows, total: all.length, unsynced: rows.length };
}

/** Re-post one worked-time row to JobTread and write the result back to the
 *  sheet. Idempotent guard: a row that already carries a JobTread id is skipped.
 *  (The one residual dup risk is a row where a prior create SUCCEEDED but its
 *  write-back failed — rare; such a row shows no id and would re-create. The
 *  sync view makes that visible.) */
export async function retryWorked(
  entryId: string,
): Promise<{ ok: boolean; jtStatus: string; jtEntryId?: string; error?: string }> {
  const id = entryId.trim();
  if (!id) return { ok: false, jtStatus: "", error: "No entryId." };
  const raw = (await allWorkedRows()).find((r) => String(r.entryId ?? "").trim() === id);
  if (!raw) return { ok: false, jtStatus: "", error: "Row not found." };
  if (!notInJt(raw)) return { ok: true, jtStatus: "already posted", jtEntryId: String(raw.jtEntryId).trim() };
  if (!writesEnabled()) return { ok: false, jtStatus: "not posted (writes off)", error: "JobTread writes are off." };
  if (!hasGrant()) return { ok: false, jtStatus: "", error: "No JobTread grant configured." };

  const row = toWorkedRow(raw);
  const startedAt = orgLocalToJtIso(row.start);
  const endedAt = orgLocalToJtIso(row.end);
  const missing = [
    !row.jtUserId && "JobTread user",
    !row.jobId && "job",
    !row.costItemId && "cost code",
    !row.payType && "pay type",
    !startedAt && "start time",
    !endedAt && "end time",
  ].filter(Boolean);
  if (missing.length) {
    return { ok: false, jtStatus: "", error: `Row is missing ${missing.join(", ")} — fix it in the sheet, then retry.` };
  }

  try {
    const { id: jtEntryId } = await createTimeEntry(getPaveConfig(), {
      userId: row.jtUserId,
      jobId: row.jobId,
      costItemId: row.costItemId,
      startedAt,
      endedAt,
      type: row.payType,
      notes: row.note,
      isApproved: false,
    });
    await callAppsScript({ action: "finalizeTimeEntryLog", clientKey: id, jtEntryId, jtStatus: "pushed (retry)" });
    return { ok: true, jtStatus: "pushed", jtEntryId };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    await callAppsScript({ action: "finalizeTimeEntryLog", clientKey: id, jtEntryId: "", jtStatus: "JobTread error: " + error });
    return { ok: false, jtStatus: "JobTread error", error };
  }
}
