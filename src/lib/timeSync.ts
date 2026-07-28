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
import { callAppsScriptOrThrow } from "@/lib/appsScript";

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

// Apps Script calls go through the shared client (src/lib/appsScript.ts), which
// owns the timeout, the retry policy, and the 302/`ok` protocol in one place.
//
// The retry policy matters more here than anywhere else in the app: this module
// exists to stop time records being lost, and a careless retry would instead
// DUPLICATE them. `isRetryable()` decides from the action name — `listTimeEntries`
// is a read and retries automatically; `finalizeTimeEntryLog` writes the JobTread
// id back and is never retried. Don't pass `retry: true` to a finalize call.

async function allWorkedRows(): Promise<RawWorkedRow[]> {
  const data = (await callAppsScriptOrThrow({ action: "listTimeEntries" }, { timeoutMs: 50_000 })) as {
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
    // The entry now EXISTS in JobTread. If writing its id back to the sheet
    // fails, letting that throw would report the whole retry as failed — and the
    // next retry would create a SECOND entry, the exact duplication this module
    // exists to prevent. So report success and name the id, with a status that
    // tells the user the sheet still needs it.
    try {
      await callAppsScriptOrThrow({
        action: "finalizeTimeEntryLog",
        clientKey: id,
        jtEntryId,
        jtStatus: "pushed (retry)",
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : "Unknown error";
      return {
        ok: true,
        jtStatus: "pushed, sheet not updated",
        jtEntryId,
        error:
          `Posted to JobTread as ${jtEntryId}, but writing that id back to the sheet failed ` +
          `(${why}). Paste it into the row's JobTread Entry ID before retrying, or the retry ` +
          `will create a duplicate.`,
      };
    }
    return { ok: true, jtStatus: "pushed", jtEntryId };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    // Best-effort: recording WHY it failed must never replace the real error.
    try {
      await callAppsScriptOrThrow({
        action: "finalizeTimeEntryLog",
        clientKey: id,
        jtEntryId: "",
        jtStatus: "JobTread error: " + error,
      });
    } catch {
      /* the sheet keeps the row unsynced, which is the safe state */
    }
    return { ok: false, jtStatus: "JobTread error", error };
  }
}
