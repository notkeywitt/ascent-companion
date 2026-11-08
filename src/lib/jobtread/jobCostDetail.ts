// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import type { UntaxedLine } from "@/lib/taxableLines";
import { DEPOSIT_CSI } from "@/lib/deposits";
import { _jobCostKey, cachedRef, JOB_COST_TTL_MS, pageAll, pageEach, pave, type PaveConfig, PaveTooManyPagesError } from "./core";
import { _isInvoicedToClient, _isOnAnyInvoice } from "./unbilled";
import { _costToCompleteByFullWalk, _sumCostByCostCode, CTC_ACTUAL_WHERE, CTC_BUDGET_WHERE } from "./codingQueue";
// ---------------------------------------------------------------------------
// JOB COST DETAIL  — the three-level tree behind the /jobs browser
// ---------------------------------------------------------------------------

/** One estimate line (level 3) — the Tracking Sheet's row granularity. */
export interface CostLine {
  id: string;
  name: string; // the line's OWN name, e.g. "Wood Decking - Labor"
  description?: string;
  quantity?: number;
  unit?: string; // unit.name, e.g. "sf" / "month"
  unitCost?: number;
  cost: number; // extended cost = the sheet's TOTAL
  costType?: string; // Labor / Materials / Subcontractor / Other
  isAllowance: boolean; // allowanceType is set on this line
}

/** Estimate money split by the Tracking Sheet's cost-type columns. */
export interface CostTypeSplit {
  labor: number; // ALLOWANCE/SUB/VENDOR's sibling — costType "Labor"
  allowance: number; // any line with an allowanceType
  sub: number; // costType "Subcontractor"
  vendor: number; // costType "Materials"
  other: number; // anything else, so the split always sums to budget
}

/** One cost code (level 2). */
export interface CostCodeRow {
  number: string;
  name: string; // the COST CODE's name
  division: string; // first two digits
  budget: number; // Σ approved customer-order line cost for this code
  bills: number; // Σ approved+pending vendor-bill cost
  labor: number; // Σ time-entry cost, every entry regardless of approval
  laborHours: number; // Σ time-entry minutes ÷ 60, every entry
  laborApproved: number; // Σ time-entry cost, isApproved entries only
  laborApprovedHours: number; // …of which, in hours
  invoiced: number; // Σ approved customer-invoice line cost, all time
  currentInvoice: number; // …of which the most recent invoice
  split: CostTypeSplit;
  lines: CostLine[];
}

/** One CSI division (level 1). */
export interface CostDivisionRow {
  division: string; // "01", "06", … ("—" when a code has no digits)
  name: string; // JobTread's parent cost-code name
  budget: number;
  bills: number;
  labor: number;
  laborHours: number;
  laborApproved: number;
  laborApprovedHours: number;
  invoiced: number;
  currentInvoice: number;
  split: CostTypeSplit;
  codes: CostCodeRow[];
}

/**
 * Which number the `budget` fields hold.
 * - `customerOrders` — JobTread's "Budgeted Cost": approved, includeInBudget
 *   customerOrder lines, so it absorbs approved change orders. The default.
 * - `budgetLeaves` — the base estimate (cost items with no document), used only
 *   when a job has no approved customer orders at all.
 */
export type BudgetBasis = "customerOrders" | "budgetLeaves";

export interface JobCostDetail {
  divisions: CostDivisionRow[];
  budgetBasis: BudgetBasis;
  budgetTotal: number;
  billsTotal: number;
  laborTotal: number;
  laborHoursTotal: number;
  invoicedTotal: number;
  currentInvoiceTotal: number;
  /** Name/date of the invoice behind `currentInvoice`, for the column header. */
  currentInvoiceLabel: string | null;
  /** Names of any query that fell back to the slow path, for the UI to surface. */
  degraded: string[];
}

export const emptySplit = (): CostTypeSplit => ({
  labor: 0,
  allowance: 0,
  sub: 0,
  vendor: 0,
  other: 0,
});

/** Which cost-type column a line lands in. Allowance wins — it is a line flag, not a type. */
export function splitKeyFor(costType: string | undefined, isAllowance: boolean): keyof CostTypeSplit {
  if (isAllowance) return "allowance";
  switch ((costType ?? "").trim().toLowerCase()) {
    case "labor":
      return "labor";
    case "subcontractor":
      return "sub";
    case "materials":
      return "vendor";
    default:
      return "other";
  }
}

export const addSplit = (into: CostTypeSplit, from: CostTypeSplit) => {
  into.labor += from.labor;
  into.allowance += from.allowance;
  into.sub += from.sub;
  into.vendor += from.vendor;
  into.other += from.other;
};

/**
 * Σ time-entry cost and minutes per cost-code number, summed BY JOBTREAD.
 * `where` narrows the entries counted (e.g. `["isApproved", true]`, confirmed
 * live 2026-08-06) — omit it for every entry regardless of approval.
 *
 * Same grouped-aggregate shape as `_sumCostByCostCode` (`timeEntries` is a
 * standard connection, so it takes `group`/`withValues`), which replaces the
 * browser's old full pagination of job.timeEntries. Rate is deliberately NOT
 * summed — an average of `hourlyRate` across entries is wrong when rates differ;
 * the UI derives it as cost ÷ hours.
 */
export async function _sumTimeByCostCode(
  cfg: PaveConfig,
  jobId: string,
  where?: unknown,
): Promise<Record<string, { cost: number; minutes: number }>> {
  const out: Record<string, { cost: number; minutes: number }> = {};
  await pageEach<any>(
    cfg,
    {
      label: "job.timeEntries grouped by cost code",
      query: (args) => ({
        job: {
          $: { id: jobId },
          id: {},
          timeEntries: {
            $: {
              // pages over GROUPS (one per cost code), not raw entries
              ...(where ? { where } : {}),
              group: {
                by: [["costItem", "costCode", "number"]],
                aggs: { total: { sum: "cost" }, mins: { sum: "minutes" } },
              },
              ...args,
            },
            withValues: {},
            nextPage: {},
          },
        },
      }),
      pick: (r) => r?.job?.timeEntries,
    },
    (rows) => {
      for (const row of rows) {
        const code = row?.costItem?.costCode?.number?.toString().trim();
        if (!code) continue;
        const e = (out[code] ??= { cost: 0, minutes: 0 });
        e.cost += row.total ?? 0;
        e.minutes += row.mins ?? 0;
      }
    },
  );
  return out;
}

/**
 * The pre-aggregate way: page every time entry and bucket here. Safety net
 * only. `approvedOnly` filters client-side (this walk has the raw nodes
 * already, so no second query is needed the way the aggregate path needs one).
 */
export async function _sumTimeByFullWalk(
  cfg: PaveConfig,
  jobId: string,
  approvedOnly = false,
): Promise<Record<string, { cost: number; minutes: number }>> {
  const out: Record<string, { cost: number; minutes: number }> = {};
  await pageEach<any>(
    cfg,
    {
      label: "job.timeEntries (full walk)",
      query: (args) => ({
        job: {
          $: { id: jobId },
          timeEntries: {
            $: args,
            nextPage: {},
            nodes: {
              cost: {},
              minutes: {},
              isApproved: {},
              costItem: { costCode: { number: {} } },
            },
          },
        },
      }),
      pick: (r) => r?.job?.timeEntries,
    },
    (rows) => {
      for (const n of rows) {
        if (approvedOnly && !n?.isApproved) continue;
        const code = n?.costItem?.costCode?.number?.toString().trim();
        if (!code) continue;
        const e = (out[code] ??= { cost: 0, minutes: 0 });
        e.cost += n.cost ?? 0;
        e.minutes += n.minutes ?? 0;
      }
    },
  );
  return out;
}

