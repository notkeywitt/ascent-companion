// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import type { InvoiceForPayment, PaymentGroup } from "@/lib/depositTracker";
import { pave, type PaveConfig } from "./core";
// ── Deposit checks (Home → Deposit checks, src/lib/depositTracker.ts) ────────

/**
 * WRITE — put a file on a job's Files tab, inside `folder` (JobTread makes the
 * folder on its first file). The same three-step upload as
 * attachFileToDocument, with targetType "job". `folder` on createFile is in
 * the introspected schema; this write is NOT live-probed — the first deposit
 * is the probe, and the route reports the folder JobTread hands back.
 */
export async function uploadFileToJobFolder(
  cfg: PaveConfig,
  jobId: string,
  folder: string,
  bytes: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ id: string; name: string; folder: string | null; url: string | null }> {
  const r1 = await pave(cfg, {
    createUploadRequest: {
      $: { type: mimeType, size: bytes.length, organizationId: cfg.orgId },
      createdUploadRequest: { id: {}, url: {}, method: {}, headers: {} },
    },
  });
  const up = r1?.createUploadRequest?.createdUploadRequest;
  if (!up?.url || !up?.id) throw new Error("createUploadRequest returned no upload URL.");

  const put = await fetch(up.url, {
    method: up.method || "PUT",
    headers: up.headers || {},
    body: new Uint8Array(bytes),
  });
  if (put.status !== 200 && put.status !== 204) {
    throw new Error(`File PUT failed with HTTP ${put.status}`);
  }

  const r3 = await pave(cfg, {
    createFile: {
      $: { uploadRequestId: up.id, targetId: jobId, targetType: "job", name: fileName, folder },
      createdFile: { id: {}, name: {}, folder: {}, url: {} },
    },
  });
  const f = r3?.createFile?.createdFile;
  if (!f?.id) throw new Error("createFile returned no file id.");
  return { id: f.id, name: f.name ?? fileName, folder: f.folder ?? null, url: f.url ?? null };
}

/**
 * Files on one job by id, with the link to download each — the deposit email
 * attaches the check photos from these. A file on another job, or in another
 * folder, comes back as null, so a caller cannot attach an arbitrary file.
 */
export async function getJobFilesById(
  cfg: PaveConfig,
  jobId: string,
  folder: string,
  ids: string[],
): Promise<Record<string, { id: string; name: string; type: string; url: string } | null>> {
  const out: Record<string, { id: string; name: string; type: string; url: string } | null> = {};
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const query: Record<string, unknown> = {};
    chunk.forEach((id, k) => {
      query[`f${k}`] = { _: "file", $: { id }, id: {}, name: {}, type: {}, folder: {}, url: {}, job: { id: {} } };
    });
    const r = await pave<Record<string, any>>(cfg, query);
    chunk.forEach((id, k) => {
      const f = r?.[`f${k}`];
      out[id] =
        f?.id && f.job?.id === jobId && (f.folder ?? "") === folder && f.url
          ? { id: f.id, name: f.name ?? "", type: f.type ?? "", url: f.url }
          : null;
    });
  }
  return out;
}

/** Client invoices by id, as the deposit tracker needs them to take a payment. */
export async function getInvoicesForPayment(
  cfg: PaveConfig,
  ids: string[],
): Promise<Record<string, InvoiceForPayment | null>> {
  const out: Record<string, InvoiceForPayment | null> = {};
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const query: Record<string, unknown> = {};
    chunk.forEach((id, k) => {
      query[`d${k}`] = {
        _: "document",
        $: { id },
        id: {},
        number: {},
        type: {},
        status: {},
        balance: {},
        account: { id: {}, name: {} },
        job: { id: {}, name: {}, number: {}, location: { account: { id: {}, name: {} } } },
      };
    });
    const r = await pave<Record<string, any>>(cfg, query);
    chunk.forEach((id, k) => {
      const d = r?.[`d${k}`];
      const account = d?.account ?? d?.job?.location?.account ?? null;
      out[id] = d?.id
        ? {
            id: d.id,
            number: d.number != null ? String(d.number) : "",
            type: d.type ?? "",
            status: d.status ?? "",
            balance: typeof d.balance === "number" ? d.balance : 0,
            jobId: d.job?.id ?? "",
            jobName: d.job?.name ?? "",
            jobNumber: d.job?.number != null ? String(d.job.number) : "",
            customerName: account?.name ?? "",
            accountId: account?.id ?? "",
          }
        : null;
    });
  }
  return out;
}

