/**
 * The money answers AscentBot and /chat give, shaped from JobTread reads in
 * jobtread.ts. Pure functions only, so the totals are tested
 * (botFinancials.test.ts) and the tools in chatTools.ts stay thin.
 *
 * Every figure is READ from JobTread or summed from what it returned. Nothing
 * here estimates. Labor appears as hours and cost per cost code, never per
 * person: a person's pay rate is the office's, not the bot's.
 */

import type {
  ClientDocRow,
  JobCostContributors,
  JobCostDetail,
  OpenInvoiceRow,
  VendorBillRow,
} from "@/lib/jobtread";

const cents = (n: number) => Math.round(n * 100) / 100;

const has = (hay: string, words: string[]) => {
  if (!words.length) return true;
  const h = hay.toLowerCase();
  return words.some((w) => h.includes(w));
};

/** Codes listed at most, so a big job's answer stays inside the model's reading. */
const MAX_CODES = 60;

/**
 * A job's budget against spend, in total, per division and per cost code.
 * `left` = budget − bills − labor (negative = over budget). With words, only
 * the matching divisions and codes, and totals over just those.
 */
export function summarizeJobFinancials(d: JobCostDetail, words: string[]) {
  const divisions = d.divisions
    .map((div) => {
      const divHit = has(`${div.division} ${div.name}`, words);
      const codes = div.codes.filter((c) => divHit || has(`${c.number} ${c.name}`, words));
      return { div, codes };
    })
    .filter((x) => x.codes.length);
  const codes = divisions.flatMap((x) => x.codes);
  const sum = (k: "budget" | "bills" | "labor" | "laborHours" | "invoiced") =>
    cents(codes.reduce((n, c) => n + c[k], 0));
  const filtered = words.length > 0;
  const budget = filtered ? sum("budget") : cents(d.budgetTotal);
  const bills = filtered ? sum("bills") : cents(d.billsTotal);
  const labor = filtered ? sum("labor") : cents(d.laborTotal);
  return {
    basis:
      d.budgetBasis === "customerOrders"
        ? "Budget = approved contract and change orders, at cost."
        : "Budget = the base estimate (the job has no approved contract yet).",
    totals: {
      budget,
      spentOnBills: bills,
      laborCost: labor,
      laborHours: filtered ? sum("laborHours") : cents(d.laborHoursTotal),
      spent: cents(bills + labor),
      left: cents(budget - bills - labor),
      invoicedToClient: filtered ? sum("invoiced") : cents(d.invoicedTotal),
    },
    ...(d.currentInvoiceLabel ? { latestInvoice: { label: d.currentInvoiceLabel, cost: cents(d.currentInvoiceTotal) } } : {}),
    divisions: divisions.map(({ div, codes: cs }) => {
      const t = (k: "budget" | "bills" | "labor") => cents(cs.reduce((n, c) => n + c[k], 0));
      return {
        division: `${div.division} ${div.name}`.trim(),
        budget: t("budget"),
        bills: t("bills"),
        labor: t("labor"),
        left: cents(t("budget") - t("bills") - t("labor")),
      };
    }),
    codes: codes
      .map((c) => ({
        code: `${c.number} ${c.name}`.trim(),
        budget: cents(c.budget),
        bills: cents(c.bills),
        labor: cents(c.labor),
        laborHours: cents(c.laborHours),
        left: cents(c.budget - c.bills - c.labor),
        invoiced: cents(c.invoiced),
      }))
      .filter((c) => c.budget || c.bills || c.labor || c.invoiced)
      .sort((a, b) => a.left - b.left) // most over budget first
      .slice(0, MAX_CODES),
    ...(codes.length > MAX_CODES ? { note: `Showing the ${MAX_CODES} codes most over budget of ${codes.length}.` } : {}),
    ...(d.degraded.length ? { warning: `Some figures came from a slower fallback read: ${d.degraded.join(", ")}.` } : {}),
  };
}

/** The bill lines behind a job's spend, with labor as per-code totals only. */
export function summarizeCostLines(c: JobCostContributors, words: string[]) {
  const bills = c.bills
    .filter((b) => has(`${b.code} ${b.vendor} ${b.lineName} ${b.label}`, words))
    .sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));
  const tally = (key: (b: (typeof bills)[number]) => string) => {
    const m = new Map<string, number>();
    for (const b of bills) m.set(key(b) || "(none)", (m.get(key(b) || "(none)") ?? 0) + b.cost);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, cost]) => ({ name, cost: cents(cost) }));
  };
  const labor = new Map<string, { hours: number; cost: number }>();
  for (const t of c.time) {
    if (!has(t.code, words)) continue;
    const row = labor.get(t.code || "(none)") ?? { hours: 0, cost: 0 };
    row.hours += t.hours;
    row.cost += t.cost;
    labor.set(t.code || "(none)", row);
  }
  return {
    billLines: bills.length,
    billTotal: cents(bills.reduce((n, b) => n + b.cost, 0)),
    byVendor: tally((b) => b.vendor),
    byCode: tally((b) => b.code),
    laborByCode: [...labor.entries()].map(([code, r]) => ({ code, hours: cents(r.hours), cost: cents(r.cost) })),
    newest: bills.slice(0, 50).map((b) => ({
      date: (b.issueDate ?? "").slice(0, 10),
      vendor: b.vendor,
      bill: b.label,
      status: b.status,
      line: b.lineName,
      code: b.code,
      cost: cents(b.cost),
    })),
    ...(bills.length > 50 ? { note: `Totals cover all ${bills.length} lines; the list shows the newest 50.` } : {}),
  };
}

