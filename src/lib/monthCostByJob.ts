import { pageEach, type PaveConfig } from "@/lib/jobtread";

/** One cost code's month on one job — the same shape the job workbench's
 *  cost rings take (CostDonutRow), so the all-jobs cards can draw them. */
export interface MonthCodeRow {
  code: string;
  name: string;
  bills: number;
  labor: number;
}

export interface MonthJobCost {
  jobId: string;
  jobName: string;
  customerName: string;
  bills: number;
  labor: number;
  /** The month's client invoices (sent: pending or approved), with tax, NET of
   *  any deposit applied to them. See monthInvoices below. */
  invoiced: number;
  /** The deposits applied to those invoices: negative CD (Contract Deposit)
   *  lines, plus payments received before the invoice was issued. */
  deposits: number;
  rows: MonthCodeRow[];
}

/**
 * Every job's cost by cost code for one billing month — the data behind the
 * per-job ring cards on Tracking Sheets with no job selected.
 *
 * The same cut the job workbench's month rings draw (monthRingRows): every
 * vendor-bill line issued in the month, draft and committed, invoiced or not;
 * plus every time entry started in the month. Two FLAT org-wide walks — lines
 * through `organization.costItems`, time through `organization.timeEntries` —
 * with nothing heavy nested, so they page at 100 and stay clear of the 413
 * rule. Probed 2026-10-02: September was 389 lines and 418 entries.
 *
 * Plus the month's client invoices per job (a third flat walk). Jobs with
 * neither cost nor an invoice in the month are absent.
 */
