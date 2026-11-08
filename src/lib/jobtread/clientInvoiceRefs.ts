// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import type { InvoiceRaw } from "@/lib/invoiceStatus";
import { pageAll, pave, type PaveConfig } from "./core";
// ---------------------------------------------------------------------------
// CLIENT INVOICE REFERENCES — the Invoicing Package email's QBO links and PDFs.
// ---------------------------------------------------------------------------

export interface PackageInvoice {
  id: string;
  /** QuickBooks txnId, or "" when the invoice is not pushed to QuickBooks yet. */
  qboId: string;
  /** "Monthly Invoice 002-379.pdf" — JobTread's own name for the invoice PDF. */
  pdfName: string;
}

/**
 * Every client invoice on the given jobs, keyed `${jobId}:${number}`.
 * JobTread's `qboId` IS the txnId in a QBO invoice link
 * (qbo.intuit.com/app/invoice?txnId=…) — Berger #379 ↔ 46097, checked
 * 2026-10-15. `pdfName` copies the filename JobTread's `pdf` mutation sends:
 * document name, job number, invoice number.
 */
export async function getInvoiceRefs(
  cfg: PaveConfig,
  jobIds: string[],
): Promise<Record<string, PackageInvoice>> {
  if (jobIds.length === 0) return {};
  const nodes = await pageAll<{
    id: string;
    name: string | null;
    number: number | string | null;
    qboId: string | null;
    job: { id: string; number: string | null } | null;
  }>(cfg, {
    label: "organization.documents (client invoice refs)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        documents: {
          $: {
            ...args,
            where: {
              and: [
                { "=": [{ field: "type" }, { value: "customerInvoice" }] },
                { in: [{ field: ["job", "id"] }, jobIds.map((value) => ({ value }))] },
              ],
            },
          },
          nextPage: {},
          nodes: { id: {}, name: {}, number: {}, qboId: {}, job: { id: {}, number: {} } },
        },
      },
    }),
    pick: (r) => r?.organization?.documents,
  });
  const out: Record<string, PackageInvoice> = {};
  for (const n of nodes) {
    if (!n.job?.id) continue;
    out[`${n.job.id}:${n.number}`] = {
      id: n.id,
      qboId: n.qboId ?? "",
      pdfName: `${n.name || "Invoice"} ${n.job.number ? `${n.job.number}-` : ""}${n.number}.pdf`,
    };
  }
  return out;
}

/**
 * The named client invoices with their payment and email state, keyed
 * `${jobId}:${number}` like `getInvoiceRefs`. The Invoice Status page's
 * Draft/Open/Paid and Sent/Opened marks.
 *
 * TWO PHASES (the 413 rule). `documentRecipients` nested inside the paged
 * invoice list returned HTTP 413 in production (2026-10-20). So phase 1 pages
 * the jobs' invoices with scalars only, and phase 2 reads the recipients of
 * just the wanted invoices, as aliased `document(id)` roots in one request.
 */
export async function getInvoiceStatuses(
  cfg: PaveConfig,
  wanted: { jobId: string; number: string }[],
): Promise<Record<string, InvoiceRaw>> {
  if (wanted.length === 0) return {};
  const keys = new Set(wanted.map((w) => `${w.jobId}:${w.number}`));
  const jobIds = [...new Set(wanted.map((w) => w.jobId))];
  const nodes = await pageAll<{
    id: string;
    number: number | string | null;
    status: string;
    priceWithTax: number | null;
    amountPaid: number | null;
    balance: number | null;
    qboId: string | null;
    job: { id: string } | null;
  }>(cfg, {
    label: "organization.documents (client invoice status)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        documents: {
          $: {
            ...args,
            where: {
              and: [
                { "=": [{ field: "type" }, { value: "customerInvoice" }] },
                { in: [{ field: ["job", "id"] }, jobIds.map((value) => ({ value }))] },
              ],
            },
          },
          nextPage: {},
          nodes: {
            id: {},
            number: {},
            status: {},
            priceWithTax: {},
            amountPaid: {},
            balance: {},
            qboId: {},
            job: { id: {} },
          },
        },
      },
    }),
    pick: (r) => r?.organization?.documents,
  });
  const hits = nodes.filter((n) => n.job?.id && keys.has(`${n.job.id}:${n.number}`));

  type Rcpt = {
    emailDeliveryStatus: string | null;
    emailDeliveryStatusUpdatedAt: string | null;
    documentLastViewedAt: string | null;
    user: { name: string | null } | null;
  };
  const recipients: Record<string, Rcpt[]> = {};
  // 25 documents a request keeps each one small; a month has about a dozen.
  for (let i = 0; i < hits.length; i += 25) {
    const chunk = hits.slice(i, i + 25);
    const query: Record<string, unknown> = {};
    chunk.forEach((n, k) => {
      query[`d${k}`] = {
        _: "document",
        $: { id: n.id },
        id: {},
        documentRecipients: {
          $: { size: 100 },
          nodes: {
            emailDeliveryStatus: {},
            emailDeliveryStatusUpdatedAt: {},
            documentLastViewedAt: {},
            user: { name: {} },
          },
        },
      };
    });
    const r = await pave<Record<string, { id: string; documentRecipients?: { nodes?: Rcpt[] } } | null>>(
      cfg,
      query,
    );
    for (const d of Object.values(r ?? {})) {
      if (d?.id) recipients[d.id] = d.documentRecipients?.nodes ?? [];
    }
  }

  const out: Record<string, InvoiceRaw> = {};
  for (const n of hits) {
    out[`${n.job!.id}:${n.number}`] = {
      status: n.status,
      priceWithTax: Number(n.priceWithTax ?? 0),
      amountPaid: Number(n.amountPaid ?? 0),
      balance: Number(n.balance ?? 0),
      qboId: n.qboId,
      recipients: (recipients[n.id] ?? []).map((r) => ({
        name: r.user?.name ?? "",
        emailDeliveryStatus: r.emailDeliveryStatus,
        emailDeliveryStatusUpdatedAt: r.emailDeliveryStatusUpdatedAt,
        documentLastViewedAt: r.documentLastViewedAt,
      })),
    };
  }
  return out;
}
