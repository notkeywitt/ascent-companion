/**
 * CHANGE ORDERS — the log on /change-orders and the Jobs page's Change Orders
 * tab, and the new change order the app creates in JobTread. Pure: no fetch.
 *
 * The log is read live from JobTread: every customer order named "Change Order"
 * CREATED on or after `CO_LOG_START`, made in the app or in JobTread. It starts
 * on the day the owner asked for it (2026-11-23) and runs forward. To let past
 * change orders in later, move `CO_LOG_START` back, or add their ids to
 * `CO_LOG_EXTRA_IDS`. Nothing else changes.
 *
 * A new change order is created as a DRAFT customer order. The office reviews
 * and sends it from JobTread. Its lines are priced at cost × markup, the way
 * JobTread prices a line from its cost type (an 18% markup in this org). The
 * JobTread read and write are in src/lib/jobtread/changeOrders.ts.
 */

/** The first day the log counts, by the document's createdAt (UTC date). */
export const CO_LOG_START = "2026-11-23";
/** Change orders created before CO_LOG_START that the log should still show. */
export const CO_LOG_EXTRA_IDS: readonly string[] = [];
/** The org's document template name. JobTread refuses a name it has no template for. */
export const CO_DOC_NAME = "Change Order";
/** What the "Change Order" template gives a draft (read off Job 37's #10, 2026-11-23). */
export const CO_DUE_DAYS = 30;

export type CoStatus = "draft" | "pending" | "approved" | "denied";

/** One change order in the log, as JobTread holds it. */
export interface CoRow {
  id: string;
  number: string;
  /** The document's subject: the change order's title. */
  title: string;
  status: CoStatus;
  /** Before tax. */
  price: number;
  /** Tax included. */
  total: number;
  issueDate: string;
  /** "YYYY-MM-DD…" — when it was created. Sorts the log. */
  createdAt: string;
  jobId: string;
  jobName: string;
  jobNumber: string;
  customer: string;
}

export const STATUS_LABEL: Record<CoStatus, string> = {
  draft: "Draft",
  pending: "Sent",
  approved: "Approved",
  denied: "Void",
};

/** In the log: created on or after the start, or named as an extra. */
export function inLog(row: { id: string; createdAt: string }): boolean {
  return row.createdAt.slice(0, 10) >= CO_LOG_START || CO_LOG_EXTRA_IDS.includes(row.id);
}

export type CoSort = "recent" | "oldest" | "amount" | "job";
export type CoGroup = "job" | "status" | "none";

export interface CoFilter {
  status: CoStatus | "";
  jobId: string;
}

export interface CoGroupOut {
  key: string;
  label: string;
  rows: CoRow[];
  /** Σ price before tax of the group's approved change orders. */
  approved: number;
  /** Σ price before tax of the group's draft and sent change orders. */
  open: number;
}

const byRecent = (a: CoRow, b: CoRow) => b.createdAt.localeCompare(a.createdAt);
const SORTS: Record<CoSort, (a: CoRow, b: CoRow) => number> = {
  recent: byRecent,
  oldest: (a, b) => -byRecent(a, b),
  amount: (a, b) => b.price - a.price || byRecent(a, b),
  job: (a, b) => a.jobName.localeCompare(b.jobName) || byRecent(a, b),
};

const jobLabel = (r: CoRow) => (r.customer ? `${r.customer} - ${r.jobName}` : r.jobName);
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The log, filtered, sorted and grouped. Groups keep the order of their newest
 * (or first, under the chosen sort) change order, so "recent first" puts the
 * job with the latest change order on top.
 */
export function groupLog(rows: CoRow[], filter: CoFilter, sort: CoSort, group: CoGroup): CoGroupOut[] {
  const shown = rows
    .filter((r) => (!filter.status || r.status === filter.status) && (!filter.jobId || r.jobId === filter.jobId))
    .sort(SORTS[sort]);
  const out = new Map<string, CoGroupOut>();
  for (const r of shown) {
    const [key, label] =
      group === "job" ? [r.jobId, jobLabel(r)] : group === "status" ? [r.status, STATUS_LABEL[r.status]] : ["all", ""];
    const g = out.get(key) ?? { key, label, rows: [], approved: 0, open: 0 };
    g.rows.push(r);
    if (r.status === "approved") g.approved = cents(g.approved + r.price);
    if (r.status === "draft" || r.status === "pending") g.open = cents(g.open + r.price);
    out.set(key, g);
  }
  return [...out.values()];
}

/* ------------------------------------------------------------ a new change order */

/** One line the office types: what, which cost code, what it costs Ascent. */
export interface CoLineInput {
  costCodeId: string;
  /** "03 30 00" — groups the line on the document. */
  code: string;
  codeName: string;
  /** Labor, Materials, Subcontractor… */
  costTypeId: string;
  name: string;
  description?: string;
  cost: number;
  isTaxable: boolean;
}

