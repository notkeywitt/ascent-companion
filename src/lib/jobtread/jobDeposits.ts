// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { type DepositInputs, type DepositInvoice, DEPOSIT_CSI } from "@/lib/deposits";
import { pageAll, pave, type PaveConfig } from "./core";
// ---------------------------------------------------------------------------
// JOB DEPOSITS  (read only — the rules are src/lib/deposits.ts; the why is
// DEPOSITS_PLAN.md). Every field below was confirmed live 2026-10-05.
// ---------------------------------------------------------------------------

/** One client payment applied to one of the job's invoices. */
export interface ClientPaymentRow {
  applicationId: string;
  /** The part of the payment applied to this invoice. */
  amount: number;
  /** Did JobTread link this application to QuickBooks? */
  linkedToQbo: boolean;
  invoiceId: string;
  invoiceNumber: number | null;
  invoiceName: string;
  invoiceStatus: string;
  paymentId: string;
  paymentAmount: number;
  /** ISO datetime. */
  paidAt: string;
  description: string | null;
  /** "qbo" for a payment taken in QuickBooks; "Check" etc. when typed in JobTread. */
  source: string | null;
  /** The payment itself exists in QuickBooks. */
  inQbo: boolean;
}

export interface JobDepositRead {
  jobId: string;
  jobName: string;
  /** Everything `buildDepositLedger` needs except the deposit entered by hand. */
  lines: DepositInputs["lines"];
  clientPayments: ClientPaymentRow[];
  /** Every issued client invoice on the job (pending + approved), with tax —
   *  what the client has been billed to date. Drafts and voided ones are out. */
  invoicedTotal: number;
}

export const DEPOSIT_INVOICE_FIELDS = {
  id: {},
  number: {},
  name: {},
  status: {},
  issueDate: {},
  priceWithTax: {},
  amountPaid: {},
};

export const pEq = (field: string | string[], value: unknown) => ({ "=": [{ field }, { value }] });

export function toDepositInvoice(d: any, jobId: string): DepositInvoice {
  return {
    id: String(d?.id ?? ""),
    number: typeof d?.number === "number" ? d.number : null,
    name: String(d?.name ?? ""),
    status: String(d?.status ?? ""),
    issueDate: d?.issueDate ?? null,
    priceWithTax: Number(d?.priceWithTax) || 0,
    amountPaid: Number(d?.amountPaid) || 0,
    jobId,
  };
}

/**
 * One job's CD lines on its customer invoices, and every client payment
 * applied to its invoices. The payments that paid a deposit invoice are the
 * deposit's link to JobTread (Gormley Studio #8).
 */
export async function getJobDepositInputs(cfg: PaveConfig, jobId: string): Promise<JobDepositRead> {
  const [head, cdItems, applied] = await Promise.all([
    pave(cfg, {
      job: {
        $: { id: jobId },
        id: {},
        name: {},
        documents: {
          $: { where: { and: [["type", "customerInvoice"], ["status", "in", ["pending", "approved"]]] } },
          sum: { $: "priceWithTax" },
        },
      },
    }),
    pageAll<any>(cfg, {
      label: "job.costItems (CD)",
      query: (args) => ({
        job: {
          $: { id: jobId },
          costItems: {
            $: { ...args, where: pEq(["costCode", "number"], DEPOSIT_CSI) },
            nextPage: {},
            nodes: { id: {}, price: {}, isTaxable: {}, document: { type: {}, ...DEPOSIT_INVOICE_FIELDS } },
          },
        },
      }),
      pick: (a) => a?.job?.costItems,
    }),
    pageAll<any>(cfg, {
      label: "organization.documentPayments (job)",
      query: (args) => ({
        organization: {
          $: { id: cfg.orgId },
          documentPayments: {
            $: {
              ...args,
              where: { and: [pEq(["document", "job", "id"], jobId), pEq(["document", "type"], "customerInvoice")] },
            },
            nextPage: {},
            nodes: {
              id: {},
              amount: {},
              isLinkedToQbo: {},
              document: DEPOSIT_INVOICE_FIELDS,
              payment: { id: {}, amount: {}, paidAt: {}, description: {}, source: {}, qboId: {} },
            },
          },
        },
      }),
      pick: (a) => a?.organization?.documentPayments,
    }),
  ]);
  const job = head?.job;
  if (!job?.id) throw new Error("That job does not exist in JobTread.");

  const clientPayments: ClientPaymentRow[] = applied
    .map((a) => ({
      applicationId: String(a.id),
      amount: Number(a.amount) || 0,
      linkedToQbo: Boolean(a.isLinkedToQbo),
      invoiceId: String(a?.document?.id ?? ""),
      invoiceNumber: typeof a?.document?.number === "number" ? a.document.number : null,
      invoiceName: String(a?.document?.name ?? ""),
      invoiceStatus: String(a?.document?.status ?? ""),
      paymentId: String(a?.payment?.id ?? ""),
      paymentAmount: Number(a?.payment?.amount) || 0,
      paidAt: String(a?.payment?.paidAt ?? ""),
      description: a?.payment?.description ?? null,
      source: a?.payment?.source ?? null,
      inQbo: a?.payment?.qboId != null,
    }))
    .sort((x, y) => x.paidAt.localeCompare(y.paidAt));

  return {
    jobId: String(job.id),
    jobName: String(job.name ?? ""),
    lines: cdItems
      .filter((c) => c?.document?.type === "customerInvoice")
      .map((c) => ({
        id: String(c.id),
        price: Number(c.price) || 0,
        isTaxable: Boolean(c.isTaxable),
        invoice: toDepositInvoice(c.document, String(job.id)),
      })),
    clientPayments,
    invoicedTotal: Number(job.documents?.sum) || 0,
  };
}
