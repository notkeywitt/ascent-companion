/**
 * The one client for the Apps Script web app.
 *
 * The Assistant has no Sheets/Drive grants of its own, so every Sheets- or
 * Drive-backed feature (employees, tools, mileage, safety meetings, employee
 * time, requisitions, Sunset payments, the tracking sheets, the audit log)
 * POSTs `{ action, secret, ...payload }` to a single versioned `/exec` URL and
 * reads the answer out of the body.
 *
 * This module replaced 17 hand-copied `callAppsScript` helpers spread across 26
 * route files. They had drifted into three different return shapes and none of
 * them had a timeout or a retry, so a slow or briefly-unavailable Apps Script
 * surfaced on a phone in the field as a hard error with no second chance.
 *
 * ## The protocol, in one place
 *
 * An Apps Script web app does NOT answer the POST directly. It 302s to a
 * one-time `googleusercontent.com` URL and serves the body from there, always
 * with HTTP 200 — so the transport status tells you almost nothing, and
 * success/failure is the `ok` field inside the JSON. The one thing a non-200
 * *does* tell you is that the request never reached the script at all (Google's
 * front end rate-limited it, or the deployment is down), which is exactly the
 * case worth retrying.
 *
 * ## Retry safety — read this before adding `retry: true`
 *
 * Most actions here WRITE a row to a spreadsheet, and they are not idempotent:
 * retrying a `logMileage` that actually succeeded but whose response was lost
 * writes the trip twice. So retry is OFF unless the action is known to be a
 * read. `isRetryable()` infers that from the action name and errs toward "this
 * writes" — an unrecognized action is never retried.
 *
 * If you add a write action that IS safe to retry (because Apps Script
 * de-duplicates it on some key), pass `retry: true` explicitly at the call site
 * and say why in a comment. Do not widen `isRetryable()`.
 */
import { NextResponse } from "next/server";

/** Default ceiling for a single call, including retries. Deliberately under the
 *  10s platform budget of a route that declares no `maxDuration`; routes that
 *  declare a longer one should pass `timeoutMs` to match (see callers). */
const DEFAULT_TIMEOUT_MS = 25_000;

/** At most two extra attempts, and only for reads. Apps Script calls are slow —
 *  an aggressive retry budget just burns the function's wall clock and turns a
 *  recoverable blip into a platform timeout. */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [400, 1_200];

/** Google front-end responses that mean "the script never ran" — safe to retry. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface AppsScriptOptions {
  /**
   * Allow retrying on network failure / a retryable HTTP status. Defaults to
   * whatever `isRetryable(payload.action)` says. Only override to `true` for an
   * action you have confirmed is safe to run twice.
   */
  retry?: boolean;
  /** Whole-call budget in ms, retries included. Defaults to 25s. */
  timeoutMs?: number;
}

/**
 * The shape most call sites consume: `{ data }` on success, `{ error, status }`
 * on failure. Never throws — a caller that forgets to check `error` gets
 * `undefined` data rather than an unhandled rejection.
 */
export interface AppsScriptResult<T = unknown> {
  data?: T;
  error?: string;
  status: number;
}

/**
 * Read-only actions, which are the only ones retried by default.
 *
 * `list*` / `get*` cover most of the dispatcher in Diagnostics.js; the rest are
 * named because their prefix doesn't give them away. Anything absent is treated
 * as a write.
 */
const EXTRA_READ_ACTIONS = new Set([
  "toolsBootstrap",
  "timeEntryBootstrap",
  "sunsetDuplicates", // an org-wide scan; writes nothing
  "historicalCostPreview", // the dry-run half of the import
]);

/** Whether an action is safe to send twice. Unknown ⇒ assume it writes. */
export function isRetryable(action: unknown): boolean {
  const name = String(action ?? "").trim();
  if (!name) return false; // no action = the bare full-sync kick, which writes
  return /^(list|get)/i.test(name) || EXTRA_READ_ACTIONS.has(name);
}