export async function getMonthCostByJob(
  cfg: PaveConfig,
  year: number,
  month: number,
): Promise<MonthJobCost[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const jobs = new Map<string, MonthJobCost & { byCode: Map<string, MonthCodeRow> }>();
  const jobFor = (job: any) => {
    let j = jobs.get(job.id);
    if (!j) {
      j = {
        jobId: job.id,
        jobName: job.name ?? "",
        customerName: job.location?.account?.name ?? "",
        bills: 0,
        labor: 0,
        invoiced: 0,
        deposits: 0,
        rows: [],
        byCode: new Map(),
      };
      jobs.set(job.id, j);
    }
    return j;
  };
  const add = (n: any, code: string, codeName: string, field: "bills" | "labor") => {
    if (!n?.job?.id || !code) return;
    const j = jobFor(n.job);
    let r = j.byCode.get(code);
    if (!r) j.byCode.set(code, (r = { code, name: codeName, bills: 0, labor: 0 }));
    const cost = Number(n.cost) || 0;
    r[field] += cost;
    j[field] += cost;
  };
  const jobNodes = { id: {}, name: {}, location: { account: { name: {} } } };

  await Promise.all([
    pageEach<any>(
      cfg,
      {
        label: "organization.costItems (the month's bill lines, all jobs)",
        query: (args) => ({
          organization: {
            $: { id: cfg.orgId },
            id: {},
            costItems: {
              $: {
                where: {
                  and: [
                    [["document", "type"], "=", "vendorBill"],
                    [["document", "status"], "in", ["draft", "pending", "approved"]],
                    [["document", "issueDate"], ">=", first],
                    [["document", "issueDate"], "<=", last],
                  ],
                },
                ...args,
              },
              nextPage: {},
              nodes: { cost: {}, job: jobNodes, costCode: { number: {}, name: {} } },
            },
          },
        }),
        pick: (r) => r?.organization?.costItems,
      },
      (rows) => {
        for (const n of rows)
          add(n, String(n?.costCode?.number ?? "").trim(), n?.costCode?.name ?? "", "bills");
      },
    ),
    pageEach<any>(
      cfg,
      {
        label: "organization.timeEntries (the month's time, all jobs)",
        query: (args) => ({
          organization: {
            $: { id: cfg.orgId },
            id: {},
            timeEntries: {
              $: {
                where: {
                  and: [
                    ["startedAt", ">=", first],
                    ["startedAt", "<=", `${last}T23:59:59`],
                  ],
                },
                ...args,
              },
              nextPage: {},
              nodes: { cost: {}, job: jobNodes, costItem: { costCode: { number: {}, name: {} } } },
            },
          },
        }),
        pick: (r) => r?.organization?.timeEntries,
      },
      (rows) => {
        for (const n of rows) {
          const cc = n?.costItem?.costCode;
          add(n, String(cc?.number ?? "").trim(), cc?.name ?? "", "labor");
        }
      },
    ),
    // The month's client invoices. An invoice belongs to the month when it holds
    // one of the month's bills; one holding no bills at all (a time-only or
    // fixed-price invoice — Otis Perkins #386, Aug 2026) belongs to the month it
    // was issued in. The issue date alone is wrong: through mid-2026 a month's
    // invoices were issued around the 10th of the NEXT month.
    // ponytail: a re-issue of a denied invoice references the original, not the
    // bills, so it falls back to its issue date. Walk the chain the way
    // getInvoiceReconciliation does if that ever lands in the wrong month.
    pageEach<any>(
      cfg,
      {
        label: "organization.documents (the month's client invoices, all jobs)",
        size: 25,
        query: (args) => ({
          organization: {
            $: { id: cfg.orgId },
            id: {},
            documents: {
              $: {
                where: {
                  and: [
                    ["type", "=", "customerInvoice"],
                    ["status", "in", ["pending", "approved"]],
                    ["issueDate", ">=", first],
                  ],
                },
                ...args,
              },
              nextPage: {},
              nodes: {
                issueDate: {},
                priceWithTax: {},
                job: jobNodes,
                monthBills: {
                  _: "referencedDocuments",
                  $: {
                    where: {
                      and: [
                        ["type", "=", "vendorBill"],
                        ["issueDate", ">=", first],
                        ["issueDate", "<=", last],
                      ],
                    },
                  },
                  count: {},
                },
                anyBills: {
                  _: "referencedDocuments",
                  $: { where: { and: [["type", "=", "vendorBill"]] } },
                  count: {},
                },
                // DEPOSIT_CSI (src/lib/deposits.ts) — the office's way to draw a deposit.
                cdDraws: {
                  _: "costItems",
                  $: { where: { and: [[["costCode", "number"], "=", "CD"], ["price", "<", 0]] } },
                  priceSum: { _: "sum", $: "price" },
                },
                documentPayments: { nodes: { amount: {}, payment: { paidAt: {} } } },
              },
            },
          },
        }),
        pick: (r) => r?.organization?.documents,
      },
      (rows) => {
        for (const n of rows) {
          if (!n?.job?.id) continue;
          const issued = String(n.issueDate ?? "").slice(0, 10);
          const inMonth =
            n.monthBills?.count > 0 || (!(n.anyBills?.count > 0) && issued <= last);
          if (!inMonth) continue;
          // A deposit reaches an invoice two ways. A CD draw line already lowers
          // the invoice's price (Bunkhouse #320, -$20,000). A payment received
          // before the invoice existed, then applied to it (Beach Shack's
          // PreConstruction Retainer, paid in May, on #39 in September), does
          // not, so it comes off here. Later payments are the client paying the
          // invoice, and stay in the total.
          const drawn = -(Number(n.cdDraws?.priceSum) || 0);
          const prepaid = ((n.documentPayments?.nodes ?? []) as any[])
            .filter((p) => String(p.payment?.paidAt ?? "").slice(0, 10) < issued)
            .reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const j = jobFor(n.job);
          j.invoiced += (Number(n.priceWithTax) || 0) - prepaid;
          j.deposits += drawn + prepaid;
        }
      },
    ),
  ]);

  return [...jobs.values()]
    .map(({ byCode, ...j }) => ({
      ...j,
      rows: [...byCode.values()].filter((r) => r.bills !== 0 || r.labor !== 0),
    }))
    .filter((j) => j.rows.length > 0 || j.invoiced !== 0 || j.deposits !== 0)
    .sort((a, b) => b.bills + b.labor - (a.bills + a.labor));
}
