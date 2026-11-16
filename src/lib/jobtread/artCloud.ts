// The /art pieces' three reads. Imported through "@/lib/jobtread".
// Read-only: each is one paged walk, then a plain map to the row shapes in
// src/lib/art/rows.ts.
import type { CloudSetId } from "@/lib/art/cloud";
import type { ArtBillRow, ArtBudgetRow, ArtRows, ArtTimeRow } from "@/lib/art/rows";
import { pageAll, type PaveConfig } from "./core";
import { getJobs } from "./jobCostDetail";
import { jtIsoToOrgLocal } from "./timeEntries";

/** The Historical Cost Import's vendor: a job's whole pre-JobTread spend as a
 *  few giant lines. Left out for the same reason the year ribbon leaves it out. */
const HISTORICAL_VENDOR = "Historical Job Cost";

function walk(cfg: PaveConfig, connection: string, label: string, where: unknown, nodes: Record<string, unknown>) {
  return pageAll<any>(cfg, {
    label: `organization.${connection} (${label})`,
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        [connection]: { $: { ...args, where }, nextPage: {}, nodes },
      },
    }),
    pick: (r) => r?.organization?.[connection],
  });
}

async function billRows(cfg: PaveConfig, jobName: (id: string) => string): Promise<ArtBillRow[]> {
  const rows = await walk(
    cfg,
    "costItems",
    "art bill lines",
    {
      and: [
        [["document", "type"], "vendorBill"],
        [["document", "status"], "in", ["pending", "approved"]],
        [["document", "account", "name"], "!=", HISTORICAL_VENDOR],
      ],
    },
    {
      name: {},
      quantity: {},
      unitCost: {},
      cost: {},
      costCode: { number: {}, name: {} },
      costType: { name: {} },
      job: { id: {} },
      document: { issueDate: {}, account: { name: {} } },
    },
  );
  return rows.map((r) => ({
    name: String(r?.name || r?.costCode?.name || ""),
    cost: Number(r?.cost) || 0,
    qty: Number(r?.quantity) || 0,
    unit: Number(r?.unitCost) || 0,
    date: String(r?.document?.issueDate ?? "").slice(0, 10),
    code: String(r?.costCode?.number ?? ""),
    type: String(r?.costType?.name ?? "none"),
    vendor: String(r?.document?.account?.name ?? ""),
    job: jobName(String(r?.job?.id ?? "")),
  }));
}

async function timeRows(cfg: PaveConfig, jobName: (id: string) => string): Promise<ArtTimeRow[]> {
  const rows = await walk(cfg, "timeEntries", "art crew time", ["minutes", ">", 0], {
    startedAt: {},
    minutes: {},
    type: {},
    user: { name: {} },
    job: { id: {} },
    costItem: { costCode: { number: {} } },
  });
  return rows.map((r) => ({
    start: jtIsoToOrgLocal(String(r?.startedAt ?? "")),
    hours: (Number(r?.minutes) || 0) / 60,
    person: String(r?.user?.name ?? "Unknown"),
    job: jobName(String(r?.job?.id ?? "")),
    code: String(r?.costItem?.costCode?.number ?? ""),
    pay: String(r?.type ?? "none"),
  }));
}

async function budgetRows(cfg: PaveConfig, jobName: (id: string) => string): Promise<ArtBudgetRow[]> {
  const rows = await walk(
    cfg,
    "costItems",
    "art budget lines",
    {
      and: [
        [["document", "id"], null],
        [["job", "id"], "!=", null],
        // JobTread's own "Uncategorized <code>" rollups are not real lines.
        ["name", "not like", "Uncategorized%"],
      ],
    },
    {
      name: {},
      quantity: {},
      cost: {},
      price: {},
      costCode: { number: {} },
      costType: { name: {} },
      job: { id: {} },
    },
  );
  return rows.map((r) => ({
    name: String(r?.name ?? ""),
    cost: Number(r?.cost) || 0,
    price: Number(r?.price) || 0,
    qty: Number(r?.quantity) || 0,
    code: String(r?.costCode?.number ?? ""),
    type: String(r?.costType?.name ?? "none"),
    job: jobName(String(r?.job?.id ?? "")),
  }));
}

/** Every row of one /art data set. */
export async function getArtRows<S extends CloudSetId>(cfg: PaveConfig, set: S): Promise<ArtRows[S]> {
  const jobs = await getJobs(cfg, true);
  const names = new Map(jobs.map((j) => [j.id, j.name]));
  const jobName = (id: string) => names.get(id) ?? "No job";
  if (set === "bills") return (await billRows(cfg, jobName)) as ArtRows[S];
  return (set === "labor" ? await timeRows(cfg, jobName) : await budgetRows(cfg, jobName)) as ArtRows[S];
}