function envOrError(): { url: string; secret: string } | { error: string } {
  const url = process.env.APPS_SCRIPT_SYNC_URL;
  const secret = process.env.APPS_SCRIPT_SYNC_SECRET;
  if (!url || !secret) {
    return { error: "APPS_SCRIPT_SYNC_URL / APPS_SCRIPT_SYNC_SECRET are not set." };
  }
  return { url, secret };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the Apps Script web app. Never throws.
 *
 * On success: `{ data, status: 200 }` — `data` is the parsed body, including the
 * script's own `ok` field, which the caller still has to check. On failure:
 * `{ error, status }` with 400 for missing config and 502 for anything else.
 */
export async function callAppsScript<T = unknown>(
  payload: Record<string, unknown>,
  opts: AppsScriptOptions = {},
): Promise<AppsScriptResult<T>> {
  const env = envOrError();
  if ("error" in env) return { error: env.error, status: 400 };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const mayRetry = opts.retry ?? isRetryable(payload.action);
  const deadline = Date.now() + timeoutMs;
  const body = JSON.stringify({ ...payload, secret: env.secret });

  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= (mayRetry ? MAX_ATTEMPTS : 1); attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { error: `Apps Script timed out after ${timeoutMs}ms.`, status: 504 };
    }

    try {
      const res = await fetch(env.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        redirect: "follow",
        signal: AbortSignal.timeout(remaining),
      });
      const text = await res.text();

      // A retryable status means the request never reached the script.
      if (RETRYABLE_STATUS.has(res.status)) {
        lastError = `Apps Script unavailable (HTTP ${res.status}): ${text.slice(0, 300)}`;
        if (mayRetry && attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_MS[attempt - 1] ?? 1_200);
          continue;
        }
        return { error: lastError, status: 502 };
      }

      try {
        return { data: JSON.parse(text) as T, status: 200 };
      } catch {
        // Non-JSON is usually Google's HTML sign-in or error page. Not retried:
        // it means the deployment is misconfigured, and repeating won't help.
        return {
          error: `Apps Script returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
          status: 502,
        };
      }
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      lastError = timedOut
        ? `Apps Script timed out after ${timeoutMs}ms.`
        : e instanceof Error
          ? e.message
          : "Unknown error";
      // A timeout has already consumed the whole budget — retrying cannot help.
      if (timedOut) return { error: lastError, status: 504 };
      if (mayRetry && attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS[attempt - 1] ?? 1_200);
        continue;
      }
      return { error: lastError, status: 502 };
    }
  }

  return { error: lastError, status: 502 };
}

/**
 * Same call, answered straight back to the browser. For routes that do nothing
 * with the body but forward it.
 */
export async function callAppsScriptResponse(
  payload: Record<string, unknown>,
  opts: AppsScriptOptions = {},
): Promise<NextResponse> {
  const r = await callAppsScript(payload, opts);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}

/**
 * Throwing variant, for routes that compose several calls inside one try/catch.
 *
 * Also throws when the script itself reports `ok: false`, which the other two
 * variants leave to the caller — that difference is deliberate and matches what
 * the Sunset-statement routes already did.
 */
export async function callAppsScriptOrThrow<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
  opts: AppsScriptOptions = {},
): Promise<T> {
  const r = await callAppsScript<T>(payload, opts);
  if (r.error) throw new Error(r.error);
  const json = r.data as { ok?: boolean; error?: unknown };
  if (json && json.ok === false) {
    throw new Error(String(json.error ?? "Apps Script reported an error."));
  }
  return r.data as T;
}

/**
 * Fire-and-forget nudge at the hourly JT→sheet/Drive sync, used right after
 * creating bills so they mirror in seconds instead of at the top of the hour.
 *
 * Best-effort by design: it must NEVER affect the caller's result. Missing env,
 * a network failure, a non-JSON body — all just mean "not kicked", and the
 * hourly `runFullJtSync` remains the backstop. Sends queued mode (no `wait`), so
 * it returns in about a second.
 */
export async function kickJtSync(): Promise<boolean> {
  // Short budget and no retry: this is a nudge, not the job. Making the user
  // wait on it would be worse than letting the hourly run catch up.
  const r = await callAppsScript<{ ok?: boolean }>({}, { timeoutMs: 8_000, retry: false });
  return r.data?.ok === true;
}
