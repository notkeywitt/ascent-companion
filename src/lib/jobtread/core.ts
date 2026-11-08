// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { revalidateTag } from "next/cache";
import { findMutations } from "@/lib/paveGateway";
import { DEPOSIT_CSI } from "@/lib/deposits";
export const PAVE_URL = "https://api.jobtread.com/pave";

/** Per-request timeout. A single Pave page (size ≤ 100) is fast; this only
 *  bounds a hung socket, and sits well under the shortest route budget. */
export const PAVE_TIMEOUT_MS = 30_000;

/** Transport statuses where the request never produced a result, so a repeat is
 *  safe and worth trying. A 200 carrying a JSON `errors` array is a QUERY error,
 *  not transient — it is never retried (repeating a bad query just fails again). */
export const PAVE_RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
export const PAVE_MAX_ATTEMPTS = 3;
/** Backoff before attempts 2 and 3. Short because this blocks a live request
 *  under a route's function budget, unlike the appscript batch loop it mirrors. */
export const PAVE_BACKOFF_MS = [500, 1500];

export const paveSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PaveConfig {
  grantKey: string; // JT_GRANT_KEY
  orgId: string; // JT_ORG_ID, e.g. "22PXG7QcMaQ2"
  companyName?: string; // issuer name for customer invoices (fromName)
}

/** Low-level Pave call. `query` is the Pave query object (grantKey injected here). */
export async function pave<T = any>(cfg: PaveConfig, query: Record<string, unknown>): Promise<T> {
  const body = JSON.stringify({ query: { $: { grantKey: cfg.grantKey }, ...query } });

  // A mutation must NEVER be retried: re-sending create/update/delete after a
  // transient failure risks a duplicate write (a second bill, line, or payment).
  // Reads are safe to repeat, so only they get the backoff loop. Same detector
  // the /api/pave gateway uses, so "what is a write" has a single definition —
  // and it inspects only root fields, so selecting createdAt/updatedAt on a read
  // doesn't make it look like a write.
  const mayRetry = findMutations(query).length === 0;
  const maxAttempts = mayRetry ? PAVE_MAX_ATTEMPTS : 1;

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    let text: string;
    try {
      res = await fetch(PAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(PAVE_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (e) {
      // Network failure or the per-request timeout — transient. Retry a read;
      // surface it immediately for a mutation (we can't know if it landed).
      const why = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error";
      lastErr = new Error(`Pave request ${why}`);
      if (mayRetry && attempt < maxAttempts) {
        await paveSleep(PAVE_BACKOFF_MS[attempt - 1] ?? 1500);
        continue;
      }
      throw lastErr;
    }

    // Transient transport status: the request didn't produce a result. Retry a
    // read, else throw. (A mutation with maxAttempts=1 falls straight through.)
    if (PAVE_RETRY_STATUS.has(res.status)) {
      lastErr = new Error(
        `Pave error (HTTP ${res.status}): ${text ? text.slice(0, 300) : "transient"}`,
      );
      if (mayRetry && attempt < maxAttempts) {
        await paveSleep(PAVE_BACKOFF_MS[attempt - 1] ?? 1500);
        continue;
      }
      throw lastErr;
    }

    // JobTread returns plain text for some errors (e.g. a bad grant key ->
    // "Supplied key is invalid"), so parse defensively rather than assume JSON.
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON response */
    }
    if (!res.ok || json === null || json?.errors) {
      const msg =
        json?.errors?.map((e: any) => e.message).join("; ") ??
        (text ? text.slice(0, 300) : `HTTP ${res.status}`);
      // A query/auth error or a non-JSON 200 — NOT transient, so never retried.
      throw new Error(`Pave error (HTTP ${res.status}): ${msg}`);
    }
    return json as T;
  }

  // Unreachable in practice — the loop returns or throws — but satisfies the
  // type checker and covers a hypothetical zero-attempt configuration.
  throw lastErr ?? new Error("Pave error: request could not be completed");
}

// ---------------------------------------------------------------------------
// REFERENCE-DATA CACHE
// Jobs / vendors / org users / pay-type names change rarely but are read on
// nearly every page load. Memoize them in-process with a short TTL so a warm
// server instance serves repeat reads without re-hitting Pave. The cache key is
// caller-supplied (orgId + args) and NEVER contains the grant key, so secrets
// stay out of keys/logs. Concurrent readers share one in-flight promise, and a
// rejected fetch is evicted so the next call retries instead of caching an error.
// ---------------------------------------------------------------------------
export interface CacheEntry<T> {
  value: Promise<T>;
  expires: number;
}
export const _refCache = new Map<string, CacheEntry<unknown>>();

export function cachedRef<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = _refCache.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const entry: CacheEntry<T> = {
    expires: now + ttlMs,
    value: fetcher().catch((err) => {
      if (_refCache.get(key) === (entry as CacheEntry<unknown>)) _refCache.delete(key);
      throw err;
    }),
  };
  _refCache.set(key, entry as CacheEntry<unknown>);
  return entry.value;
}

