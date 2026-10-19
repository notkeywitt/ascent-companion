/**
 * WHAT CLAUDE COSTS — one row per call, priced when it is recorded.
 *
 * The API reports tokens on every response (`usage`) but no dollar figure, so
 * the price is worked out here from the model's published rates. Every place
 * the app calls Claude records its call through `trackClaudeUsage`, tagged with
 * a FEATURE ("invoice-review.summary", "bill-extract", "chat") so the total can
 * be split by what it was spent on.
 *
 * BEST-EFFORT BY CONTRACT. Recording never throws and is never awaited on a
 * hot path: a companion DB that is down must not cost the office a bill
 * extraction or a review. A lost row under-reports; it never breaks anything.
 *
 * The database is imported lazily, inside the write, so modules that only call
 * `trackClaudeUsage` (narrate.ts and friends) stay free of a database import at
 * load time — which is what keeps their unit tests database-free.
 */
import type Anthropic from "@anthropic-ai/sdk";

/** USD per million tokens. Anthropic list prices, first-party API, 2026-10. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Writing a prompt-cache entry (5-minute TTL): 1.25 × input. */
  cacheWrite: number;
  /** Reading from the prompt cache: 0.1 × input. */
  cacheRead: number;
}

const price = (input: number, output: number): ModelPrice => ({
  input,
  output,
  cacheWrite: input * 1.25,
  cacheRead: input * 0.1,
});

/**
 * Keyed by model id. A model missing here is still recorded — its tokens are
 * kept and its cost reads as unknown — so a new model id never hides spend,
 * it only asks for a row to be added.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5": price(2, 10),
  "claude-sonnet-5-5": price(2, 10),
  "claude-opus-5": price(5, 25),
  "claude-opus-5-5": price(4, 20),
  "claude-haiku-5-5": price(0.1, 0.5),
  "claude-haiku-4-5": price(1, 5),
  "claude-sonnet-4-6": price(3, 15),
  "claude-fable-5": price(10, 50),
  "claude-fable-5-1": price(10, 50),
};

/** Token counts in the shape every caller can produce from `message.usage`. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export function tokensOf(u: Anthropic.Usage | null | undefined): TokenUsage {
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
  };
}

/** Dollars for one call, or null when the model has no price on file. */
export function costOf(model: string, t: TokenUsage): number | null {
  const p = MODEL_PRICES[model.trim()];
  if (!p) return null;
  const usd =
    (t.input * p.input + t.output * p.output + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Record one Claude call. Fire and forget: returns at once, writes in the
 * background, swallows every error. `ref` ties the call to what it was for —
 * a billing month ("2026-09"), a bill id — so a feature's cost can be read per
 * thing as well as per month.
 */
export function trackClaudeUsage(
  feature: string,
  model: string,
  usage: Anthropic.Usage | TokenUsage | null | undefined,
  ref = "",
): void {
  if (process.env.VITEST) return; // unit tests never write usage rows
  const t: TokenUsage =
    usage && "input" in usage ? usage : tokensOf(usage as Anthropic.Usage | null | undefined);
  const cost = costOf(model, t);
  void (async () => {
    try {
      const { rawDb, ensureDb } = await import("@/db");
      await ensureDb();
      await rawDb().execute({
        sql: `INSERT INTO ai_usage
                (at, feature, model, ref, input_tokens, output_tokens,
                 cache_write_tokens, cache_read_tokens, cost_usd)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          new Date().toISOString(),
          feature,
          model,
          ref,
          t.input,
          t.output,
          t.cacheWrite,
          t.cacheRead,
          cost,
        ],
      });
    } catch (e) {
      console.error(`[ai-usage] could not record ${feature}: ${e instanceof Error ? e.message : e}`);
    }
  })();
}

/** One feature's spend in one calendar month. */
export interface UsageRow {
  /** "YYYY-MM", UTC. */
  month: string;
  feature: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Dollars across the calls that had a price. */
  costUsd: number;
  /** Calls whose model had no price on file — their cost is not in `costUsd`. */
  unpriced: number;
}

/** Spend by month and feature, newest month first. Empty on any failure. */
export async function readUsageByMonth(months = 12): Promise<UsageRow[]> {
  try {
    const { rawDb, ensureDb } = await import("@/db");
    await ensureDb();
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - (months - 1), 1);
    const r = await rawDb().execute({
      sql: `SELECT substr(at, 1, 7) AS month, feature,
                   COUNT(*) AS calls,
                   SUM(input_tokens + cache_write_tokens + cache_read_tokens) AS input_tokens,
                   SUM(output_tokens) AS output_tokens,
                   SUM(COALESCE(cost_usd, 0)) AS cost_usd,
                   SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
            FROM ai_usage
            WHERE at >= ?
            GROUP BY month, feature
            ORDER BY month DESC, cost_usd DESC`,
      args: [since.toISOString().slice(0, 7)],
    });
    return r.rows.map((row) => ({
      month: String(row.month),
      feature: String(row.feature),
      calls: Number(row.calls) || 0,
      inputTokens: Number(row.input_tokens) || 0,
      outputTokens: Number(row.output_tokens) || 0,
      costUsd: Number(row.cost_usd) || 0,
      unpriced: Number(row.unpriced) || 0,
    }));
  } catch {
    return [];
  }
}

/** Total dollars recorded for one feature + ref (e.g. the review of "2026-09"). */
export async function readUsageForRef(featurePrefix: string, ref: string): Promise<{ calls: number; costUsd: number }> {
  try {
    const { rawDb, ensureDb } = await import("@/db");
    await ensureDb();
    const r = await rawDb().execute({
      sql: `SELECT COUNT(*) AS calls, SUM(COALESCE(cost_usd, 0)) AS cost_usd
            FROM ai_usage WHERE feature LIKE ? AND ref = ?`,
      args: [`${featurePrefix}%`, ref],
    });
    return { calls: Number(r.rows[0]?.calls) || 0, costUsd: Number(r.rows[0]?.cost_usd) || 0 };
  } catch {
    return { calls: 0, costUsd: 0 };
  }
}
