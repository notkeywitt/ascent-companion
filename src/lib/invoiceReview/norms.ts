/**
 * WHAT NORMAL LOOKS LIKE — baselines learned from the review's own history.
 *
 * ## Why a review needs norms at all
 *
 * Every check written so far answers a question with a fixed answer: does this
 * multiply out, is this backed up, did this reach an invoice. None of them can
 * express the question the office actually asks when something feels off —
 * *"isn't there usually a Sunset bill on this job?"* That question has no fixed
 * answer. It can only be answered against what has been true for months.
 *
 * So this module reads the stored runs and works out what is usual. It adds no
 * new evidence gathering: everything here comes out of payloads the review has
 * already filed. That is Stage 0 paying for itself.
 *
 * ## Customer markup — the norm that only exists because rates differ
 *
 * Ascent charges DIFFERENT MARKUPS TO DIFFERENT CUSTOMERS. That single fact
 * rules out the obvious version of a margin check: there is no house rate to
 * measure an invoice against, so "is this marked up correctly" has no fixed
 * answer and never will. The only honest baseline is what this customer has
 * been billed for the last several months, which is precisely a learned norm.
 *
 * So the drift check could not have been written before the history existed —
 * not as a simplification, but at all.
 *
 * ## The other norm: vendor cadence
 *
 * For a cost-plus builder, essentially every vendor cost gets billed on. So a
 * vendor who invoices Ascent every single month and then doesn't is either a
 * genuinely quiet month or an invoice that never arrived — and the second case
 * is unbilled revenue that NOTHING else in the review can see. The mailbox
 * sweep only finds invoices that arrived and weren't captured; an invoice that
 * was never sent leaves no trace anywhere except in the shape of the past.
 *
 * ## What it is careful about
 *
 * A norm is only ever a REASON TO ASK. It never decides anything, and the check
 * it feeds is a warning, never an error. Two guards matter:
 *
 *   • Not enough history is not a weak signal, it is NO signal. Below
 *     `MIN_MONTHS` this module returns nothing rather than a confident-looking
 *     average over two data points.
 *   • The month being reviewed is EXCLUDED from its own baseline. Including it
 *     would let a quiet month talk itself into looking normal.
 */
import { desc, eq, ne } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { invoiceReviewRuns } from "@/db/schema";

import type { CustomerNorm, MonthEvidence, ReviewNorms, VendorNorm } from "./types";

/** Below this many months on record, there is no baseline — say nothing. */
export const MIN_MONTHS = 3;

/** How far back a baseline looks. Long enough to be a pattern, short enough
 *  that a vendor Ascent stopped using two years ago doesn't haunt it. */
export const WINDOW_MONTHS = 12;

/**
 * A vendor name reduced to something comparable.
 *
 * The same supplier is spelled a dozen ways across bills ("Sunset Builders
 * Supply", "SUNSET BUILDERS SUPPLY LLC", "Sunset Bldrs"). A cadence built on
 * raw strings would see three vendors who each bill a third of the time
 * instead of one who bills every month — turning a real signal into noise.
 */