/**
 * Drop all cached reference data. Call after a write that could change jobs,
 * vendors, or org membership so the next read reflects it immediately instead of
 * waiting out the TTL.
 */
export function clearJtRefCache(): void {
  _refCache.clear();
}

/**
 * Per-job cost data (budget leaves + cost-to-complete) is cached under these keys.
 * Short TTL: unlike jobs/vendors, this moves whenever a bill is approved or the
 * budget is edited in JobTread, and the bill view renders CTC numbers from it. Long
 * enough to make stepping through a job's coding queue cheap (every bill on a job
 * reads the same two things), short enough that a JobTread-side edit shows up on its
 * own within a minute.
 */
export const JOB_COST_TTL_MS = 60_000;
export const _jobCostKey = (kind: string, orgId: string, jobId: string) => `${kind}:${orgId}:${jobId}`;

/**
 * Drop every cached budget/CTC entry. Call after any write that changes what those
 * queries return — approving a bill (it starts counting toward actual), re-coding a
 * non-draft line, adding/removing/combining lines, moving a bill to another job — so
 * the bill view can't show a stale Remaining column for up to a minute afterward.
 *
 * Deliberately not job-scoped: the bill write routes are given a docId, not a jobId,
 * and resolving one to the other would cost an extra JobTread round trip on every
 * write. Clearing all of them instead costs at most one re-read (~300 ms) on the next
 * bill opened for some *other* job, which is strictly cheaper than that.
 */
export function clearJobCostCaches(): void {
  for (const key of _refCache.keys()) {
    if (
      key.startsWith("budget:") ||
      key.startsWith("ctc:") ||
      key.startsWith("costdetail:") ||
      key.startsWith("contributors:")
    ) {
      _refCache.delete(key);
    }
  }
  // The org-wide "to be invoiced" scans (the job picker's per-job totals, the
  // month donuts) sit in Next's shared cache under this tag. A bill or labor
  // write moves those figures too — without this, a job whose labor was just
  // moved off kept its old total in the picker for up to five minutes.
  // Outside a request (a test, a script) there is no cache to clear.
  try {
    revalidateTag("jt-bills");
  } catch {
    /* no request scope */
  }
}

// ---------------------------------------------------------------------------
// PAGING
//
// Every JobTread connection pages by CURSOR: ask for `nextPage: {}`, then feed
// the token it returns back as `page`. Size is capped at 100 (`size: 250`
// silently returns 0, and `offset` 400s — see JT_API_REFERENCE.md).
//
// This file used to spell that walk out by hand about forty times, and each copy
// picked its own stop limit — 10, 20, 50, 100, 200, 1000. Reaching the limit just
// ended the loop, so a busy job handed back a SHORT list and a total that was
// quietly too low. Nothing was thrown, logged, or sent to Sentry.
//
// `pageAll` / `pageEach` are the one walk now, and they split the two ideas that
// a bare `page < N` could not tell apart:
//
//   maxPages       A RUNAWAY GUARD. Reaching it means the data outgrew what this
//                  query was built for, so the answer would be wrong. It THROWS.
//                  A short answer is never returned.
//   stopAfterPages A DELIBERATE partial read — "the newest page is all I want".
//                  Reaching it returns quietly, because that is the intent.
//
// The rule this generalises was already written here for one function:
// getOrgTimeEntriesForMonth refuses to report a partial month, "because a
// SILENTLY short month is the one failure a payroll report must never have."
// That is now the default for every walk in this file.
// ---------------------------------------------------------------------------

/** The shape every paged Pave connection answers with. */
export interface PaveConnection<T> {
  /** Rows of a plain connection. */
  nodes?: T[] | null;
  /** Rows of a GROUPED connection (`group: { by, aggs }`) — same walk, other key. */
  withValues?: T[] | null;
  /** Cursor for the next page. Absent or null on the last page. */
  nextPage?: string | null;
}

export interface PageWalk<T> {
  /** Names the connection in an error, e.g. `"organization.jobs"`. */
  label: string;
  /**
   * Builds the WHOLE query for one page. `args` already carries `size` and, from
   * the second page on, `page` — spread it into the connection's `$`.
   */
  query: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Finds the paged connection in the answer. */
  pick: (answer: any) => PaveConnection<T> | null | undefined;
  /** Rows per page. JobTread's cap is 100, which is also the default. */
  size?: number;
  /**
   * Runaway guard — the walk THROWS on reaching it rather than returning a short
   * answer. Raise it for a connection that is genuinely large; do not lower it to
   * bound a read. Use `stopAfterPages` for that.
   */
  maxPages?: number;
  /**
   * Read at most this many pages and return what they held, with no error. For a
   * caller that wants a sample rather than the set — the clock-in page reading
   * the newest entry, for instance. Wins over `maxPages` when both are set.
   */
  stopAfterPages?: number;
}

/**
 * Thrown when a walk runs out of pages with rows still to come.
 *
 * Its own class so a caller that retries a query with a different field set can
 * tell "that shape was rejected" (retry) from "there is too much data" (do not
 * retry — the second attempt overflows too).
 */
