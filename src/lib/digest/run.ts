/**
 * THE AGGREGATOR — runs the registry, summarizes it once, stores the result.
 *
 * This file knows nothing about any individual check. It loops the enabled ones,
 * runs each in isolation, collects the structured results, builds the brief
 * from them locally, and writes the whole thing to the `daily_digest` row for
 * today.
 * Adding, removing or reordering checks does not touch this file — that is the
 * point of the registry.
 *
 * ── ISOLATION IS THE CONTRACT ───────────────────────────────────────────────
 * A check that throws, hangs, or finds its data source unreachable becomes ONE
 * entry with `status: "error"` and a short reason. It never takes the digest
 * with it. The morning report is most valuable exactly when something is
 * broken, so "one source is down" must never render as a blank screen. Each
 * check also gets a hard timeout (`checkTimeoutMs`), because "unreachable"
 * frequently presents as "never answers" rather than as an exception.
 *
 * ── READ-ONLY, END TO END ───────────────────────────────────────────────────
 * Every check reads. Nothing here writes to Gmail, Calendar, Drive, the Sheet
 * or JobTread. The only things this feature writes are its own `daily_digest`
 * row and the `digest_dismissals` rows the Dismiss button makes — both in the
 * companion database.
 */
import { companyDateParts } from "@/lib/billing";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { CHECKS } from "./registry";
import { resolveChecks } from "./overrides";
import { applyDismissals } from "./dismissals";
import { getInstructionTexts } from "./instructions";
import { DIGEST_GLOBAL } from "./settings";
import { readActiveDismissals, saveDigest } from "./store";
import type { DigestCheck, DigestPayload, StoredCheckResult } from "./types";