/**
 * The estimate lines behind the budget, with everything the Tracking-Sheet-style
 * table needs per line (quantity / unit / unit cost / cost type / allowance).
 *
 * `where` is applied SERVER-side, so JobTread returns only the lines that count
 * instead of every cost item on the job — the same trick that took
 * `_getJobBudgetUncached` from 1,209 scanned items to 86 returned. Confirmed
 * live 2026-08-04: on Otis Perkins the filtered query returns 115 lines in 2
 * pages / 654 ms against 1,220 items in 13 pages / 2,017 ms for the full walk,
 * with identical totals ($1,326,647.85).
 */
export async function _costItemLines(cfg: PaveConfig, jobId: string, where: unknown): Promise<any[]> {
  return pageAll<any>(cfg, {
    label: "job.costItems (estimate lines)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        costItems: {
          $: { ...(where ? { where } : {}), ...args },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            description: {},
            quantity: {},
            unitCost: {},
            cost: {},
            unit: { name: {} },
            costType: { name: {} },
            allowanceType: {},
            document: { type: {}, status: {}, includeInBudget: {} },
            costCode: { number: {}, name: {}, parentCostCode: { number: {}, name: {} } },
          },
        },
      },
    }),
    pick: (r) => r?.job?.costItems,
  });
}

/**
 * Approved customer invoices on a job, newest issueDate first.
 *
 * Confirmed live 2026-08-04 across 5 jobs (Bunkhouse, Beach Shack, Otis Perkins,
 * Pole Barn, Car Barn): these invoices ARE fully CSI-coded — the sum of their
 * cost items matches the document-level `cost` to the penny, with nothing
 * uncoded (e.g. Otis Perkins, 235 lines over 43 cost codes, Δ = 0.00). That is
 * what makes the invoiced-per-cost-code columns safe to compute.
 */
export const INVOICED_WHERE = {
  and: [
    [["document", "type"], "customerInvoice"],
    [["document", "status"], "approved"],
  ],
};

export async function _approvedCustomerInvoices(
  cfg: PaveConfig,
  jobId: string,
): Promise<{ id: string; number: string; name: string; issueDate: string | null; cost: number }[]> {
  const r = await pave(cfg, {
    job: {
      $: { id: jobId },
      documents: {
        $: {
          size: 100,
          where: {
            and: [
              ["type", "customerInvoice"],
              ["status", "approved"],
            ],
          },
        },
        nodes: { id: {}, number: {}, name: {}, issueDate: {}, cost: {} },
      },
    },
  });
  const nodes: any[] = r?.job?.documents?.nodes ?? [];
  return nodes
    .map((n) => ({
      id: n.id,
      number: n.number != null ? String(n.number) : "",
      name: String(n.name ?? ""),
      issueDate: n.issueDate ?? null,
      cost: n.cost ?? 0,
    }))
    .sort((a, b) => String(b.issueDate ?? "").localeCompare(String(a.issueDate ?? "")));
}

/**
 * Every cost item in a month flagged `isTaxable: false` — on the month's vendor
 * BILLS and on the client INVOICES those bills reached.
 *
 * READ ONLY. It exists for the /taxable-lines worklist: a client invoice taxes
 * only the lines carrying the flag, so one cleared by mistake under-bills the
 * client sales tax Ascent still owes. `createLine` wrote `false` on every line
 * added to an existing bill until 2026-09-10, which is where most came from.
 *
 * THE TWO SIDES ARE FOUND DIFFERENTLY, and they have to be. A bill's issueDate
 * IS its billing period, so the month's bills are a date range. A client
 * invoice for August is raised in September and is often still a DRAFT WITH NO
 * ISSUE DATE AT ALL, so no date window can find it — the month's invoices are
 * the ones CARRYING the month's bills, which is the same rule the Apps Script
 * package now uses. Getting this wrong is what made August's package report
 * July's invoice (see _misPullInvoices).
 *
 * Nothing is filtered here — overhead jobs and sales-tax lines are dropped in
 * `buildTaxableLinesReport`, which is pure and tested. This only fetches.
 *
 * Cost-item NODES cannot be nested inside a paged `documents` connection (413),
 * so the invoice side is two phases: walk the invoices reading only aggregates,
 * then read the lines of the few that have any.
 */
export async function getUntaxedLines(
  cfg: PaveConfig,
  year: number,
  month: number,
): Promise<UntaxedLine[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const out: UntaxedLine[] = [];

  // ── The month's BILLS ────────────────────────────────────────────────────
  await pageEach<any>(
    cfg,
    {
      label: "organization.costItems (untaxed bill lines)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          costItems: {
            $: {
              where: {
                and: [
                  [["document", "type"], "=", "vendorBill"],
                  [["document", "status"], "in", ["draft", "pending", "approved"]],
                  [["document", "issueDate"], ">=", first],
                  [["document", "issueDate"], "<=", last],
                  [["isTaxable"], "=", false],
                ],
              },
              ...args,
            },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              cost: {},
              costCode: { number: {} },
              document: {
                id: {},
                number: {},
                issueDate: {},
                status: {},
                amountPaid: {},
                account: { name: {} },
                job: { id: {}, name: {}, location: { account: { name: {} } } },
                docLines: { _: "costItems", count: {} },
              },
            },
          },
        },
      }),
      pick: (r) => r?.organization?.costItems,
    },
    (rows) => {
      for (const n of rows) {
        const doc = n.document ?? {};
        const job = doc.job ?? {};
        out.push({
          id: String(n.id ?? ""),
          name: String(n.name ?? ""),
          cost: Number(n.cost) || 0,
          price: 0, // a vendor bill's lines carry no price
          costCode: String(n.costCode?.number ?? "").trim(),
          docKind: "bill",
          docId: String(doc.id ?? ""),
          docNumber: doc.number == null ? "" : String(doc.number),
          docIssueDate: String(doc.issueDate ?? "").slice(0, 10),
          docStatus: String(doc.status ?? ""),
          docLineCount: doc.docLines?.count ?? 0,
          docAmountPaid: Number(doc.amountPaid) || 0,
          vendor: String(doc.account?.name ?? "").trim(),
          jobId: String(job.id ?? ""),
          jobName: String(job.name ?? "").trim(),
          customerName: String(job.location?.account?.name ?? "").trim(),
        });
      }
    },
  );

  // ── The INVOICES those bills reached ─────────────────────────────────────
  const candidates: any[] = [];
  await pageEach<any>(
    cfg,
    {
      label: "organization.documents (customer invoices)",
      // 25: the two aliased aggregates below ride along at this size the way the
      // invoice review's do; nodes would not.
      size: 25,
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          documents: {
            $: {
              where: {
                and: [
                  [["type"], "customerInvoice"],
                  [["status"], "in", ["draft", "pending", "approved"]],
                ],
              },
              ...args,
            },
            nextPage: {},
            nodes: {
              id: {},
              number: {},
              issueDate: {},
              status: {},
              amountPaid: {},
              job: { id: {}, name: {}, location: { account: { name: {} } } },
              docLines: { _: "costItems", count: {} },
              monthBills: {
                _: "referencedDocuments",
                $: {
                  where: {
                    and: [
                      [["type"], "vendorBill"],
                      [["issueDate"], ">=", first],
                      [["issueDate"], "<=", last],
                    ],
                  },
                },
                count: {},
              },
              untaxed: {
                _: "costItems",
                $: { where: [["isTaxable"], "=", false] },
                count: {},
              },
            },
          },
        },
      }),
      pick: (r) => r?.organization?.documents,
    },
    (rows) => {
      for (const n of rows) {
        if (!(n.monthBills?.count > 0)) continue;
        if (!(n.untaxed?.count > 0)) continue;
        candidates.push(n);
      }
    },
  );

  // Phase two: the lines themselves, one read per invoice that has any.
  for (const inv of candidates) {
    const job = inv.job ?? {};
    const r: any = await pave(cfg, {
      document: {
        $: { id: inv.id },
        untaxed: {
          _: "costItems",
          $: { where: [["isTaxable"], "=", false], size: 100 },
          nodes: { id: {}, name: {}, cost: {}, price: {}, costCode: { number: {} } },
        },
      },
    });
    for (const n of (r?.document?.untaxed?.nodes ?? []) as any[]) {
      out.push({
        id: String(n.id ?? ""),
        name: String(n.name ?? ""),
        cost: Number(n.cost) || 0,
        price: Number(n.price) || 0,
        costCode: String(n.costCode?.number ?? "").trim(),
        docKind: "invoice",
        docId: String(inv.id ?? ""),
        docNumber: inv.number == null ? "" : String(inv.number),
        docIssueDate: String(inv.issueDate ?? "").slice(0, 10),
        docStatus: String(inv.status ?? ""),
        docLineCount: inv.docLines?.count ?? 0,
        docAmountPaid: Number(inv.amountPaid) || 0,
        vendor: "",
        jobId: String(job.id ?? ""),
        jobName: String(job.name ?? "").trim(),
        customerName: String(job.location?.account?.name ?? "").trim(),
      });
    }
  }

  return out;
}