/**
 * A job's client orders and invoices, and the totals people ask for. Draft and
 * denied documents are listed but count toward nothing: a draft was never
 * sent and a denied one was withdrawn.
 */
export function summarizeClientDocs(rows: ClientDocRow[]) {
  const live = (r: ClientDocRow) => r.status === "approved" || r.status === "pending";
  const orders = rows.filter((r) => r.type === "customerOrder");
  const invoices = rows.filter((r) => r.type === "customerInvoice");
  const contract = orders.filter((r) => r.status === "approved" && r.includeInBudget);
  const billed = invoices.filter(live);
  const add = (rs: ClientDocRow[], k: "price" | "total" | "amountPaid" | "balance") => cents(rs.reduce((n, r) => n + r[k], 0));
  const doc = (r: ClientDocRow) => ({
    name: `${r.name} #${r.number}`,
    status: r.status,
    issued: r.issueDate,
    ...(r.type === "customerInvoice" ? { due: r.dueDate } : {}),
    beforeTax: cents(r.price),
    total: cents(r.total),
    ...(r.type === "customerInvoice" ? { paid: cents(r.amountPaid), balance: cents(r.balance) } : {}),
  });
  return {
    totals: {
      contractWithTax: add(contract, "total"),
      contractBeforeTax: add(contract, "price"),
      invoicedWithTax: add(billed, "total"),
      paid: add(billed, "amountPaid"),
      owed: add(billed, "balance"),
      draftInvoices: invoices.filter((r) => r.status === "draft").length,
    },
    orders: orders.filter((r) => r.total || r.price).map(doc),
    invoices: invoices.map(doc),
  };
}

const DAY_MS = 86_400_000;

/** Accounts receivable: what clients still owe, oldest debt first, with aging buckets. */
export function summarizeOpenInvoices(rows: OpenInvoiceRow[], today: string, words: string[]) {
  const open = rows
    .filter((r) => r.balance > 0.005 && has(`${r.jobName} ${r.customerName} ${r.number}`, words))
    .map((r) => {
      const late = r.dueDate ? Math.floor((Date.parse(today) - Date.parse(r.dueDate)) / DAY_MS) : 0;
      return { r, late: Math.max(0, late) };
    })
    .sort((a, b) => b.late - a.late || b.r.balance - a.r.balance);
  const bucket = (lo: number, hi: number) =>
    cents(open.filter((x) => x.late >= lo && x.late <= hi).reduce((n, x) => n + x.r.balance, 0));
  return {
    count: open.length,
    owed: cents(open.reduce((n, x) => n + x.r.balance, 0)),
    aging: {
      current: bucket(0, 0),
      "1-30 days late": bucket(1, 30),
      "31-60 days late": bucket(31, 60),
      "61-90 days late": bucket(61, 90),
      "over 90 days late": bucket(91, Number.MAX_SAFE_INTEGER),
    },
    invoices: open.slice(0, 60).map(({ r, late }) => ({
      job: r.jobName,
      customer: r.customerName,
      invoice: r.number,
      issued: r.issueDate,
      due: r.dueDate,
      total: cents(r.total),
      paid: cents(r.amountPaid),
      balance: cents(r.balance),
      daysLate: late,
    })),
  };
}

/** One vendor's bills, live ones only in the totals, newest first. */
export function summarizeVendorBills(rows: VendorBillRow[], since: string) {
  const kept = rows.filter((b) => !since || (b.issueDate ?? "") >= since);
  const live = kept.filter((b) => b.status === "approved" || b.status === "pending");
  const tally = (key: (b: VendorBillRow) => string) => {
    const m = new Map<string, { cost: number; bills: number }>();
    for (const b of live) {
      const k = key(b) || "(none)";
      const row = m.get(k) ?? { cost: 0, bills: 0 };
      row.cost += b.cost;
      row.bills += 1;
      m.set(k, row);
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([name, r]) => ({ name, cost: cents(r.cost), bills: r.bills }));
  };
  return {
    bills: kept.length,
    total: cents(live.reduce((n, b) => n + b.cost, 0)),
    note: "Totals count approved and pending bills; drafts and voided (denied) bills are listed only.",
    byJob: tally((b) => b.jobName),
    byYear: tally((b) => (b.issueDate ?? "").slice(0, 4)),
    newest: kept.slice(0, 40).map((b) => ({
      date: (b.issueDate ?? "").slice(0, 10),
      bill: b.number ?? "",
      job: b.jobName,
      status: b.status,
      amount: cents(b.cost),
    })),
  };
}
