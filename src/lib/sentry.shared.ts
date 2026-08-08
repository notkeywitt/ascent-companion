/**
 * One place deciding whether error reporting is on, and what it is allowed to
 * send. Imported by every Sentry entry point (server, edge, client).
 *
 * ## Inert without a DSN — on purpose
 *
 * `SENTRY_DSN` unset means every init below is skipped and the SDK does nothing.
 * That is the normal state for local dev, for CI, and for anyone who clones the
 * repo without a Sentry account, and it must stay a supported configuration —
 * the build and the app work identically with or without it. Nothing here may
 * throw or block when the DSN is missing.
 *
 * ## What must never leave this app
 *
 * The whole point of the server-only boundary is that `JT_GRANT_KEY` and
 * `APPS_SCRIPT_SYNC_SECRET` never escape. An error reporter is a new way for
 * them to escape, so:
 *   - `sendDefaultPii` stays FALSE (no cookies, no headers, no request bodies),
 *   - `beforeSend` redacts anything that looks like a secret from the message,
 *   - request payloads are never attached.
 *
 * Our own error strings quote up to 300 chars of an upstream response (see
 * appsScript.ts / jobtread.ts), which is business data, not credentials — but it
 * is still the reason the redaction below is a denylist over the message text
 * rather than a blanket trust in the SDK's defaults.
 */

/** The DSN is safe to expose (it is a write-only ingest endpoint), so the same
 *  value serves server and browser. Absent = reporting disabled. */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

export const sentryEnabled = Boolean(SENTRY_DSN);

/** Vercel gives us the deploy context; fall back to NODE_ENV locally. */
export const sentryEnvironment =
  process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

/**
 * Patterns that must never appear in a reported event. Matched against the
 * serialized message/exception text and replaced wholesale.
 *
 * These are belt-and-braces: none of these values is deliberately put into an
 * error message today. The point is that a future error string built by
 * interpolating a config object can't silently start leaking one.
 */
const REDACTIONS: { re: RegExp; label: string }[] = [
  // Pave grant keys and the Apps Script shared secret, if ever interpolated.
  { re: /"?grantKey"?\s*[:=]\s*"?[\w-]+"?/gi, label: '"grantKey":"[redacted]"' },
  { re: /"?secret"?\s*[:=]\s*"?[\w-]+"?/gi, label: '"secret":"[redacted]"' },
  { re: /"?authToken"?\s*[:=]\s*"?[\w-]+"?/gi, label: '"authToken":"[redacted]"' },
  // Bearer/API-key style headers.
  { re: /Bearer\s+[\w.\-]+/gi, label: "Bearer [redacted]" },
];

function scrub(text: string): string {
  let out = text;
  for (const { re, label } of REDACTIONS) out = out.replace(re, label);
  return out;
}

/**
 * Shared `beforeSend`. Redacts secrets from the message and exception values,
 * and drops the request body/cookies/headers the SDK may have attached.
 *
 * Typed loosely so this module stays importable from the edge runtime without
 * pulling in Sentry's types at the config sites.
 */
export function scrubEvent<T>(event: T): T {
  const e = event as {
    message?: unknown;
    exception?: { values?: { value?: unknown }[] };
    request?: { cookies?: unknown; headers?: unknown; data?: unknown };
  };

  if (typeof e.message === "string") e.message = scrub(e.message);

  const values = e.exception?.values;
  if (Array.isArray(values)) {
    for (const v of values) {
      if (v && typeof v.value === "string") v.value = scrub(v.value);
    }
  }

  // Belt and braces: sendDefaultPii is false, but never ship these even if a
  // future SDK default changes.
  if (e.request) {
    delete e.request.cookies;
    delete e.request.headers;
    delete e.request.data;
  }

  return event;
}

/** Options shared by every runtime's init. */
export const sentryBaseOptions = {
  dsn: SENTRY_DSN,
  environment: sentryEnvironment,
  // Never attach cookies, headers, request bodies, or user IP.
  sendDefaultPii: false,
  // This app is low-volume and the value here is ERRORS, not performance data.
  // Tracing off keeps both the quota and the client bundle's work minimal.
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
};