/**
 * Is this cost code the DIVISION itself ("04 00 00", "26 00 00")? Everything
 * after the first two digits is zero. JobTread leaves these without a
 * parentCostCode — they ARE the parent — so their own name is the division's.
 */
export function isDivisionLevelCode(number: string): boolean {
  const digits = String(number ?? "").replace(/\D/g, "");
  return digits.length >= 4 && /^0+$/.test(digits.slice(2));
}

/**
 * Everything the /jobs browser needs for one job, as a division → cost code →
 * estimate line tree, in ~6 JobTread calls instead of the browser's old 13–33.
 *
 * Cached per job at JOB_COST_TTL_MS and dropped by `clearJobCostCaches()`, so a
 * bill write shows up immediately rather than waiting out the TTL.
 */
export function getJobCostDetail(cfg: PaveConfig, jobId: string): Promise<JobCostDetail> {
  return cachedRef(_jobCostKey("costdetail", cfg.orgId, jobId), JOB_COST_TTL_MS, () =>
    _getJobCostDetailUncached(cfg, jobId),
  );
}
export async function _getJobCostDetailUncached(cfg: PaveConfig, jobId: string): Promise<JobCostDetail> {
  const degraded: string[] = [];

  // 1. Budget side — approved customer-order lines, i.e. JobTread's own
  //    "Budgeted Cost" (server-filtered, with a client-filtered full walk as the
  //    safety net so the table can't go empty).
  let lineNodes: any[];
  try {
    lineNodes = await _costItemLines(cfg, jobId, CTC_BUDGET_WHERE);
  } catch {
    degraded.push("budget");
    const all = await _costItemLines(cfg, jobId, undefined);
    lineNodes = all.filter(
      (n) =>
        n?.document?.type === "customerOrder" &&
        n?.document?.status === "approved" &&
        n?.document?.includeInBudget,
    );
  }

  // Not every job's budget was issued as an approved customer order — measured
  // 2026-08-04, 8 of the org's 24 jobs have real budget leaves but no approved
  // customerOrder at all (Pole Barn: $319,530 of leaves, $0 of orders, against
  // $306,945 of bills). On those, the customer-order basis alone would render a
  // $0 budget and a six-figure red "over budget", so fall back to the base
  // estimate and tell the UI which basis it got rather than showing a number
  // that looks like a disaster.
  let budgetBasis: BudgetBasis = "customerOrders";
  if (lineNodes.reduce((s, n) => s + (n?.cost ?? 0), 0) === 0) {
    try {
      const leaves = await _costItemLines(cfg, jobId, [["document", "id"], null]);
      if (leaves.some((n) => (n?.cost ?? 0) !== 0)) {
        lineNodes = leaves;
        budgetBasis = "budgetLeaves";
      }
    } catch {
      degraded.push("budget fallback");
    }
  }

  // 2. Actual spend per cost code — approved + pending vendor bills. Reuses the
  //    exact predicate and aggregate the bill view's Remaining column runs on.
  let bills: Record<string, number>;
  try {
    bills = await _sumCostByCostCode(cfg, jobId, CTC_ACTUAL_WHERE);
  } catch {
    degraded.push("bills");
    ({ actual: bills } = await _costToCompleteByFullWalk(cfg, jobId));
  }

  // 3. Labor per cost code — time entries carry their own cost, so bills and
  //    labor never double-count. Fetched twice: every entry, and isApproved
  //    entries only — the Invoicing board's "include unapproved time" toggle
  //    switches between them with no extra round trip.
  let time: Record<string, { cost: number; minutes: number }>;
  let timeApproved: Record<string, { cost: number; minutes: number }>;
  try {
    [time, timeApproved] = await Promise.all([
      _sumTimeByCostCode(cfg, jobId),
      _sumTimeByCostCode(cfg, jobId, ["isApproved", true]),
    ]);
  } catch {
    degraded.push("labor");
    time = await _sumTimeByFullWalk(cfg, jobId);
    timeApproved = await _sumTimeByFullWalk(cfg, jobId, true);
  }

  // 4. Invoiced per cost code — approved customer-invoice lines, all time, plus
  //    the most recent invoice on its own so the view can separate CURRENT
  //    INVOICE from TOTAL PREVIOUSLY INVOICED the way the Tracking Sheet does.
  //    "Current" is the latest invoice by issueDate rather than a calendar
  //    window, so it can't drift from deriveBillingPeriod()'s 10th-to-10th rule.
  //    A month can hold TWO invoices (the normal one and a $0 warranty record,
  //    src/lib/warranty.ts), so "current" is every approved invoice issued in
  //    the latest invoice's month, not the single newest one.
  let invoiced: Record<string, number> = {};
  let currentInvoice: Record<string, number> = {};
  let currentInvoiceLabel: string | null = null;
  try {
    const invoices = await _approvedCustomerInvoices(cfg, jobId);
    if (invoices.length > 0) {
      invoiced = await _sumCostByCostCode(cfg, jobId, INVOICED_WHERE);
      const latest = invoices[0];
      const ym = String(latest.issueDate ?? "").slice(0, 7);
      const current = ym
        ? invoices.filter((i) => String(i.issueDate ?? "").slice(0, 7) === ym)
        : [latest];
      currentInvoice = await _sumCostByCostCode(
        cfg,
        jobId,
        current.length === 1
          ? [["document", "id"], latest.id]
          : [["document", "id"], "in", current.map((i) => i.id)],
      );
      const name =
        current.length === 1
          ? latest.name
          : current.map((i) => (i.number ? `#${i.number}` : i.name)).join(" + ");
      currentInvoiceLabel = latest.issueDate ? `${name} · ${latest.issueDate}` : name || null;
    }
  } catch {
    degraded.push("invoiced");
    invoiced = {};
    currentInvoice = {};
    currentInvoiceLabel = null;
  }

  // ---- fold into the tree ------------------------------------------------
  const codes = new Map<string, CostCodeRow>();
  // Three ways a division can get its name, best first: a child's
  // parentCostCode name, the division-level code's OWN name, that parent's
  // number. Kept apart so a later, better source still wins.
  const divisionNames = new Map<string, string>();
  const divisionSelfNames = new Map<string, string>();
  const divisionNumbers = new Map<string, string>();
  const divisionNameOf = (division: string) =>
    divisionNames.get(division) ??
    divisionSelfNames.get(division) ??
    divisionNumbers.get(division) ??
    (division === "—" ? "Uncategorized" : "");

  const codeRow = (
    number: string,
    name: string,
    parentName?: string,
    parentNumber?: string,
  ): CostCodeRow => {
    const digits = number.replace(/\D/g, "");
    const division = digits ? digits.slice(0, 2) : "—";
    if (parentName) divisionNames.set(division, divisionNames.get(division) ?? parentName);
    // A code that IS its division ("04 00 00 Masonry", "05 00 00 Metals") has no
    // parentCostCode in JobTread, so nothing else can name that division. Jobs
    // code straight to these, and without this the header read "04 04".
    if (name && isDivisionLevelCode(number))
      divisionSelfNames.set(division, divisionSelfNames.get(division) ?? name);
    if (parentNumber) divisionNumbers.set(division, divisionNumbers.get(division) ?? parentNumber);
    let row = codes.get(number);
    if (!row) {
      row = {
        number,
        name,
        division,
        budget: 0,
        bills: 0,
        labor: 0,
        laborHours: 0,
        laborApproved: 0,
        laborApprovedHours: 0,
        invoiced: 0,
        currentInvoice: 0,
        split: emptySplit(),
        lines: [],
      };
      codes.set(number, row);
    }
    if (!row.name && name) row.name = name;
    return row;
  };

  for (const n of lineNodes) {
    const number = n?.costCode?.number?.toString().trim();
    if (!number) continue;
    // The deposit is shown on its own card, never as a budget row (DEPOSITS_PLAN.md).
    if (number === DEPOSIT_CSI) continue;
    if (/^uncategorized\b/i.test(String(n?.name ?? "").trim())) continue;
    const row = codeRow(
      number,
      n?.costCode?.name ?? "",
      n?.costCode?.parentCostCode?.name,
      n?.costCode?.parentCostCode?.number,
    );
    const cost = typeof n?.cost === "number" ? n.cost : 0;
    const isAllowance = n?.allowanceType != null;
    const costType = n?.costType?.name ?? undefined;
    row.budget += cost;
    row.split[splitKeyFor(costType, isAllowance)] += cost;
    row.lines.push({
      id: n.id,
      name: String(n?.name ?? "").trim(),
      description: n?.description ?? undefined,
      quantity: typeof n?.quantity === "number" ? n.quantity : undefined,
      unit: n?.unit?.name ?? undefined,
      unitCost: typeof n?.unitCost === "number" ? n.unitCost : undefined,
      cost,
      costType,
      isAllowance,
    });
  }

  // Actuals can land on a code that has no budget line (coded to something never
  // estimated) — those must still appear, or the totals won't tie out.
  for (const [number, amount] of Object.entries(bills)) {
    codeRow(number, "").bills += amount;
  }
  for (const [number, t] of Object.entries(time)) {
    const row = codeRow(number, "");
    row.labor += t.cost;
    row.laborHours += t.minutes / 60;
  }
  for (const [number, t] of Object.entries(timeApproved)) {
    const row = codeRow(number, "");
    row.laborApproved += t.cost;
    row.laborApprovedHours += t.minutes / 60;
  }
  // Deposit lines are not invoiced work: a −$20,000 draw is no credit against
  // any cost code. The deposit card shows them instead.
  for (const [number, amount] of Object.entries(invoiced)) {
    if (number === DEPOSIT_CSI) continue;
    codeRow(number, "").invoiced += amount;
  }
  for (const [number, amount] of Object.entries(currentInvoice)) {
    if (number === DEPOSIT_CSI) continue;
    codeRow(number, "").currentInvoice += amount;
  }

  const divisions = new Map<string, CostDivisionRow>();
  for (const row of codes.values()) {
    row.lines.sort((a, b) => a.name.localeCompare(b.name));
    let d = divisions.get(row.division);
    if (!d) {
      d = {
        division: row.division,
        name: divisionNameOf(row.division),
        budget: 0,
        bills: 0,
        labor: 0,
        laborHours: 0,
        laborApproved: 0,
        laborApprovedHours: 0,
        invoiced: 0,
        currentInvoice: 0,
        split: emptySplit(),
        codes: [],
      };
      divisions.set(row.division, d);
    }
    d.budget += row.budget;
    d.bills += row.bills;
    d.labor += row.labor;
    d.laborHours += row.laborHours;
    d.laborApproved += row.laborApproved;
    d.laborApprovedHours += row.laborApprovedHours;
    d.invoiced += row.invoiced;
    d.currentInvoice += row.currentInvoice;
    addSplit(d.split, row.split);
    d.codes.push(row);
  }

  const out = [...divisions.values()].sort((a, b) => a.division.localeCompare(b.division));
  for (const d of out) d.codes.sort((a, b) => a.number.localeCompare(b.number));

  return {
    divisions: out,
    budgetBasis,
    budgetTotal: out.reduce((s, d) => s + d.budget, 0),
    billsTotal: out.reduce((s, d) => s + d.bills, 0),
    laborTotal: out.reduce((s, d) => s + d.labor, 0),
    laborHoursTotal: out.reduce((s, d) => s + d.laborHours, 0),
    invoicedTotal: out.reduce((s, d) => s + d.invoiced, 0),
    currentInvoiceTotal: out.reduce((s, d) => s + d.currentInvoice, 0),
    currentInvoiceLabel,
    degraded,
  };
}