/** YYYY-MM-DD in the company timezone — the digest's date key. */
export function digestDateKey(now: Date = new Date()): string {
  const { year, month, day } = companyDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Reject after `ms`, so a hung data source can't hold the whole run. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Trim a thrown value to a short line a human can read on a phone. */
function reasonOf(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.length > 200 ? `${raw.slice(0, 197)}…` : raw;
}

/**
 * Run every enabled check and build the payload. Does NOT store — `runDigest`
 * does that — so this half is directly testable and reusable for a dry run.
 *
 * `allChecks` defaults to the static `CHECKS` (settings.ts only, no DB) so
 * every existing caller — including the isolation test below — is unaffected.
 * `runDigest` is the one real caller that passes the live, override-aware
 * list from `resolveChecks()`, plus the office's dismissals.
 *
 * `dismissed` is the set of item keys the office has marked handled (see
 * dismissals.ts). They are taken out BEFORE the summary is written, so the
 * brief never counts something the office already dealt with.
 */
export async function computeDigest(
  now: Date = new Date(),
  allChecks: DigestCheck<never>[] = CHECKS,
  instructions: string[] = [],
  dismissed: ReadonlySet<string> = new Set(),
): Promise<DigestPayload> {
  const startedAt = Date.now();
  const today = digestDateKey(now);
  const pave = hasGrant() ? getPaveConfig() : null;
  const log: string[] = [];
  const stamp = (msg: string) => log.push(`[${new Date().toISOString()}] ${msg}`);

  const checks = allChecks.filter((c) => c.enabled);
  const off = allChecks.filter((c) => !c.enabled).map((c) => c.id);
  stamp(`digest ${today}: running ${checks.length} check(s)${off.length ? `; disabled: ${off.join(", ")}` : ""}`);
  if (!pave) stamp("JT_GRANT_KEY is not set — JobTread-backed checks will report an error");
  if (instructions.length)
    stamp(`${instructions.length} standing instruction(s) on file — the brief is a plain item list and does not read them`);

  let results: StoredCheckResult[] = [];
  for (const check of checks) {
    const checkStart = Date.now();
    stamp(`→ ${check.id} started`);
    try {
      const result = await withTimeout(
        check.run({
          config: check.config,
          settings: DIGEST_GLOBAL,
          now,
          today,
          pave,
          log: (m) => stamp(`   ${check.id}: ${m}`),
        }),
        DIGEST_GLOBAL.checkTimeoutMs,
        check.id,
      );
      const items = result.items.slice(0, DIGEST_GLOBAL.maxItemsPerCheck);
      if (items.length < result.items.length) {
        stamp(`   ${check.id}: ${result.items.length - items.length} item(s) trimmed at the per-check cap`);
      }
      results.push({
        id: check.id,
        title: check.title,
        category: check.category,
        status: result.status,
        summary: result.summary,
        items,
        durationMs: Date.now() - checkStart,
      });
      stamp(`← ${check.id} ${result.status} (${items.length} item(s), ${Date.now() - checkStart}ms)`);
    } catch (e) {
      const error = reasonOf(e);
      results.push({
        id: check.id,
        title: check.title,
        category: check.category,
        status: "error",
        summary: `Couldn't run this check: ${error}`,
        items: [],
        durationMs: Date.now() - checkStart,
        error,
      });
      stamp(`← ${check.id} ERROR (${Date.now() - checkStart}ms): ${error}`);
    }
  }

  if (dismissed.size > 0) {
    const before = results.reduce((n, r) => n + r.items.length, 0);
    results = applyDismissals(results, dismissed);
    const after = results.reduce((n, r) => n + r.items.length, 0);
    stamp(`${before - after} item(s) hidden by ${dismissed.size} dismissal(s)`);
  }

  const errored = results.filter((r) => r.status === "error").length;
  const status: DigestPayload["status"] =
    results.length > 0 && errored === results.length ? "error" : errored > 0 ? "partial" : "ok";

  // The brief is built locally from the check results — no model call. A
  // Claude-written paragraph used to sit here; it was dropped 2026-09-04
  // because the owner reads the item list, not the prose (and it cost tokens
  // every morning). `summarySource` stays on the payload only because the
  // stored column is NOT NULL and old rows still carry "claude".
  const summary = fallbackSummary(results);
  const summarySource: DigestPayload["summarySource"] = "fallback";

  const payload: DigestPayload = {
    date: today,
    generatedAt: new Date().toISOString(),
    status,
    summary,
    summarySource,
    results,
    durationMs: Date.now() - startedAt,
    log,
  };
  stamp(`digest ${today} finished: ${status} in ${payload.durationMs}ms`);
  return payload;
}

/**
 * THE BRIEF. Built here, from the check results, with no model call.
 *
 * Deliberately plain and mechanical — a count and one bullet per flagged check,
 * which is what the owner actually reads. It never claims all-clear when a
 * check errored.
 *
 * Topic blocks separated by a blank line, per-check detail as "- " bullet
 * lines, read back by `parseSummary` (src/lib/digest/summary.ts).
 */
export function fallbackSummary(results: StoredCheckResult[]): string {
  const flagged = results.filter((r) => r.status === "warning");
  const errored = results.filter((r) => r.status === "error");
  const blocks: string[] = [];
  if (flagged.length === 0 && errored.length === 0) {
    blocks.push("All checks are clear this morning.");
  } else if (flagged.length > 0) {
    const total = flagged.reduce((s, r) => s + r.items.length, 0);
    // Lead line, then one bullet per flagged check — the check's own one-line
    // summary, which is already written to stand alone.
    blocks.push(
      `${total} item${total === 1 ? "" : "s"} need attention across ${flagged.length} check${flagged.length === 1 ? "" : "s"}:\n` +
        flagged.map((r) => `- ${r.title}: ${r.summary}`).join("\n"),
    );
  }
  if (errored.length > 0) {
    blocks.push(
      `${errored.length} check${errored.length === 1 ? "" : "s"} couldn't be run:\n` +
        errored.map((r) => `- ${r.title}`).join("\n"),
    );
  }
  // A blank line between blocks is what the parser splits topics on.
  return blocks.join("\n\n");
}

/**
 * Run every enabled check and store the result as today's digest.
 *
 * The one real caller: reads live settings (defaults + any /admin overrides)
 * fresh via `resolveChecks()`, so a settings change takes effect on the very
 * next run with no redeploy.
 */
export async function runDigest(now: Date = new Date()): Promise<DigestPayload> {
  const [checks, instructions, dismissed] = await Promise.all([
    resolveChecks(),
    getInstructionTexts(),
    readActiveDismissals(),
  ]);
  const payload = await computeDigest(now, checks, instructions, dismissed);
  await saveDigest(payload);
  return payload;
}