export interface CoInput {
  jobId: string;
  title: string;
  /** Why the scope changed. The document's description. */
  reason: string;
  /** 1.18 = cost plus 18%. */
  markup: number;
  lines: CoLineInput[];
}

/** The document header JobTread needs, read from the job. */
export interface CoHeader {
  fromName: string;
  fromAddress: string | null;
  toName: string;
  toAddress: string | null;
  jobLocationName: string;
  jobLocationAddress: string;
  taxRate: number;
  /** The "Allowance" unit every line takes, as on Studio's Change Order #18. */
  unitId: string | null;
}

/** Same half-up cent rounding as the invoice draft. */
export const r2 = (n: number) => Math.round(n * 100 + 1e-6) / 100;
export const priceOf = (cost: number, markup: number) => r2(cost * markup);

/** A cost type's margin → the markup JobTread prices with: 0.1525… → 1.18. */
export function markupFromMargin(margin: number | null | undefined): number {
  if (typeof margin !== "number" || !(margin >= 0) || margin >= 1) return 1;
  return Math.round((1 / (1 - margin)) * 1e4) / 1e4;
}

/** Problems that stop the create, in words for the office. Empty = good to send. */
export function checkCo(input: CoInput): string[] {
  const out: string[] = [];
  if (!input.jobId) out.push("Pick a job.");
  if (!input.title.trim()) out.push("Give the change order a title.");
  if (input.title.trim().length > 128) out.push("Keep the title under 128 characters.");
  if (!(input.markup >= 1 && input.markup <= 3)) out.push("Markup must be between 0% and 200%.");
  if (!input.lines.length) out.push("Add at least one line.");
  input.lines.forEach((l, i) => {
    const n = `Line ${i + 1}`;
    if (!l.costCodeId) out.push(`${n}: pick a cost code.`);
    if (!l.name.trim()) out.push(`${n}: say what it is.`);
    if (!Number.isFinite(l.cost) || l.cost === 0) out.push(`${n}: enter a cost.`);
  });
  return out;
}

export interface CoTotals {
  cost: number;
  price: number;
  tax: number;
  total: number;
}

/** What the draft will total, as JobTread will price it. */
export function coTotals(input: Pick<CoInput, "lines" | "markup">, taxRate: number): CoTotals {
  let cost = 0;
  let price = 0;
  let taxable = 0;
  for (const l of input.lines) {
    const c = Number.isFinite(l.cost) ? l.cost : 0;
    const p = priceOf(c, input.markup);
    cost += c;
    price += p;
    if (l.isTaxable) taxable += p;
  }
  const tax = r2(taxable * taxRate);
  return { cost: r2(cost), price: r2(price), tax, total: r2(price + tax) };
}

/**
 * The `createDocument` input for a draft change order: one group per cost code
 * ("03 30 00 Cast-in-Place Concrete"), its lines under it, each at quantity 1,
 * unit cost = the cost, unit price = cost × markup. The shape of Studio's
 * Change Order #18. Lines carry no budget link: JobTread adds them to the
 * budget as new lines when the change order is approved. Throws on a bad input.
 */
export function buildCoInput(input: CoInput, header: CoHeader): Record<string, unknown> {
  const problems = checkCo(input);
  if (problems.length) throw new Error(problems.join(" "));
  const groups = new Map<string, { name: string; lineItems: Record<string, unknown>[] }>();
  for (const l of input.lines) {
    const key = l.code || l.costCodeId;
    const g = groups.get(key) ?? { name: `${l.code} ${l.codeName}`.trim().slice(0, 250), lineItems: [] };
    g.lineItems.push({
      _type: "costItem",
      name: l.name.trim().slice(0, 250),
      ...(l.description?.trim() ? { description: l.description.trim() } : {}),
      costCodeId: l.costCodeId,
      ...(l.costTypeId ? { costTypeId: l.costTypeId } : {}),
      ...(header.unitId ? { unitId: header.unitId } : {}),
      quantity: 1,
      unitCost: r2(l.cost),
      unitPrice: priceOf(l.cost, input.markup),
      isTaxable: l.isTaxable,
    });
    groups.set(key, g);
  }
  const lineItems = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, g]) => ({ _type: "costGroup", name: g.name, lineItems: g.lineItems }));
  return {
    type: "customerOrder",
    jobId: input.jobId,
    name: CO_DOC_NAME,
    subject: input.title.trim(),
    ...(input.reason.trim() ? { description: input.reason.trim() } : {}),
    fromName: header.fromName,
    ...(header.fromAddress ? { fromAddress: header.fromAddress } : {}),
    toName: header.toName,
    ...(header.toAddress ? { toAddress: header.toAddress } : {}),
    jobLocationName: header.jobLocationName,
    jobLocationAddress: header.jobLocationAddress,
    taxRate: header.taxRate,
    dueDays: CO_DUE_DAYS,
    requireSignature: true,
    includeInBudget: true,
    lineItems,
  };
}

export const jtDocUrl = (jobId: string, docId: string) => `https://app.jobtread.com/jobs/${jobId}/documents/${docId}`;