/** One vendor-bill line behind a cost code's "bills" total in getJobCostDetail. */
export interface CostCodeBillContributor {
  id: string; // costItemId — matches JobBillLine.id, so a staged (unsynced) recode can be reconciled
  docId: string;
  code: string; // costCode.number, so the client groups without a second fetch
  vendor: string;
  label: string; // invoice # / externalId, falling back to the vendor
  issueDate: string | null;
  status: string; // draft | pending | approved
  lineName: string;
  cost: number;
}

/** One time entry behind a cost code's "labor" total in getJobCostDetail. */
export interface CostCodeTimeContributor {
  id: string;
  code: string;
  employee: string;
  startedAt: string | null;
  hours: number;
  cost: number;
  notes: string;
  isApproved: boolean;
}

export interface JobCostContributors {
  bills: CostCodeBillContributor[];
  time: CostCodeTimeContributor[];
}

/**
 * Every individual vendor-bill line and time entry behind getJobCostDetail's
 * per-code "bills" and "labor" totals — that function only ever returns the
 * sum (`_sumCostByCostCode` / `_sumTimeByCostCode` group server-side), so this
 * is what the Invoicing board's cost-code rail drills into on a click.
 *
 * Bills reuse the exact CTC_ACTUAL_WHERE predicate the totals are built from,
 * fetched at line granularity instead of grouped, with the same document
 * identity fields `getJobBillsForMonth` already reads (account/fromName,
 * externalId/number/subject, issueDate, status) — no new field, just a new
 * combination of already-confirmed ones. Time entries reuse the exact
 * unfiltered node shape `getUninvoicedBills` already fetches for the whole
 * job; grouping by cost code happens here instead of by month there.
 *
 * Fetched once per job (not once per code — the whole job's contributors come
 * back together and the client slices by `code`), and cached alongside
 * budget/CTC/costDetail at JOB_COST_TTL_MS, cleared by clearJobCostCaches().
 */
