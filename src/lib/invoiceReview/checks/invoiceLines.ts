/**
 * EVERY DOLLAR ON THE INVOICE TRACES TO A BILL, A TIME ENTRY OR A DEPOSIT.
 *
 * Built from three Berger lines nobody could explain:
 *   - January 2026 (#2600-284): a $63.36 first line that "doesn't match our
 *     records". Never resolved.
 *   - October 2026 (Main House #26-25): a −$3,572.27 line. The invoice was
 *     rebuilt; the cause is unknown.
 *   - October 2026 (Main House #26-25): a $1,500 line described only "00 00 00".
 *
 * cost-basis compares the invoice's TOTAL cost with the month, and only in one
 * direction. A hand-typed credit lowers the total and passes; a hand-typed
 * charge on a busy month hides inside it. This reconciles CODE BY CODE.
 *
 * HOW. JobTread copies a bill line onto the invoice at the line's own cost.
 * Time it MERGES: one invoice line per cost code per day, summed across the
 * crew (Berger #379: 01 31 10, $850 = Seth $637.50 + Ty $212.50 on 9/16), at
 * the rate in force when the invoice is built (costBasis.ts). Invoice lines
 * carry no link back to their source (`sourceCostItem` is null — probed on
 * #379, 2026-10-19), so the match is by code and cost, with time grouped by
 * code and day first:
 *
 *   1. Pair each invoice line with one source on the same code at the same cost.
 *   2. What is left on a code — lines and sources both — is compared as sums,
 *      so an invoice that consolidates several entries into one line still
 *      reconciles.
 *   3. A code whose leftover invoice cost exceeds its leftover sources is
 *      UNSOURCED. One whose sources exceed the invoice is SHORT.
 *
 * A priced line with NO cost is reported on its own: it is invisible to any
 * cost sum, and it is the shape of a line typed by hand.
 *
 * Dry-run on live data 2026-10-19: Berger #379 (225 lines, 55 bills, 138 time
 * entries) and Main House #25 reconcile on every code with no finding.
 *
 * QUIET WHEN IT CANNOT KNOW. Sources not read (`billSources` or `timeSources`
 * undefined) means nothing is said. An invoice whose lines miss on many codes at once was most
 * likely rebuilt from a voided invoice whose bill links stayed behind, so it
 * gets ONE finding naming the codes, not one per code.
 */
import { isSalesTaxLine } from "@/lib/salesTax";
import { defineInvoiceCheck } from "../checkTypes";
import {
  cents,
  findingKey,
  money,
  type Finding,
  type InvoiceLine,
  type InvoiceSourceItem,
  type InvoiceTimeSource,
  type MonthEvidence,
} from "../types";
import { isDepositLine } from "./shared";

export interface InvoiceLinesConfig {
  /** A code's gap below this is rounding between two systems, not a line. */
  minGap: number;
  /** A no-cost line priced below this is not worth a finding. */
  minNoCostPrice: number;
  /** Report codes whose sources exceed the invoice (a line removed or cut). */
  reportShort: boolean;
  /** More codes than this out at once collapse into one finding. */
  maxCodesBeforeSummary: number;
}

interface CodeGap {
  code: string;
  gap: number;
  lines: InvoiceLine[];
}

const lineLabel = (l: InvoiceLine) => `${l.name || l.description || "Unnamed line"} (${money(l.cost)})`;

/** Step 1 and 2 above, for one code. Returns the leftover gap and lines. */
export function reconcileCode(
  lines: InvoiceLine[],
  sources: InvoiceSourceItem[],
  tolerance: number,
): { gap: number; leftoverLines: InvoiceLine[] } {
  const open = [...sources];
  const leftoverLines: InvoiceLine[] = [];
  const byMagnitude = [...lines].sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost));
  for (const l of byMagnitude) {
    const i = open.findIndex((s) => s.costs.some((c) => Math.abs(c - l.cost) <= tolerance));
    if (i >= 0) open.splice(i, 1);
    else leftoverLines.push(l);
  }
  const lineSum = leftoverLines.reduce((s, l) => s + l.cost, 0);
  // A leftover source is valued at its LAST cost: today's rate for time,
  // which is what a consolidated invoice line would have used.
  const sourceSum = open.reduce((s, x) => s + x.costs[x.costs.length - 1], 0);
  return { gap: cents(lineSum - sourceSum), leftoverLines };
}

/**
 * An invoice's time as JobTread bills it: one source per cost code per day.
 * Two candidate costs — the entries' stored cost, and hours × today's rate
 * when every entry in the group has one.
 */