export function vendorKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(llc|inc|co|corp|ltd|company|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A customer name reduced to something comparable.
 *
 * Same reasoning as `vendorKey`, and the same consequence if it is skipped:
 * "Ferron" and "Ferron " would be two customers with half the history each,
 * and a markup baseline built on half the months is a baseline that says
 * nothing. Kept deliberately gentler than `vendorKey` — no company-suffix
 * stripping — because customer names are people and places more often than
 * they are companies, and "Co" is a real syllable in some of them.
 */
export function customerKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The months before `ym`, newest first, that the window covers. */
function windowMonths(ym: string, count: number): string[] {
  const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
  const out: string[] = [];
  let year = y;
  let month = m;
  for (let i = 0; i < count; i++) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    out.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return out;
}

/** The median of a list. Median, not mean: one enormous month of lumber must
 *  not drag a vendor's "typical" up past everything they normally send. */
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Learn the baselines for a billing month from the months before it.
 *
 * Reads ONE stored run per prior month — the newest, which is that month's
 * settled view. Returns null when there is not enough history, or when the
 * companion DB is unreachable: no norms is a perfectly good state, and every
 * check that reads them treats their absence as "say nothing".
 */
export async function learnNorms(ym: string): Promise<ReviewNorms | null> {
  try {
    await ensureDb();
    const wanted = windowMonths(ym, WINDOW_MONTHS);

    // One run per prior month — the newest for that month.
    const perMonth = new Map<string, MonthEvidence>();
    for (const m of wanted) {
      const rows = await db
        .select({ payload: invoiceReviewRuns.payload })
        .from(invoiceReviewRuns)
        .where(eq(invoiceReviewRuns.ym, m))
        .orderBy(desc(invoiceReviewRuns.ranAt), desc(invoiceReviewRuns.id))
        .limit(1);
      if (!rows[0]) continue;
      try {
        const parsed = JSON.parse(rows[0].payload) as { evidence?: MonthEvidence };
        if (parsed?.evidence?.jobs) perMonth.set(m, parsed.evidence);
      } catch {
        // A corrupt row is one month of missing history, not a failure.
      }
    }

    const monthsOfHistory = perMonth.size;
    if (monthsOfHistory < MIN_MONTHS) return null;

    // vendor → the per-month cost totals it appeared in.
    const byVendor = new Map<string, { name: string; months: Map<string, number> }>();
    for (const [m, ev] of perMonth) {
      for (const job of ev.jobs) {
        for (const b of job.bills) {
          const key = vendorKey(b.vendor || b.label);
          if (!key) continue;
          const entry = byVendor.get(key) ?? { name: b.vendor || b.label, months: new Map() };
          entry.months.set(m, (entry.months.get(m) ?? 0) + Math.abs(b.cost));
          byVendor.set(key, entry);
        }
      }
    }

    const vendors: VendorNorm[] = [];
    for (const [key, entry] of byVendor) {
      const months = [...entry.months.keys()].sort();
      vendors.push({
        key,
        name: entry.name,
        monthsSeen: months.length,
        monthsOfHistory,
        typicalMonthlyCost: median([...entry.months.values()]),
        lastSeenYm: months[months.length - 1] ?? "",
      });
    }
    vendors.sort((a, b) => b.typicalMonthlyCost - a.typicalMonthlyCost);

    // ── Customer markup ─────────────────────────────────────────────────
    // Per month, per customer: the blended markup ratio across everything
    // invoiced to them (total price ÷ total cost). Blended rather than
    // per-invoice so a customer billed on three invoices in a month gets one
    // number, which is what "what do we charge them" actually means.
    const byCustomer = new Map<
      string,
      { name: string; markupByMonth: Map<string, number>; priceByMonth: Map<string, number> }
    >();
    for (const [m, ev] of perMonth) {
      // customer → this month's totals
      const totals = new Map<string, { name: string; cost: number; price: number }>();
      for (const job of ev.jobs) {
        // Ascent's own overhead is never billed to anyone, so it has no markup
        // and must not dilute a real customer's baseline.
        if (job.neverInvoiced) continue;
        const key = customerKey(job.customerName);
        if (!key) continue;
        const t = totals.get(key) ?? { name: job.customerName, cost: 0, price: 0 };
        for (const inv of job.invoices) {
          t.cost += inv.cost;
          t.price += inv.price;
        }
        totals.set(key, t);
      }
      for (const [key, t] of totals) {
        // A month with no cost basis has no markup to speak of — a deposit-only
        // month, say. Skipping it is right: including it as a zero would drag
        // the median toward a rate the customer was never charged.
        if (t.cost <= 0 || t.price <= 0) continue;
        const entry =
          byCustomer.get(key) ?? { name: t.name, markupByMonth: new Map(), priceByMonth: new Map() };
        entry.name = t.name;
        entry.markupByMonth.set(m, t.price / t.cost);
        entry.priceByMonth.set(m, t.price);
        byCustomer.set(key, entry);
      }
    }

    const customers: CustomerNorm[] = [];
    for (const [key, entry] of byCustomer) {
      customers.push({
        key,
        name: entry.name,
        monthsSeen: entry.markupByMonth.size,
        monthsOfHistory,
        typicalMarkup: median([...entry.markupByMonth.values()]),
        typicalMonthlyPrice: median([...entry.priceByMonth.values()]),
      });
    }
    customers.sort((a, b) => b.typicalMonthlyPrice - a.typicalMonthlyPrice);

    return { ym, windowMonths: WINDOW_MONTHS, monthsOfHistory, vendors, customers };
  } catch {
    return null;
  }
}
