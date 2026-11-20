// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import type { ByCode, ClientBudgetInputs } from "@/lib/clientBudget";
import { pageEach, type PaveConfig } from "./core";
import { CTC_BUDGET_WHERE } from "./codingQueue";
import { _sumTimeByCostCode, getJobCostDetail, getJobs } from "./jobCostDetail";

// ---------------------------------------------------------------------------
// CLIENT BUDGET REPORT — the per-code sums behind /client-budget. Read only.
// Math: src/lib/clientBudget.ts.
// ---------------------------------------------------------------------------

/** Σ cost and Σ price per cost-code number over the cost items matching `where`, summed by JobTread. */
async function _sumCostAndPriceByCode(
  cfg: PaveConfig,
  jobId: string,
  where: unknown,
): Promise<{ cost: ByCode; price: ByCode }> {
  const cost: ByCode = {};
  const price: ByCode = {};
  await pageEach<any>(
    cfg,
    {
      label: "job.costItems cost + price grouped by cost code",
      query: (args) => ({
        job: {
          $: { id: jobId },
          id: {},
          costItems: {
            $: {
              where,
              group: {
                by: [["costCode", "number"]],
                aggs: { cost: { sum: "cost" }, price: { sum: "price" } },
              },
              ...args,
            },
            withValues: {},
            nextPage: {},
          },
        },
      }),
      pick: (r) => r?.job?.costItems,
    },
    (rows) => {
      for (const row of rows) {
        const code = row?.costCode?.number?.toString().trim();
        if (!code) continue;
        cost[code] = (cost[code] ?? 0) + (row.cost ?? 0);
        price[code] = (price[code] ?? 0) + (row.price ?? 0);
      }
    },
  );
  return { cost, price };
}

export interface ClientBudgetRead {
  inputs: ClientBudgetInputs;
  jobName: string;
  customer: string;
  budgetBasis: "customerOrders" | "budgetLeaves";
}

/**
 * Everything the client budget report needs for one job, THROUGH the end of
 * `year`-`month`:
 * - budget: approved, includeInBudget customer-order lines (cost and price) —
 *   the same basis as getJobCostDetail, falling back to the estimate's budget
 *   leaves when the job has no approved order;
 * - billed: client-invoice lines dated on or before month end, draft included
 *   (the report goes out with that month's invoice, which is dated the month's
 *   last day — `billingMonthEnd`); denied invoices never count;
 * - cost: pending + approved vendor bills dated on or before month end, plus
 *   time entries started on or before it.
 * Names come from the cached getJobCostDetail.
 */
export async function getClientBudgetInputs(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
): Promise<ClientBudgetRead> {
  const mm = String(month).padStart(2, "0");
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const [orders, invoiced, bills, time, detail, jobs] = await Promise.all([
    _sumCostAndPriceByCode(cfg, jobId, CTC_BUDGET_WHERE),
    _sumCostAndPriceByCode(cfg, jobId, {
      and: [
        [["document", "type"], "customerInvoice"],
        [["document", "status"], "in", ["draft", "pending", "approved"]],
        [["document", "issueDate"], "<=", last],
      ],
    }),
    _sumCostAndPriceByCode(cfg, jobId, {
      and: [
        [["document", "type"], "vendorBill"],
        [["document", "status"], "in", ["pending", "approved"]],
        [["document", "issueDate"], "<=", last],
      ],
    }),
    _sumTimeByCostCode(cfg, jobId, ["startedAt", "<=", `${last}T23:59:59`]),
    getJobCostDetail(cfg, jobId),
    getJobs(cfg, true),
  ]);

  let budget = orders;
  let budgetBasis: ClientBudgetRead["budgetBasis"] = "customerOrders";
  if (!Object.values(orders.cost).some(Boolean) && !Object.values(orders.price).some(Boolean)) {
    const leaves = await _sumCostAndPriceByCode(cfg, jobId, [["document", "id"], null]);
    if (Object.values(leaves.price).some(Boolean)) {
      budget = leaves;
      budgetBasis = "budgetLeaves";
    }
  }

  const codeNames: Record<string, string> = {};
  const divisionNames: Record<string, string> = {};
  for (const d of detail.divisions) {
    if (d.name) divisionNames[d.division] = d.name;
    for (const c of d.codes) if (c.name) codeNames[c.number] = c.name;
  }
  const job = jobs.find((j) => j.id === jobId);

  return {
    inputs: {
      budgetPrice: budget.price,
      budgetCost: budget.cost,
      billed: invoiced.price,
      bills: bills.cost,
      labor: Object.fromEntries(Object.entries(time).map(([k, v]) => [k, v.cost])),
      codeNames,
      divisionNames,
    },
    jobName: job?.name ?? "",
    customer: job?.customer ?? "",
    budgetBasis,
  };
}