export function getJobCostContributors(
  cfg: PaveConfig,
  jobId: string,
): Promise<JobCostContributors> {
  return cachedRef(_jobCostKey("contributors", cfg.orgId, jobId), JOB_COST_TTL_MS, () =>
    _getJobCostContributorsUncached(cfg, jobId),
  );
}
export async function _getJobCostContributorsUncached(
  cfg: PaveConfig,
  jobId: string,
): Promise<JobCostContributors> {
  const billNodes = await pageAll<any>(cfg, {
    label: "job.costItems (bill contributors)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        costItems: {
          $: { where: CTC_ACTUAL_WHERE, ...args },
          nextPage: {},
          nodes: {
            id: {},
            name: {},
            cost: {},
            costCode: { number: {} },
            document: {
              id: {},
              status: {},
              issueDate: {},
              createdAt: {},
              externalId: {},
              number: {},
              subject: {},
              fromName: {},
              account: { name: {} },
            },
          },
        },
      },
    }),
    pick: (r) => r?.job?.costItems,
  });

  const timeNodes = await pageAll<any>(cfg, {
    label: "job.timeEntries (labor contributors)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        timeEntries: {
          $: args,
          nextPage: {},
          nodes: {
            id: {},
            cost: {},
            startedAt: {},
            minutes: {},
            notes: {},
            isApproved: {},
            user: { name: {} },
            costItem: { costCode: { number: {} } },
          },
        },
      },
    }),
    pick: (r) => r?.job?.timeEntries,
  });

  const bills: CostCodeBillContributor[] = billNodes
    .map((n) => {
      const d = n.document ?? {};
      const vendor = String(d?.account?.name ?? d?.fromName ?? "").trim() || "Unknown vendor";
      const ref = String(d?.externalId ?? d?.number ?? "").trim();
      return {
        id: n.id,
        docId: d.id,
        code: String(n?.costCode?.number ?? "").trim(),
        vendor,
        label: ref ? `${vendor} · ${ref}` : String(d?.subject ?? "").trim() || vendor,
        issueDate: d.issueDate ?? null,
        status: d.status ?? "",
        lineName: String(n?.name ?? "").trim(),
        cost: typeof n?.cost === "number" ? n.cost : 0,
      };
    })
    .filter((b) => b.code)
    .sort(
      (a, b) =>
        String(b.issueDate ?? "").localeCompare(String(a.issueDate ?? "")) || b.cost - a.cost,
    );

  const time: CostCodeTimeContributor[] = timeNodes
    .map((n) => ({
      id: n.id,
      code: String(n?.costItem?.costCode?.number ?? "").trim(),
      employee: n?.user?.name ?? "Unknown",
      startedAt: n.startedAt ?? null,
      hours: (n.minutes ?? 0) / 60,
      cost: typeof n?.cost === "number" ? n.cost : 0,
      notes: String(n?.notes ?? "").trim(),
      isApproved: Boolean(n?.isApproved),
    }))
    .filter((t) => t.code)
    .sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")));

  return { bills, time };
}

/** A bill as the coding board lists it — no CSI rollup, that comes from its lines. */
export interface MonthBill {
  id: string;
  label: string; // invoice # / externalId, falling back to the vendor
  /** Vendor Bill Number (JobTread externalId) — the invoice/bill number, editable
   *  in the board's Filing card. Null when the bill carries none. */
  externalId: string | null;
  /** JobTread's own document number, shown as the placeholder when there's no externalId. */
  number: string | null;
  vendor: string;
  cost: number;
  status: string; // draft | pending | approved
  issueDate: string | null;
  /** JobTread's "Payment Due" — when the vendor's invoice is due. Null when the
   *  bill runs on net terms (`dueDays`) instead. */
  dueDate: string | null;
  /** Net terms in days, set only when there is no explicit due date. */
  dueDays: number | null;
  /** When the bill was created in JobTread — newest-first is the board's order. */
  createdAt: string | null;
  /** "Bill" (payable, approves to pending) or "Expense" (already paid, approves to approved). */
  name: string;
  /** Legacy document tax field — non-zero only on a bill pushed before
   *  2026-09-05. A bill's real sales tax is its 88 80 00 line plus this. */
  nonRecoverableTax: number;
  /** Is JobTread's "Record Tax" toggle ON? Stored as `nonRecoverableTaxName` — a
   *  name means the bill shows a document tax row, null means the row is off.
   *  Under the 2026-09-05 model that row must not exist (src/lib/salesTax.ts), so
   *  a save turns it back off. */
  recordsTax: boolean;
  /** false = this bill will sync to QuickBooks on approval. */
  qboIsIgnored: boolean;
  /** QuickBooks "Push as": "bill" | "purchase" (Expense) | null (Bill). Read with
   *  `name` through `isExpenseDoc`. */
  qboDocumentType: string | null;
  /** Already on a customer invoice — the board renders these read-only. */
  invoiced: boolean;
  /** On a customer invoice of ANY status but denied — draft included. Wider
   *  than `invoiced`; see `_isOnAnyInvoice` for why the two differ. */
  onInvoice: boolean;
  /** Does an invoice exist for this job + month at all? Derived from the WHOLE
   *  month's bills before `includeInvoiced` filters any out, so it stays true
   *  in a month whose invoice already went out. Same for every row in one
   *  response — carried per bill so the row can decide its own state. */
  monthInvoiceExists: boolean;
  /** Attached files (the scanned invoice) — 0 means nothing to review against. */
  fileCount: number;
  /** Money recorded against the bill. Computed by JobTread from QuickBooks (see
   *  setBillStatus) — not settable here. A draft reads 0 / 0, so `balance === 0`
   *  alone does NOT mean paid; `billPaidState` reads the pair together. */
  amountPaid: number;
  /** Still owed on the bill: cost − amountPaid. */
  balance: number;
}

/**
 * The job's vendor bills whose Invoice Date falls in one month, excluding any
 * already on a customer invoice.
 *
 * `getUninvoicedBills` answers a bigger question (it also walks time entries and
 * the job's whole flat costItems connection to build a per-bill CSI rollup), and
 * the board needs neither: it derives per-code amounts from getBillLinesForJob,
 * which carries strictly more detail. Calling that here meant paying for the same
 * cost-item walk twice — measured 4.8 s for one board load.
 *
 * The month filter runs SERVER-side. Confirmed live 2026-08-05: the `>=` / `<=`
 * comparison operators work on `issueDate`, returning Otis Perkins' 43 July bills
 * in ONE page / 363 ms where the unnarrowed status-only walk needed 7 pages.
 * Falls back to the unnarrowed walk + in-script date filter if that form is ever
 * rejected. Page size stays 25 because `referencedDocuments` nested in a paged
 * documents connection 413s above that (the same reason getUninvoicedBills uses 25).
 *
 * NOTE the billing month here is simply the month of the bill's Invoice Date. The
 * 10th-of-the-month rule is an INGESTION convention (`deriveBillingPeriod`) that
 * decides which issueDate a newly-arrived bill is given — it is not a filter.
 *
 * `includeInvoiced` widens the list to a past, fully-invoiced month for VIEWING
 * (the Tracking Sheets board otherwise goes empty next to its own "Reconciled"
 * badge). Recoding an already-invoiced bill would change numbers already sent
 * to the client, so the board renders those bills read-only rather than gating
 * them out of the query entirely.
 */
