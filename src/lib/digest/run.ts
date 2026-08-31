/**
 * THE AGGREGATOR — runs the registry, summarizes it once, stores the result.
 *
 * This file knows nothing about any individual check. It loops the enabled ones,
 * runs each in isolation, collects the structured results, asks Gemini for one
 * paragraph, and writes the whole thing to the `daily_digest` row for today.
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
 * or JobTread. The ONLY thing this feature writes is its own `daily_digest` row
 * in the companion database.
 */
import { companyDateParts } from "@/lib/billing";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { summarizeDigestWithGemini } from "@/lib/gemini";
import { enabledChecks, disabledCheckIds } from "./registry";
import { DIGEST_GLOBAL } from "./settings";
import { saveDigest } from "./store";
import type { DigestPayload, StoredCheckResult } from "./types";

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
 */
export async function computeDigest(now: Date = new Date()): Promise<DigestPayload> {
  const startedAt = Date.now();
  const today = digestDateKey(now);
  const pave = hasGrant() ? getPaveConfig() : null;
  const log: string[] = [];
  const stamp = (msg: string) => log.push(`[${new Date().toISOString()}] ${msg}`);

  const checks = enabledChecks();
  const off = disabledCheckIds();
  stamp(`digest ${today}: running ${checks.length} check(s)${off.length ? `; disabled: ${off.join(", ")}` : ""}`);
  if (!pave) stamp("JT_GRANT_KEY is not set — JobTread-backed checks will report an error");

  const results: StoredCheckResult[] = [];
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

  const errored = results.filter((r) => r.status === "error").length;
  const status: DigestPayload["status"] =
    results.length > 0 && errored === results.length ? "error" : errored > 0 ? "partial" : "ok";

  // ONE Gemini call, over the structured results only — never the raw source
  // data the checks read (see summarizeDigestWithGemini).
  let summary = "";
  let summarySource: DigestPayload["summarySource"] = "fallback";
  try {
    const generated = await summarizeDigestWithGemini(
      results.map((r) => ({
        check: r.title,
        category: r.category,
        status: r.status,
        summary: r.summary,
        itemCount: r.items.length,
        topItems: r.items.slice(0, 5).map((i) => ({ title: i.title, amount: i.amount, date: i.date })),
      })),
    );
    if (generated) {
      summary = generated;
      summarySource = "gemini";
      stamp("summary written by Gemini");
    } else {
      stamp("Gemini unavailable — using the built-in summary");
    }
  } catch (e) {
    stamp(`Gemini summary failed (${reasonOf(e)}) — using the built-in summary`);
  }
  if (!summary) summary = fallbackSummary(results);

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
 * The paragraph shown when Gemini is unconfigured or unreachable.
 *
 * Deliberately plain and mechanical — its job is to keep the digest useful, not
 * to imitate the model. It never claims all-clear when a check errored.
 */
export function fallbackSummary(results: StoredCheckResult[]): string {
  const flagged = results.filter((r) => r.status === "warning");
  const errored = results.filter((r) => r.status === "error");
  const parts: string[] = [];
  if (flagged.length === 0 && errored.length === 0) {
    parts.push("All checks are clear this morning.");
  } else if (flagged.length > 0) {
    const total = flagged.reduce((s, r) => s + r.items.length, 0);
    parts.push(
      `${total} item${total === 1 ? "" : "s"} need attention across ${flagged.length} check${flagged.length === 1 ? "" : "s"}: ` +
        flagged.map((r) => r.summary).join(" "),
    );
  }
  if (errored.length > 0) {
    parts.push(
      `${errored.length} check${errored.length === 1 ? "" : "s"} couldn't be run (${errored.map((r) => r.title).join(", ")}).`,
    );
  }
  return parts.join(" ");
}

/** Run every enabled check and store the result as today's digest. */
export async function runDigest(now: Date = new Date()): Promise<DigestPayload> {
  const payload = await computeDigest(now);
  await saveDigest(payload);
  return payload;
}
