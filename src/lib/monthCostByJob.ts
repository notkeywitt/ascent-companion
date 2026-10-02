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
 * Jobs with no cost in the month are absent.
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
  const add = (n: any, code: string, codeName: string, field: "bills" | "labor") => {
    const job = n?.job;
    if (!job?.id || !code) return;
    let j = jobs.get(job.id);
    if (!j) {
      j = {
        jobId: job.id,
        jobName: job.name ?? "",
        customerName: job.location?.account?.name ?? "",
        bills: 0,
        labor: 0,
        rows: [],
        byCode: new Map(),
      };
      jobs.set(job.id, j);
    }
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
  ]);

  return [...jobs.values()]
    .map(({ byCode, ...j }) => ({
      ...j,
      rows: [...byCode.values()].filter((r) => r.bills !== 0 || r.labor !== 0),
    }))
    .filter((j) => j.rows.length > 0)
    .sort((a, b) => b.bills + b.labor - (a.bills + a.labor));
}