export async function getJobBillsForMonth(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
  includeDrafts: boolean,
  includeInvoiced = false,
): Promise<MonthBill[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const statuses = includeDrafts ? ["draft", "pending", "approved"] : ["pending", "approved"];

  const walk = (where: unknown): Promise<any[]> =>
    pageAll<any>(cfg, {
      label: "job.documents (the month's bills)",
      size: 25,
      query: (args) => ({
        job: {
          $: { id: jobId },
          documents: {
            $: { where, ...args },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              subject: {},
              externalId: {},
              number: {},
              fromName: {},
              cost: {},
              issueDate: {},
              dueDate: {},
              dueDays: {},
              createdAt: {},
              status: {},
              nonRecoverableTax: {},
              nonRecoverableTaxName: {},
              qboIsIgnored: {},
              qboDocumentType: {},
              amountPaid: {},
              balance: {},
              account: { name: {} },
              referencedDocuments: { nodes: { type: {}, status: {} } },
              files: { count: {} },
            },
          },
        },
      }),
      pick: (r) => r?.job?.documents,
    });

  let nodes: any[];
  try {
    nodes = await walk({
      and: [
        { "=": [{ field: "type" }, { value: "vendorBill" }] },
        { in: [{ field: "status" }, statuses.map((v) => ({ value: v }))] },
        { ">=": [{ field: "issueDate" }, { value: first }] },
        { "<=": [{ field: "issueDate" }, { value: last }] },
      ],
    });
  } catch (e) {
    // The expression-tree filter was rejected — retry with the tuple form. Too
    // much data is not a rejected filter, and the wider fallback (no date bound
    // at all) would only overflow harder.
    if (e instanceof PaveTooManyPagesError) throw e;
    nodes = await walk({
      and: [
        ["type", "vendorBill"],
        ["status", "in", statuses],
      ],
    });
  }

  const inMonth = (d?: string) => {
    const s = String(d ?? "").slice(0, 10);
    return s >= first && s <= last;
  };
  const isInvoiced = _isInvoicedToClient;
  // Computed BEFORE the includeInvoiced filter: once an invoice has gone out
  // its bills drop from the list, and asking the surviving rows whether the
  // month has an invoice would then always answer no — the exact case the
  // "left off the invoice" stripe exists to catch.
  const monthInvoiceExists = nodes.some((b) => inMonth(b.issueDate) && _isOnAnyInvoice(b));

  return (
    nodes
      .filter((b) => inMonth(b.issueDate) && (includeInvoiced || !isInvoiced(b)))
      .map((b) => {
        const vendor = String(b?.account?.name ?? b?.fromName ?? "").trim() || "Unknown vendor";
        const ref = String(b?.externalId ?? b?.number ?? "").trim();
        // Only Sunset bills show their invoice id: a Sunset statement is a stack
        // of many small invoices, so the invoice # is how you tell them apart.
        // Every other vendor is shown by name alone.
        const isSunset = /sunset/i.test(vendor);
        return {
          id: b.id,
          label: ref && isSunset ? `${vendor} · ${ref}` : vendor,
          externalId: b?.externalId ? String(b.externalId) : null,
          number: b?.number != null ? String(b.number) : null,
          vendor,
          cost: typeof b?.cost === "number" ? b.cost : 0,
          status: b?.status ?? "",
          issueDate: b?.issueDate ?? null,
          dueDate: b?.dueDate ? String(b.dueDate).slice(0, 10) : null,
          dueDays: typeof b?.dueDays === "number" ? b.dueDays : null,
          createdAt: b?.createdAt ?? null,
          name: b?.name ?? "Bill",
          nonRecoverableTax: typeof b?.nonRecoverableTax === "number" ? b.nonRecoverableTax : 0,
          recordsTax: b?.nonRecoverableTaxName != null,
          qboIsIgnored: !!b?.qboIsIgnored,
          qboDocumentType: b?.qboDocumentType ?? null,
          invoiced: isInvoiced(b),
          onInvoice: _isOnAnyInvoice(b),
          monthInvoiceExists,
          fileCount: typeof b?.files?.count === "number" ? b.files.count : 0,
          amountPaid: typeof b?.amountPaid === "number" ? b.amountPaid : 0,
          balance: typeof b?.balance === "number" ? b.balance : 0,
        };
      })
      // Newest first: the board is worked as bills arrive, so the ones that just
      // landed are the ones still needing coding. Falls back to issueDate then
      // cost so an older record with no createdAt still sorts predictably.
      .sort(
        (a, b) =>
          String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) ||
          String(b.issueDate ?? "").localeCompare(String(a.issueDate ?? "")) ||
          b.cost - a.cost,
      )
  );
}

/** One time entry, for the Bills list's "Time & labor" block. */
export interface MonthTimeEntry {
  id: string;
  employee: string;
  /**
   * The JobTread USER id behind `employee` — the same id JobTread's time page
   * filters on. Carried so a link out can open one person's entries rather
   * than the whole job's; a name cannot do that. "" when JT reports no user.
   */
  userId: string;
  startedAt: string | null;
  hours: number;
  cost: number;
  code: string;
  codeName: string;
  notes: string;
  isApproved: boolean;
  /**
   * The budget leaf this entry is coded to — the SAME `jobCostItemId` a bill
   * line points at, and what Labor Review re-points to recode the entry. Null
   * on an entry JobTread has no cost item for.
   */
  costItemId: string | null;
  /** The pay type (rate) the entry was logged under, e.g. "Regular Pay". */
  type: string;
  /**
   * The clock-out instant, null on an entry still running. Carried so an
   * editing surface can show — and rewrite — the actual window worked rather
   * than only the duration JobTread derived from it.
   */
  endedAt: string | null;
  /**
   * JobTread's OWN minute count. Usually endedAt − startedAt, but not always:
   * a break deduction makes it smaller. `hours` is this figure, not the span,
   * so an editor that rewrites the span must expect JobTread to recompute.
   */
  minutes: number;
  /**
   * The hourly rate STORED ON THE ENTRY — what `cost` was actually computed
   * from, and not necessarily what the person's pay type carries today.
   *
   * JobTread snapshots the rate when the entry is written and never revisits
   * it: probe-confirmed 2026-09-02, where two people's entries stayed at $65
   * for weeks after their membership was raised to $75, and one pay-type name
   * held two different rates inside a single month. Read this, never a rate
   * looked up live, when explaining a cost.
   */
  hourlyRate: number;
  /**
   * The non-denied customerInvoice ids this entry references (any status,
   * draft included) — the SAME "linked" question `referencedDocuments`
   * answers for a vendor bill, kept as raw ids rather than resolved so a
   * caller decides for itself what "invoiced" means for its own purpose (a
   * draft counts for some questions and not others — see
   * `invoiceReview/evidence.ts`).
   */
  invoiceIds: string[];
}

/**
 * A job's time entries whose startedAt falls in one month — labor shown
 * alongside the vendor bills it'll be invoiced next to, instead of only
 * living in the cost-code rail's total.
 *
 * The `startedAt` range narrows server-side — confirmed live 2026-08-06 on
 * job.timeEntries (same field, same `{and:[[path,op,value],...]}` shape
 * `getJobBillsForMonth` already uses for issueDate): an out-of-range window
 * came back empty, an in-range one didn't. Falls back to an unnarrowed walk +
 * client-side filter, the same safety net every other month-scoped query here
 * uses, if that shape is ever rejected.
 */
