// The Cost Cloud's three reads (/art/cloud). Imported through "@/lib/jobtread".
// Read-only: each is one paged walk, then a plain map to CloudRecord.
import type { CloudRecord, CloudSetId } from "@/lib/art/cloud";
import { pageAll, type PaveConfig } from "./core";
import { getJobs } from "./jobCostDetail";
import { jtIsoToOrgLocal } from "./timeEntries";

/** The Historical Cost Import's vendor: a job's whole pre-JobTread spend as a
 *  few giant lines. Left out for the same reason the year ribbon leaves it out. */
const HISTORICAL_VENDOR = "Historical Job Cost";

const division = (code: string | undefined) => (code ?? "").trim().slice(0, 2) || "none";
const monthIndex = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return y && m ? y * 12 + m : 0;
};
const dayIndex = (iso: string) => {
  const t = Date.parse(iso.slice(0, 10));
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : 0;
};

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

async function billLines(cfg: PaveConfig): Promise<CloudRecord[]> {
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
      document: { issueDate: {}, account: { name: {} } },
    },
  );
  return rows.map((r) => {
    const date = String(r?.document?.issueDate ?? "");
    const vendor = String(r?.document?.account?.name ?? "");
    const code = String(r?.costCode?.number ?? "");
    return {
      title: String(r?.name || r?.costCode?.name || "Bill line"),
      value: Number(r?.cost) || 0,
      meta: [vendor, code, date].filter(Boolean).join(" · "),
      num: {
        cost: Number(r?.cost) || 0,
        qty: Number(r?.quantity) || 0,
        unit: Number(r?.unitCost) || 0,
        month: monthIndex(date),
      },
      cat: { type: String(r?.costType?.name ?? "none"), div: division(code), vendor },
      text: String(r?.name ?? ""),
    };
  });
}

async function crewTime(cfg: PaveConfig, jobName: (id: string) => string): Promise<CloudRecord[]> {
  const rows = await walk(cfg, "timeEntries", "art crew time", ["minutes", ">", 0], {
    startedAt: {},
    minutes: {},
    type: {},
    user: { name: {} },
    job: { id: {} },
    costItem: { costCode: { number: {} } },
  });
  return rows.map((r) => {
    const local = jtIsoToOrgLocal(String(r?.startedAt ?? ""));
    const hours = (Number(r?.minutes) || 0) / 60;
    const person = String(r?.user?.name ?? "Unknown");
    const job = jobName(String(r?.job?.id ?? ""));
    const dow = local ? new Date(`${local.slice(0, 10)}T12:00:00Z`).getUTCDay() : 0;
    const start = local ? Number(local.slice(11, 13)) + Number(local.slice(14, 16)) / 60 : 0;
    return {
      title: `${person} · ${job}`,
      value: hours,
      meta: [local.slice(0, 10), r?.costItem?.costCode?.number, r?.type].filter(Boolean).join(" · "),
      num: {
        hours,
        start,
        dowSin: Math.sin((2 * Math.PI * dow) / 7),
        dowCos: Math.cos((2 * Math.PI * dow) / 7),
        day: dayIndex(local),
      },
      cat: {
        person,
        div: division(r?.costItem?.costCode?.number),
        job,
        pay: String(r?.type ?? "none"),
      },
    };
  });
}

async function budgetLines(cfg: PaveConfig, jobName: (id: string) => string): Promise<CloudRecord[]> {
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
  return rows.map((r) => {
    const cost = Number(r?.cost) || 0;
    const price = Number(r?.price) || 0;
    const job = jobName(String(r?.job?.id ?? ""));
    const code = String(r?.costCode?.number ?? "");
    return {
      title: String(r?.name || "Budget line"),
      value: cost,
      meta: [job, code].filter(Boolean).join(" · "),
      num: {
        cost,
        price,
        qty: Number(r?.quantity) || 0,
        margin: price > 0 ? Math.max(-1, Math.min(1, (price - cost) / price)) : 0,
      },
      cat: { type: String(r?.costType?.name ?? "none"), div: division(code), job },
      text: String(r?.name ?? ""),
    };
  });
}

/** Every row of one Cost Cloud data set, as plain records. */
export async function getArtCloudRecords(cfg: PaveConfig, set: CloudSetId): Promise<CloudRecord[]> {
  if (set === "bills") return billLines(cfg);
  const jobs = await getJobs(cfg, true);
  const names = new Map(jobs.map((j) => [j.id, j.name]));
  const jobName = (id: string) => names.get(id) ?? "No job";
  return set === "labor" ? crewTime(cfg, jobName) : budgetLines(cfg, jobName);
}
