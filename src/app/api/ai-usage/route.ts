import { NextResponse } from "next/server";

import { costOf, readUsageByMonth, type UsageRow } from "@/lib/aiUsage";
import { callAppsScript } from "@/lib/appsScript";

/**
 * GET /api/ai-usage — what Claude has cost, by month and feature, last 12 months.
 *
 * Two sources, merged: the Assistant's own calls (table `ai_usage`) and the
 * Apps Script invoice reader's (its "AI_Usage" tab, via WebApp action
 * `aiUsage`, which returns tokens only — priced here, with the one price
 * table). If Apps Script cannot be reached the page still shows the
 * Assistant's figures, and says the reader's are missing.
 *
 * Read-only. Gated by the "ai-cost" view (admin by default).
 */
export const dynamic = "force-dynamic";

interface ReaderRow {
  month: string;
  feature: string;
  model: string;
  calls: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export async function GET() {
  const [own, reader] = await Promise.all([
    readUsageByMonth(12),
    callAppsScript<{ ok?: boolean; error?: string; rows?: ReaderRow[] }>(
      { action: "aiUsage", months: 12 },
      { timeoutMs: 30_000 },
    ),
  ]);

  let readerNote = "";
  const merged = new Map<string, UsageRow>();
  for (const r of own) merged.set(`${r.month}|${r.feature}`, r);

  const data = reader.data;
  if (reader.error || data?.ok === false) {
    readerNote = `The invoice reader's figures could not be read — ${reader.error ?? data?.error ?? "unknown error"}.`;
  } else {
    for (const r of data?.rows ?? []) {
      const feature = `invoice-reader.${r.feature}`;
      const cost = costOf(r.model, {
        input: r.input,
        output: r.output,
        cacheWrite: r.cacheWrite,
        cacheRead: r.cacheRead,
      });
      const key = `${r.month}|${feature}`;
      const row = merged.get(key) ?? {
        month: r.month,
        feature,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        unpriced: 0,
      };
      row.calls += r.calls;
      row.inputTokens += r.input + r.cacheWrite + r.cacheRead;
      row.outputTokens += r.output;
      if (cost === null) row.unpriced += r.calls;
      else row.costUsd += cost;
      merged.set(key, row);
    }
  }

  const rows = [...merged.values()].sort(
    (a, b) => b.month.localeCompare(a.month) || b.costUsd - a.costUsd,
  );
  return NextResponse.json({ rows, readerNote });
}