export async function getJobTimeEntriesForMonth(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
): Promise<MonthTimeEntry[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const inMonth = (d?: string | null) => {
    const s = String(d ?? "").slice(0, 10);
    return s >= first && s <= last;
  };

  const walk = (where: unknown): Promise<any[]> =>
    pageAll<any>(cfg, {
      label: "job.timeEntries (the month's entries)",
      // 50, not 100: referencedDocuments nested in a paged timeEntries
      // connection 413s at 100 (probed 2026-09-03, same rule getUninvoicedBills
      // and getInvoiceReconciliation already follow for this connection).
      size: 50,
      query: (args) => ({
        job: {
          $: { id: jobId },
          id: {},
          timeEntries: {
            $: { ...(where ? { where } : {}), ...args },
            nextPage: {},
            nodes: {
              id: {},
              cost: {},
              hourlyRate: {},
              startedAt: {},
              minutes: {},
              endedAt: {},
              notes: {},
              isApproved: {},
              type: {},
              user: { id: {}, name: {} },
              costItem: { id: {}, costCode: { number: {}, name: {} } },
              referencedDocuments: { nodes: { id: {}, type: {}, status: {} } },
            },
          },
        },
      }),
      pick: (r) => r?.job?.timeEntries,
    });

  let nodes: any[];
  try {
    nodes = await walk({
      and: [
        ["startedAt", ">=", first],
        ["startedAt", "<=", `${last}T23:59:59`],
      ],
    });
  } catch (e) {
    // Date filter rejected — fall back to the whole job, filtered here. Too much
    // data is not a rejected filter, and the unbounded walk would overflow too.
    if (e instanceof PaveTooManyPagesError) throw e;
    nodes = (await walk(undefined)).filter((n) => inMonth(n?.startedAt));
  }

  return nodes
    .filter((n) => inMonth(n?.startedAt))
    .map((n) => ({
      id: n.id,
      employee: n?.user?.name ?? "Unknown",
      userId: n?.user?.id ?? "",
      startedAt: n.startedAt ?? null,
      hours: (n.minutes ?? 0) / 60,
      cost: typeof n?.cost === "number" ? n.cost : 0,
      code: n?.costItem?.costCode?.number?.toString().trim() ?? "",
      codeName: n?.costItem?.costCode?.name ?? "",
      notes: String(n?.notes ?? "").trim(),
      isApproved: Boolean(n?.isApproved),
      costItemId: n?.costItem?.id ?? null,
      type: String(n?.type ?? "").trim(),
      endedAt: n.endedAt ?? null,
      minutes: typeof n?.minutes === "number" ? n.minutes : 0,
      hourlyRate: typeof n?.hourlyRate === "number" ? n.hourlyRate : 0,
      invoiceIds: ((n?.referencedDocuments?.nodes ?? []) as any[])
        .filter((ref) => ref?.type === "customerInvoice" && ref?.status !== "denied" && ref?.id)
        .map((ref) => ref.id as string),
    }))
    .sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")));
}

/**
 * One org-wide time entry for the monthly Labor Report — a MonthTimeEntry plus
 * the job it belongs to, because this pull spans every job at once.
 */
export interface OrgMonthTimeEntry extends MonthTimeEntry {
  /** JobTread's user email address — the QuickBooks Time `username` column. */
  username: string;
  jobId: string;
  jobName: string;
  customer: string;
}

/**
 * EVERY job's time entries for one month, for the monthly Labor Report.
 *
 * The org-wide twin of getJobTimeEntriesForMonth. It reads
 * `organization.timeEntries` — the same connection, one level up — so the report
 * covers labor logged against jobs nobody opened in Labor Review, which is the
 * whole point of a company-wide report.
 *
 * TWO PHASES, on purpose. The entry nodes carry only `job { id }`; the job's
 * customer comes from the already-cached getJobs() and is joined by id here.
 * Nesting `job { location { account { name } } }` inside a paged connection is
 * the 413 rule in JT_API_REFERENCE.md, and getJobs is a cached read this page
 * would very likely have warmed anyway.
 *
 * Closed jobs are included in that join (`getJobs(cfg, true)`): a job closed in
 * August still has July labor, and dropping it would silently shorten the month.
 *
 * It THROWS rather than returning a short month — see the walk below. The
 * report this feeds is what payroll reads, so "fewer rows than JobTread holds"
 * is the one answer it must never quietly give.
 */
export async function getOrgTimeEntriesForMonth(
  cfg: PaveConfig,
  year: number,
  month: number,
): Promise<OrgMonthTimeEntry[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const inMonth = (d?: string | null) => {
    const s = String(d ?? "").slice(0, 10);
    return s >= first && s <= last;
  };

  const walk = (where: unknown): Promise<any[]> =>
    pageAll<any>(cfg, {
      label: `organization.timeEntries in ${first.slice(0, 7)}`,
      // 200 pages × 100 = 20,000 entries. A month has run a few hundred, so this
      // is a runaway guard, not a limit — and pageAll THROWS on reaching it,
      // because a SILENTLY short month is the one failure a payroll report must
      // never have.
      maxPages: 200,
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          timeEntries: {
            $: { ...(where ? { where } : {}), ...args },
            nextPage: {},
            nodes: {
              id: {},
              cost: {},
              startedAt: {},
              endedAt: {},
              minutes: {},
              hourlyRate: {},
              notes: {},
              isApproved: {},
              type: {},
              user: { id: {}, name: {}, emailAddress: {} },
              job: { id: {} },
              costItem: { id: {}, costCode: { number: {}, name: {} } },
            },
          },
        },
      }),
      pick: (r) => r?.organization?.timeEntries,
    });

  // NO UNNARROWED FALLBACK, unlike the per-job twin above. One job's whole
  // history fits in a client-side filter; the ORG's does not, so a fallback
  // walk would hit the page cap somewhere in 2024 and hand back a month that
  // looks empty. If the narrowing shape is ever rejected, say so and stop.
  const nodes = await walk({
    and: [
      ["startedAt", ">=", first],
      ["startedAt", "<=", `${last}T23:59:59`],
    ],
  }).catch((e) => {
    // Too many rows is its own answer and already says so. Anything else here
    // means the filter shape was refused.
    if (e instanceof PaveTooManyPagesError) throw e;
    throw new Error(
      `JobTread rejected the month filter on organization.timeEntries (${
        e instanceof Error ? e.message : String(e)
      }).`,
    );
  });

  const jobs = await getJobs(cfg, true);
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  return nodes
    .filter((n) => inMonth(n?.startedAt))
    .map((n) => {
      const job = n?.job?.id ? jobById.get(n.job.id) : undefined;
      return {
        id: n.id,
        employee: n?.user?.name ?? "Unknown",
        userId: n?.user?.id ?? "",
        username: String(n?.user?.emailAddress ?? "").trim(),
        startedAt: n.startedAt ?? null,
        hours: (n.minutes ?? 0) / 60,
        cost: typeof n?.cost === "number" ? n.cost : 0,
        code: n?.costItem?.costCode?.number?.toString().trim() ?? "",
        codeName: n?.costItem?.costCode?.name ?? "",
        notes: String(n?.notes ?? "").trim(),
        isApproved: Boolean(n?.isApproved),
        costItemId: n?.costItem?.id ?? null,
        type: String(n?.type ?? "").trim(),
        endedAt: n.endedAt ?? null,
        minutes: typeof n?.minutes === "number" ? n.minutes : 0,
        hourlyRate: typeof n?.hourlyRate === "number" ? n.hourlyRate : 0,
        // Not read for the Labor Report — this query doesn't select
        // referencedDocuments (an org-wide connection is the wrong place to
        // add a second paged connection nested inside it), so this stays
        // empty rather than silently wrong.
        invoiceIds: [] as string[],
        jobId: n?.job?.id ?? "",
        jobName: job?.name ?? "",
        customer: job?.customer ?? "",
      };
    })
    .sort(
      (a, b) =>
        (a.employee ?? "").localeCompare(b.employee ?? "") ||
        String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")),
    );
}

/** One vendor-bill line, with the coding target the Invoicing board moves it between. */
export interface JobBillLine {
  id: string; // costItemId — what updateLine() edits
  docId: string; // the bill this line belongs to
  billStatus: string; // draft | pending | approved — draft cost isn't committed yet
  name: string;
  cost: number;
  quantity?: number;
  unitCost?: number;
  code: string; // costCode.number — always tracks jobCostItem's code (verified, see below)
  codeName: string;
  jobCostItemId: string | null; // the budget leaf it codes to; null = uncoded
}