export class PaveTooManyPagesError extends Error {
  readonly label: string;
  constructor(label: string, message: string) {
    super(message);
    this.name = "PaveTooManyPagesError";
    this.label = label;
  }
}

/** JobTread's own page-size cap. Asking for more returns nothing at all. */
export const PAVE_PAGE_SIZE = 100;

/** 100 pages × 100 rows = 10,000. Past that, assume the query needs narrowing. */
export const PAVE_MAX_PAGES = 100;

/**
 * Walk every page of one connection, handing each page's rows to `onPage`.
 *
 * Return `"stop"` from `onPage` to end the walk early — that is how a search
 * loop quits once it has found its row, and it is never an error.
 *
 * Throws when `maxPages` is reached with a cursor still outstanding. The message
 * names the connection and the ceiling, so the fix (narrow the `where`, or raise
 * the ceiling on purpose) is visible from the error alone.
 */
export async function pageEach<T = any>(
  cfg: PaveConfig,
  walk: PageWalk<T>,
  onPage: (rows: T[]) => void | "stop",
): Promise<void> {
  const size = walk.size ?? PAVE_PAGE_SIZE;
  const guard = walk.maxPages ?? PAVE_MAX_PAGES;
  // A deliberate partial read is not bounded by the runaway guard — it IS a bound.
  const limit = walk.stopAfterPages ?? guard;

  let cursor: string | null = null;

  for (let page = 0; page < limit; page++) {
    const args: Record<string, unknown> = { size };
    if (cursor) args.page = cursor;

    const answer = await pave(cfg, walk.query(args));
    const conn = walk.pick(answer) ?? {};
    // `nodes` for a plain connection, `withValues` for a grouped one. A query
    // asks for exactly one of them, so this never has to choose between two.
    if (onPage(conn.nodes ?? conn.withValues ?? []) === "stop") return;

    cursor = conn.nextPage ?? null;
    if (!cursor) return; // last page — the only ordinary way out
  }

  // Fell out of the loop with a cursor still in hand.
  if (walk.stopAfterPages != null) return; // asked for a sample, got one
  throw new PaveTooManyPagesError(
    walk.label,
    `JobTread has more than ${limit * size} rows of ${walk.label}. ` +
      `Returning part of them would give a wrong total, so nothing is returned. ` +
      `Narrow the query, or raise maxPages on this call if the data really is this large.`,
  );
}

/**
 * The same walk, collecting every row. Use this unless the call site needs to
 * stop early or accumulate as it goes.
 */
export async function pageAll<T = any>(cfg: PaveConfig, walk: PageWalk<T>): Promise<T[]> {
  const out: T[] = [];
  await pageEach<T>(cfg, walk, (rows) => {
    out.push(...rows);
  });
  return out;
}

/**
 * Cost to Complete per cost code = Budgeted Cost − actual. JobTread has no stored
 * CTC field, so both sides are computed from the flat job.costItems connection:
 *
 * - budget is JobTread's "Budgeted Cost" — the sum of the code's cost items on
 *   APPROVED, includeInBudget customerOrder documents (the proposal PLUS every
 *   approved change order). This is deliberately NOT the raw budget-leaf extended
 *   cost (document==null): those leaves are the base estimate and never absorb
 *   change orders, so they understate the real budget (confirmed live 2026-07 on
 *   job "Otis Perkins Addition": leaves summed 1,003,078.68 vs 1,326,647.85 of
 *   approved customer orders). The `approved` filter also drops draft-proposal
 *   duplicates that would otherwise double-count.
 * - actual is the sum of the code's approved+pending vendor-bill cost items.
 *
 * Keyed by cost code number.
 *
 * Both sides are summed BY JOBTREAD, server-side: each is one grouped-aggregate
 * query (`where` narrows to the documents that count, `group.by` = cost code,
 * `aggs.total` = sum of cost) rather than a full paginated scan of job.costItems
 * summed here. Confirmed live 2026-08-03 against the old full-walk numbers on the
 * three biggest jobs — penny-identical per code, in 2 calls instead of 7–13
 * (Otis Perkins: 1,408 ms → 321 ms). Falls back to the old walk if either
 * aggregate ever 400s, so the CTC column can't silently go blank.
 */
/**
 * Every cost item that is NOT a deposit line (cost code CD). An uncoded line has
 * no cost code, and a bare `!=` would drop it along with the deposits, so the
 * null case is kept explicitly. Confirmed live 2026-10-05: it moves Bunkhouse
 * and Otis Perkins invoiced price up by their −$20,000 draws, and Patio Repair
 * from $17,000 (its deposit invoice) to $0.
 */
export const NOT_DEPOSIT_LINE = {
  or: [
    { "=": [{ field: ["costCode", "id"] }, { value: null }] },
    { "!=": [{ field: ["costCode", "number"] }, { value: DEPOSIT_CSI }] },
  ],
};
