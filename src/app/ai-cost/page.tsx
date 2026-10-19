"use client";

import { useEffect, useState } from "react";

import { PageTabs, AUDIT_TABS } from "@/components/PageTabs";
import {
  Banner,
  Card,
  EmptyState,
  Loading,
  PageHeader,
  SectionHeading,
  StatementBlock,
  tableCls,
} from "@/components/ui";

/**
 * AI COST — what the app's Claude calls have cost, by month and by feature.
 *
 * Every Claude call is recorded and priced as it happens (src/lib/aiUsage.ts).
 * The Apps Script invoice reader logs its own calls (AiUsage.js there) and the
 * route merges them in, priced with the same table.
 */

interface UsageRow {
  month: string;
  feature: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpriced: number;
}

/** Plain names for the feature tags the code records. */
const FEATURE_LABELS: Record<string, string> = {
  "invoice-review.summary": "Checks — summary",
  "invoice-review.investigate": "Checks — investigate",
  "invoice-review.learn": "Checks — suggest checks",
  "digest.email-signals": "Daily digest — email",
  "digest.reply": "Daily digest — replies",
  "bill-extract": "Add bill — read the invoice",
  "amazon-import": "Amazon import",
  "spec-list": "Specifications",
  "tool-serial-ocr": "Tools — serial number",
  chat: "Assistant chat",
  "invoice-reader.expenditure": "Invoice reader — emailed invoices",
  "invoice-reader.sunsetInvoiceDetailsText": "Invoice reader — Sunset invoices",
  "invoice-reader.statementLineItems": "Invoice reader — Sunset statements",
  "invoice-reader.statementPaymentHeader": "Invoice reader — statement payments",
  "invoice-reader.enrichElectrical": "Invoice reader — electrical items",
  "invoice-reader.sunsetProjectName": "Invoice reader — Sunset project",
  "invoice-reader.soldToDump": "Invoice reader — LSWDD statement",
  "invoice-reader.other": "Invoice reader — other",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

function usd(n: number): string {
  if (n === 0) return "$0";
  return n < 1 ? `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}¢` : `$${n.toFixed(2)}`;
}

const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(n);

export default function AiCostPage() {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [readerNote, setReaderNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/ai-usage")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { rows: UsageRow[]; readerNote?: string };
      })
      .then((d) => {
        setRows(d.rows);
        setReaderNote(d.readerNote ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const months = rows ? [...new Set(rows.map((r) => r.month))] : [];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthTotal = (m: string) => (rows ?? []).filter((r) => r.month === m).reduce((s, r) => s + r.costUsd, 0);
  const unpriced = (rows ?? []).reduce((s, r) => s + r.unpriced, 0);

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 py-6">
      <PageTabs tabs={AUDIT_TABS} />
      <PageHeader
        title="AI cost"
        description="What the Assistant's Claude calls have cost, by month and by feature. Priced from Anthropic's list rates as each call is made."
      />

      {error ? <Banner tone="error">Could not load the usage log — {error}</Banner> : null}
      {!rows && !error ? <Loading label="Reading the usage log…" /> : null}

      {rows ? (
        rows.length === 0 ? (
          <EmptyState>No Claude calls recorded yet. Calls are recorded from Oct 19, 2026 on.</EmptyState>
        ) : (
          <>
            <StatementBlock
              label={`This month — ${monthLabel(thisMonth)}`}
              value={usd(monthTotal(thisMonth))}
              sub={`${(rows ?? []).filter((r) => r.month === thisMonth).reduce((s, r) => s + r.calls, 0)} calls`}
              footnote="Includes the Apps Script invoice reader, logged from Oct 19, 2026."
            />
            {readerNote ? (
              <Banner tone="warning" className="mt-4">
                {readerNote}
              </Banner>
            ) : null}
            {unpriced ? (
              <Banner tone="warning" className="mt-4">
                {unpriced} call{unpriced === 1 ? "" : "s"} used a model with no price on file, so
                {unpriced === 1 ? " its" : " their"} cost is missing from the totals. Add the model to
                MODEL_PRICES in src/lib/aiUsage.ts.
              </Banner>
            ) : null}
            {months.map((m) => (
              <section key={m} className="mt-6">
                <SectionHeading trailing={usd(monthTotal(m))}>{monthLabel(m)}</SectionHeading>
                <Card pad={false} className="overflow-x-auto">
                  <table className={tableCls.root}>
                    <thead>
                      <tr>
                        <th className={tableCls.th}>Feature</th>
                        <th className={tableCls.thNum}>Calls</th>
                        <th className={tableCls.thNum}>Tokens in / out</th>
                        <th className={tableCls.thNum}>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .filter((r) => r.month === m)
                        .map((r) => (
                          <tr key={r.feature} className={tableCls.tr}>
                            <td className={tableCls.td}>{FEATURE_LABELS[r.feature] ?? r.feature}</td>
                            <td className={tableCls.tdNum}>{r.calls}</td>
                            <td className={tableCls.tdNum}>
                              {tokens(r.inputTokens)} / {tokens(r.outputTokens)}
                            </td>
                            <td className={tableCls.tdNum}>{usd(r.costUsd)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </Card>
              </section>
            ))}
          </>
        )
      ) : null}
    </main>
  );
}