/**
 * Every line on the given bills, in ONE query instead of one `getBillDetail` per
 * bill (30 bills would be 30 round trips).
 *
 * Confirmed live 2026-08-05 across 4 jobs / 793 vendor-bill cost items: a line's
 * `costCode` ALWAYS equals its `jobCostItem`'s cost code — zero mismatches. So
 * JobTread derives the line's code from its coding target, which is what makes
 * `updateLine({ jobCostItemId })` a complete recode with no second write.
 *
 * The document-id narrowing runs server-side; if that `where` shape is ever
 * rejected we fall back to walking the job's vendor-bill lines and filtering here,
 * so the board can't come up empty.
 */
export async function getBillLinesForJob(
  cfg: PaveConfig,
  jobId: string,
  docIds: string[],
): Promise<JobBillLine[]> {
  const wanted = new Set(docIds);
  if (wanted.size === 0) return [];

  const walk = (where: unknown): Promise<any[]> =>
    pageAll<any>(cfg, {
      label: "job.costItems (bill lines)",
      query: (args) => ({
        job: {
          $: { id: jobId },
          id: {},
          costItems: {
            $: { where, ...args },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              cost: {},
              quantity: {},
              unitCost: {},
              document: { id: {}, status: {} },
              costCode: { number: {}, name: {} },
              jobCostItem: { id: {} },
            },
          },
        },
      }),
      pick: (r) => r?.job?.costItems,
    });

  let nodes: any[];
  try {
    nodes = await walk({
      in: [{ field: ["document", "id"] }, [...wanted].map((v) => ({ value: v }))],
    });
  } catch (e) {
    // The `in` filter was rejected — fall back to every vendor-bill line on the
    // job. Too much data is not a rejected filter; the wider walk is worse.
    if (e instanceof PaveTooManyPagesError) throw e;
    nodes = await walk([["document", "type"], "vendorBill"]);
  }

  return nodes
    .filter((n) => n?.document?.id && wanted.has(n.document.id))
    .map((n) => ({
      id: n.id,
      docId: n.document.id,
      billStatus: n.document.status ?? "",
      name: String(n?.name ?? "").trim(),
      cost: typeof n?.cost === "number" ? n.cost : 0,
      quantity: typeof n?.quantity === "number" ? n.quantity : undefined,
      unitCost: typeof n?.unitCost === "number" ? n.unitCost : undefined,
      code: n?.costCode?.number?.toString().trim() ?? "",
      codeName: n?.costCode?.name ?? "",
      jobCostItemId: n?.jobCostItem?.id ?? null,
    }));
}

export interface JobRef {
  id: string;
  name: string;
  number?: string;
  customer?: string; // job.location.account.name
  address?: string; // job.location.formattedAddress (Google-normalized)
  // job.location.latitude/longitude — Google's geocode of that address, which
  // JobTread stores when the location is created. Null on a job whose address
  // never resolved, so every distance check has to tolerate a missing pair.
  lat?: number | null;
  lng?: number | null;
  closedOn?: string | null;
}

/** Org's jobs for the picker. Open jobs only by default, sorted by customer/name. */
export function getJobs(cfg: PaveConfig, includeClosed = false): Promise<JobRef[]> {
  return cachedRef(`jobs:${cfg.orgId}:${includeClosed}`, 5 * 60_000, () =>
    _getJobsUncached(cfg, includeClosed),
  );
}
export async function _getJobsUncached(cfg: PaveConfig, includeClosed = false): Promise<JobRef[]> {
  const out: JobRef[] = [];
  await pageEach<any>(
    cfg,
    {
      label: "organization.jobs",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          jobs: {
            $: args,
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              number: {},
              closedOn: {},
              location: {
                account: { name: {} },
                formattedAddress: {},
                latitude: {},
                longitude: {},
              },
            },
          },
        },
      }),
      pick: (r) => r?.organization?.jobs,
    },
    (rows) => {
      for (const n of rows) {
        if (!includeClosed && n.closedOn) continue;
        out.push({
          id: n.id,
          name: n.name,
          number: n.number,
          customer: n.location?.account?.name ?? "",
          address: n.location?.formattedAddress ?? "",
          lat: typeof n.location?.latitude === "number" ? n.location.latitude : null,
          lng: typeof n.location?.longitude === "number" ? n.location.longitude : null,
          closedOn: n.closedOn,
        });
      }
    },
  );
  return out.sort(
    (a, b) =>
      (a.customer ?? "").localeCompare(b.customer ?? "") ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

/**
 * The open jobs one JobTread user is ADDED to — on the job's member list in
 * JobTread (job.aces → membership.user). The time clock lists only these.
 *
 * Every open job adds its people by name, none by role (checked live
 * 2026-10-17), so a membership match is the whole test.
 *
 * One aliased count per job, filtered to this user. Fetching each job's full
 * member list inside the paged jobs connection returns HTTP 413 (the 413 rule
 * in JT_API_REFERENCE.md); a filtered count does not.
 */
export function getUserJobIds(cfg: PaveConfig, userId: string): Promise<Set<string>> {
  return cachedRef(`userjobs:${cfg.orgId}:${userId}`, 5 * 60_000, () => _getUserJobIdsUncached(cfg, userId));
}
export async function _getUserJobIdsUncached(cfg: PaveConfig, userId: string): Promise<Set<string>> {
  const out = new Set<string>();
  await pageEach<any>(
    cfg,
    {
      label: "organization.jobs (user membership)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          jobs: {
            $: { ...args, where: { "=": [{ field: ["closedOn"] }, { value: null }] } },
            nextPage: {},
            nodes: {
              id: {},
              mine: {
                _: "aces",
                $: { where: { "=": [{ field: ["membership", "user", "id"] }, { value: userId }] } },
                count: {},
              },
            },
          },
        },
      }),
      pick: (r) => r?.organization?.jobs,
    },
    (rows) => {
      for (const n of rows) if ((n?.mine?.count ?? 0) > 0) out.add(n.id);
    },
  );
  return out;
}

/**
 * jobId → the job's "Phase" custom-field value, for the /jobs filter.
 *
 * Two phases on purpose: nesting `customFieldValues` inside the paged
 * organization.jobs connection returns HTTP 413 (the 413 rule in
 * JT_API_REFERENCE.md), so we look the field up once by name and then page its
 * values, each of which carries the job it belongs to. Same shape the Apps
 * Script project sync uses (`_jtProjCf(job, "Phase")`, JobTread.js).
 *
 * Cached at the same 5 min as `getJobs` — the two are always read together and a
 * Phase is a human edit in JobTread, not something the Companion writes.
 */
export function getJobPhaseMap(cfg: PaveConfig): Promise<Record<string, string>> {
  return cachedRef(`jobphase:${cfg.orgId}`, 5 * 60_000, () => _getJobPhaseMapUncached(cfg));
}
export async function _getJobPhaseMapUncached(cfg: PaveConfig): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  const cf = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      id: {},
      customFields: { $: { size: 100 }, nodes: { id: {}, name: {}, targetType: {} } },
    },
  });
  const fields: any[] = cf?.organization?.customFields?.nodes ?? [];
  const field =
    fields.find((f) => f?.name === "Phase" && f?.targetType === "job") ??
    fields.find((f) => f?.name === "Phase");
  if (!field?.id) return out; // no Phase field configured — the filter just shows nothing to filter on

  await pageEach<any>(
    cfg,
    {
      label: "customField.customFieldValues (job Phase)",
      query: (args) => ({
        customField: {
          $: { id: field.id },
          id: {},
          customFieldValues: { $: args, nextPage: {}, nodes: { value: {}, job: { id: {} } } },
        },
      }),
      pick: (r) => r?.customField?.customFieldValues,
    },
    (rows) => {
      for (const n of rows) {
        const jobId = n?.job?.id;
        if (!jobId || n?.value == null) continue;
        const v = typeof n.value === "string" ? n.value : String(n.value);
        if (v.trim()) out[jobId] = v.trim();
      }
    },
  );
  return out;
}