export function timeSourcesByDay(
  time: InvoiceTimeSource[],
  laborRates: MonthEvidence["laborRates"],
): InvoiceSourceItem[] {
  const groups = new Map<string, InvoiceTimeSource[]>();
  for (const t of time) {
    const k = `${t.code}|${t.day}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()].map(([k, entries]) => {
    const stored = cents(entries.reduce((s, t) => s + t.cost, 0));
    const current = entries.map((t) => laborRates?.get(t.employee)?.get(t.payType));
    const costs = [stored];
    if (current.every((r) => typeof r === "number")) {
      costs.push(cents(entries.reduce((s, t, i) => s + (current[i] as number) * t.hours, 0)));
    }
    return { kind: "time" as const, sourceId: k, code: entries[0].code, costs };
  });
}

export const invoiceLinesCheck = defineInvoiceCheck<InvoiceLinesConfig>({
  id: "invoice-lines",
  title: "Invoice lines without a source",
  description:
    "Every invoice line traces to a bill, a time entry or a deposit, code by code.",
  kinds: ["invoice-line-unsourced", "invoice-line-short", "invoice-line-no-cost"],
  scope: "invoice",
  run({ job, month, invoice: inv, config, global }) {
    const out: Finding[] = [];
    const base = {
      jobId: job.jobId,
      jobName: job.jobName,
      customerName: job.customerName,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      sourceLink: inv.jtUrl,
      sourceLabel: "Open in JobTread",
    };
    const invLabel = `Invoice #${inv.number || inv.id}`;
    const billable = inv.lines.filter((l) => !isDepositLine(l) && !isSalesTaxLine(l));

    // ── A priced line with no cost behind it ─────────────────────────────────
    for (const l of billable) {
      if (Math.abs(l.cost) > global.tolerance) continue;
      if (Math.abs(l.price) < config.minNoCostPrice) continue;
      out.push({
        ...base,
        key: findingKey("invoice-line-no-cost", job.jobId, `${inv.id}|${l.code}|${l.name}`),
        kind: "invoice-line-no-cost",
        severity: "warning",
        title: `${invLabel} — ${money(l.price)} line with no cost behind it`,
        detail:
          `"${l.name || l.description || "Unnamed line"}"${l.code ? ` on ${l.code}` : ""} bills ` +
          `${money(l.price)} but carries no cost, so no bill or time entry stands behind it. ` +
          `That is the shape of a line typed by hand. If it is a credit or an agreed charge, ` +
          `give it a description the client can read (what it is for, and which document ` +
          `backs it); otherwise remove it.`,
        amount: Math.abs(l.price),
      });
    }

    // ── Code by code ─────────────────────────────────────────────────────────
    if (!inv.billSources || !inv.timeSources) return out; // sources could not be read
    const sources = [...inv.billSources, ...timeSourcesByDay(inv.timeSources, month.laborRates)];

    const codes = new Set<string>([
      ...billable.filter((l) => Math.abs(l.cost) > global.tolerance).map((l) => l.code),
      ...sources.map((s) => s.code),
    ]);
    const gaps: CodeGap[] = [];
    for (const code of codes) {
      const lines = billable.filter((l) => l.code === code && Math.abs(l.cost) > global.tolerance);
      const { gap, leftoverLines } = reconcileCode(
        lines,
        sources.filter((s) => s.code === code),
        global.tolerance,
      );
      if (Math.abs(gap) < config.minGap) continue;
      if (gap < 0 && !config.reportShort) continue;
      gaps.push({ code: code || "(uncoded)", gap, lines: leftoverLines });
    }
    if (!gaps.length) return out;

    if (gaps.length > config.maxCodesBeforeSummary) {
      const net = cents(gaps.reduce((s, g) => s + g.gap, 0));
      out.push({
        ...base,
        key: findingKey("invoice-line-unsourced", job.jobId, `${inv.id}|summary`),
        kind: "invoice-line-unsourced",
        severity: "warning",
        title: `${invLabel} — lines do not reconcile on ${gaps.length} cost codes`,
        detail:
          `On ${gaps.map((g) => `${g.code} (${g.gap > 0 ? "+" : ""}${money(g.gap)})`).join(", ")} ` +
          `the invoice's cost does not match the bills and time entries it references ` +
          `(net ${money(net)}). When this many codes miss at once, the invoice was usually ` +
          `rebuilt from a voided one and the bill links stayed with the old invoice. Check ` +
          `that it references the bills it bills, then re-run the review.`,
        amount: Math.abs(net),
      });
      return out;
    }

    for (const g of gaps) {
      if (g.gap > 0) {
        out.push({
          ...base,
          key: findingKey("invoice-line-unsourced", job.jobId, `${inv.id}|${g.code}`),
          kind: "invoice-line-unsourced",
          severity: "warning",
          title: `${invLabel} — ${money(g.gap)} on ${g.code} with no bill or time behind it`,
          detail:
            `The invoice carries ${money(g.gap)} more cost on ${g.code} than the bills it ` +
            `references and the time entries on it account for.` +
            (g.lines.length
              ? ` Unmatched line${g.lines.length === 1 ? "" : "s"}: ${g.lines.map(lineLabel).join("; ")}.`
              : "") +
            ` Find the document behind it, or remove it.`,
          amount: g.gap,
        });
      } else {
        out.push({
          ...base,
          key: findingKey("invoice-line-short", job.jobId, `${inv.id}|${g.code}`),
          kind: "invoice-line-short",
          severity: "warning",
          title: `${invLabel} — ${money(-g.gap)} on ${g.code} referenced but not billed`,
          detail:
            `The bills and time entries this invoice references carry ${money(-g.gap)} more ` +
            `on ${g.code} than the invoice bills.` +
            (g.lines.length
              ? ` Lines on the code that match nothing: ${g.lines.map(lineLabel).join("; ")}.`
              : "") +
            ` Either a line was removed or cut after the invoice was built, or a negative ` +
            `line was typed against it. Either way the invoice and its backup no longer ` +
            `agree — and that is exactly what a client checking the folder will ask about.`,
          amount: -g.gap,
        });
      }
    }
    return out;
  },
});
