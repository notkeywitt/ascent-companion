// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.
//
// A month's client invoices AS JOBTREAD HOLDS THEM — read, never recomputed. The
// Invoicing Package email's Summary PDFs print these. They used to be rebuilt from
// the job's bills (getUninvoicedBills, drafts and invoiced bills included), which
// drifted from the invoice whenever a draft copy of an approved bill existed
// (Oct 2026: Sunset drafts #50-52 doubled $1,964 on Main House).

import type { Detail } from "@/components/BillingSummary";
import type { ActualInvoice } from "@/lib/invoicePreview";
import { pageAll, type PaveConfig } from "./core";

export interface MonthInvoice {
  detail: Detail;
  actual: ActualInvoice;
}

const r2 = (n: number) => Math.round(n * 100 + 1e-6) / 100;

/**
 * PURE — which of a job's month invoices the PDF prints. Voided (denied) ones
 * never count. A $0 invoice is a warranty record, not a bill. A draft is a work
 * in progress: it counts only when the job has nothing sent (pending/approved).
 */
export function pickMonthInvoices<T extends { status: string; priceWithTax: number }>(rows: T[]): T[] {
  const live = rows.filter((r) => r.status !== "denied" && r.priceWithTax !== 0);
  const sent = live.filter((r) => r.status !== "draft");
  return sent.length ? sent : live;
}

/**
 * PURE — the invoice's cost items rolled into the preview's Detail. `price` is the
 * invoice's pre-tax price, so the fee is exactly what JobTread charged over cost.
 */
export function invoiceToDetail(
  inv: {
    id: string;
    number: string;
    name: string;
    status: string;
    issueDate: string;
    dueDate: string;
    price: number;
    tax: number;
    priceWithTax: number;
    toName: string;
    address: string;
    jobId: string;
    jobNumber: string;
    jobName: string;
    accountName: string;
  },
  items: { cost: number; code: string; codeName: string }[],
  divisions: Record<string, string>,
): MonthInvoice {
  const byCode = new Map<string, { name: string; amount: number }>();
  let cost = 0;
  for (const it of items) {
    cost += it.cost;
    const prev = byCode.get(it.code);
    byCode.set(it.code, { name: it.codeName || prev?.name || "", amount: (prev?.amount ?? 0) + it.cost });
  }
  const csi = Array.from(byCode.entries())
    .filter(([code]) => code)
    .map(([code, v]) => ({ code, name: v.name, amount: r2(v.amount) }));
  cost = r2(cost);
  const fee = r2(inv.price - cost);
  return {
    detail: {
      customer: inv.accountName ? { id: "", name: inv.accountName } : null,
      job: { id: inv.jobId, name: inv.jobName },
      total: cost,
      lines: [
        {
          key: inv.id,
          label: `Invoice ${inv.number}`,
          cost,
          billIds: [],
          isSunset: false,
          bills: [{ id: inv.id, label: `#${inv.number}`, cost, invoiced: true, status: inv.status, csi }],
        },
      ],
      invoice: {
        jobNumber: inv.jobNumber,
        address: inv.address,
        accountName: inv.accountName,
        contactName: inv.toName,
        email: "",
        markup: cost ? 1 + fee / cost : 1,
        fee,
        divisions,
      },
    },
    actual: {
      name: inv.name,
      number: inv.number,
      status: inv.status,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      fee,
      subtotal: inv.price,
      tax: inv.tax,
      total: inv.priceWithTax,
    },
  };
}

/**
 * Each given job's client invoices issued in [first, last], with their cost
 * items. Keyed by job id; a job with no live invoice is absent. Three reads: the
 * invoices, the division names, then one paged cost-item walk per invoice (a
 * connection nested in a paged one 413s — see PAVE_GOTCHAS.md).
 */
export async function getMonthInvoiceDetails(
  cfg: PaveConfig,
  jobIds: string[],
  first: string,
  last: string,
): Promise<Record<string, MonthInvoice[]>> {
  if (jobIds.length === 0) return {};
  const docs = await pageAll<any>(cfg, {
    label: "organization.documents (month client invoices)",
    size: 25,
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        documents: {
          $: {
            ...args,
            where: {
              and: [
                ["type", "customerInvoice"],
                [["job", "id"], "in", jobIds],
                ["issueDate", ">=", first],
                ["issueDate", "<=", last],
              ],
            },
          },
          nextPage: {},
          nodes: {
            id: {},
            number: {},
            name: {},
            status: {},
            issueDate: {},
            dueDate: {},
            price: {},
            tax: {},
            priceWithTax: {},
            toName: {},
            jobLocationAddress: {},
            job: { id: {}, number: {}, name: {}, location: { account: { name: {} } } },
          },
        },
      },
    }),
    pick: (r) => r?.organization?.documents,
  });

  const rows = docs
    .filter((d) => d.job?.id)
    .map((d) => ({
      id: String(d.id),
      number: d.number == null ? "" : String(d.number),
      name: String(d.name || "Invoice"),
      status: String(d.status ?? ""),
      issueDate: d.issueDate ? String(d.issueDate).slice(0, 10) : last,
      dueDate: d.dueDate ? String(d.dueDate).slice(0, 10) : "",
      price: Number(d.price) || 0,
      tax: Number(d.tax) || 0,
      priceWithTax: Number(d.priceWithTax) || 0,
      toName: String(d.toName ?? ""),
      address: String(d.jobLocationAddress ?? ""),
      jobId: String(d.job.id),
      jobNumber: String(d.job.number ?? ""),
      jobName: String(d.job.name ?? ""),
      accountName: String(d.job.location?.account?.name ?? ""),
    }));

  const byJob = new Map<string, typeof rows>();
  for (const r of rows) byJob.set(r.jobId, [...(byJob.get(r.jobId) ?? []), r]);
  const chosen = Array.from(byJob.values()).flatMap((list) => pickMonthInvoices(list));
  if (chosen.length === 0) return {};

  const codes = await pageAll<any>(cfg, {
    label: "organization.costCodes (division names)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        costCodes: { $: { ...args, where: ["number", "like", "% 00 00"] }, nextPage: {}, nodes: { number: {}, name: {} } },
      },
    }),
    pick: (r) => r?.organization?.costCodes,
  });
  const divisions = Object.fromEntries(codes.map((n) => [String(n.number), String(n.name ?? "")]));

  const out: Record<string, MonthInvoice[]> = {};
  for (let i = 0; i < chosen.length; i += 4) {
    const batch = await Promise.all(
      chosen.slice(i, i + 4).map(async (inv) => {
        const items = await pageAll<any>(cfg, {
          label: "document.costItems (client invoice lines)",
          query: (args) => ({
            document: {
              $: { id: inv.id },
              costItems: { $: args, nextPage: {}, nodes: { cost: {}, costCode: { number: {}, name: {} } } },
            },
          }),
          pick: (r) => r?.document?.costItems,
        });
        return invoiceToDetail(
          inv,
          items.map((n) => ({
            cost: Number(n.cost) || 0,
            code: String(n.costCode?.number ?? "").trim(),
            codeName: String(n.costCode?.name ?? ""),
          })),
          divisions,
        );
      }),
    );
    batch.forEach((mi, k) => {
      const jobId = chosen[i + k].jobId;
      (out[jobId] ??= []).push(mi);
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.actual.number.localeCompare(b.actual.number, undefined, { numeric: true }));
  return out;
}