/** What recordInvoicePayments did for one customer account. */
export interface RecordedPayment {
  accountId: string;
  customerName: string;
  paymentId: string;
  /** True when the payment was already there from an earlier press (same deposit key). */
  reused: boolean;
  total: number;
  applied: { invoiceId: string; number: string; amount: number; balanceAfter: number | null; reused: boolean }[];
}

/**
 * WRITE — record a deposit's checks against client invoices, the way JobTread's
 * own Record Payment does: one `createPayment` (type credit = money in) per
 * customer account, then one `createDocumentPayment` per invoice it pays.
 *
 * Safe to press twice. Each payment carries an externalId built from the
 * deposit key; a payment with that id is reused, and an invoice it already
 * pays is skipped. So a retry after a half-finished run finishes the job
 * instead of paying an invoice twice.
 *
 * Both mutations are in the introspected schema (createPayment and
 * createDocumentPayment, 2026-10-26). Neither is live-probed. Unverified: does
 * a payment made through the API go to QuickBooks, as one made in JobTread's
 * web app does? The balance read back after each application is the check that
 * the invoice really moved.
 */
export async function recordInvoicePayments(
  cfg: PaveConfig,
  args: {
    paidAt: string;
    description: string;
    /** `externalId` per group: paymentExternalId (src/lib/depositTracker.ts). */
    groups: (PaymentGroup & { externalId: string })[];
  },
): Promise<RecordedPayment[]> {
  const out: RecordedPayment[] = [];
  for (const g of args.groups) {
    const externalId = g.externalId;
    const found = await pave(cfg, {
      organization: {
        $: { id: cfg.orgId },
        payments: {
          $: { size: 5, where: { and: [["externalId", externalId], ["type", "credit"]] } },
          nodes: {
            id: {},
            amount: {},
            documentPayments: { $: { size: 100 }, nodes: { amount: {}, document: { id: {} } } },
          },
        },
      },
    });
    const prior = found?.organization?.payments?.nodes?.[0] ?? null;
    let paymentId: string = prior?.id ?? "";
    const already = new Set<string>(
      (prior?.documentPayments?.nodes ?? []).map((n: any) => n?.document?.id).filter(Boolean),
    );

    if (!paymentId) {
      const r = await pave(cfg, {
        createPayment: {
          $: {
            organizationId: cfg.orgId,
            accountId: g.accountId,
            amount: g.total,
            paidAt: args.paidAt,
            type: "credit",
            description: args.description,
            source: "check",
            externalId,
          },
          createdPayment: { id: {} },
        },
      });
      paymentId = r?.createPayment?.createdPayment?.id ?? "";
      if (!paymentId) throw new Error(`JobTread accepted the payment for ${g.customerName} but returned no id.`);
    } else if (Math.round(Number(prior.amount) * 100) !== Math.round(g.total * 100)) {
      throw new Error(
        `${g.customerName} already has a payment from this deposit for ${prior.amount}, not ${g.total}. ` +
          "Open it in JobTread before you try again.",
      );
    }

    const rec: RecordedPayment = {
      accountId: g.accountId,
      customerName: g.customerName,
      paymentId,
      reused: !!prior,
      total: g.total,
      applied: [],
    };
    out.push(rec);

    for (const l of g.lines) {
      const reused = already.has(l.invoice.id);
      if (!reused) {
        const r = await pave(cfg, {
          createDocumentPayment: {
            $: { documentId: l.invoice.id, paymentId, amount: l.amount },
            createdDocumentPayment: { id: {} },
          },
        });
        if (!r?.createDocumentPayment?.createdDocumentPayment?.id) {
          throw new Error(`JobTread returned no record of the payment on invoice #${l.invoice.number}.`);
        }
      }
      const after = await pave(cfg, { document: { $: { id: l.invoice.id }, id: {}, balance: {} } });
      const balanceAfter = typeof after?.document?.balance === "number" ? after.document.balance : null;
      rec.applied.push({ invoiceId: l.invoice.id, number: l.invoice.number, amount: l.amount, balanceAfter, reused });
    }
  }
  return out;
}
