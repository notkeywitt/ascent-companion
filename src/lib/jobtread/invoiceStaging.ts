// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { pave, type PaveConfig } from "./core";
// ---------------------------------------------------------------------------
// INVOICE STAGING  (confirmed mechanism: createDocument type customerInvoice;
// the exact lineItems shape is the one remaining detail to lock)
// ---------------------------------------------------------------------------

// NOTE: no createDraftInvoice here. Building a customer invoice from unbilled
// items is a multi-call, server-side JobTread flow (create invoice → costGroup
// per bill → cost items → recalc) that also sets the bill↔invoice reference; a
// bare createDocument yields an EMPTY invoice and can't set that link, so the
// assistant deep-links to JobTread's native builder instead (see stage/page.tsx).

export interface StageLine {
  key: string;
  label: string; // vendor (+ invoice id), or the rolled-up Sunset group
  cost: number;
  billIds: string[];
  isSunset: boolean;
}
export interface MonthlyStaging {
  customer: { id: string; name: string } | null;
  lines: StageLine[];
}

/**
 * Bills to invoice for a job + billing month: approved vendor bills whose
 * issueDate falls in the month (= the billing month). Sunset invoices are rolled
 * into ONE line; every other bill is its own line.
 */
export async function getMonthlyBills(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
): Promise<MonthlyStaging> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const r = await pave(cfg, {
    job: {
      $: { id: jobId },
      id: {},
      documents: {
        $: {
          where: {
            and: [
              ["type", "vendorBill"],
              ["status", "approved"],
              ["issueDate", ">=", first],
              ["issueDate", "<=", last],
            ],
          },
          size: 100,
        },
        nextPage: {},
        nodes: {
          id: {},
          cost: {},
          fromName: {},
          number: {},
          externalId: {},
          account: { name: {} },
        },
      },
    },
  });
  const bills = (r?.job?.documents?.nodes ?? []) as any[];

  const vendorOf = (b: any) => String(b.account?.name ?? b.fromName ?? "Vendor");
  const isSunset = (b: any) => /sunset/i.test(vendorOf(b));
  const sunset = bills.filter(isSunset);
  const others = bills.filter((b) => !isSunset(b));

  const lines: StageLine[] = [];
  if (sunset.length) {
    lines.push({
      key: "sunset",
      label: `Sunset Builders Supply (${sunset.length} invoice${sunset.length > 1 ? "s" : ""})`,
      cost: sunset.reduce((s, b) => s + (b.cost ?? 0), 0),
      billIds: sunset.map((b) => b.id),
      isSunset: true,
    });
  }
  for (const b of others) {
    lines.push({
      key: b.id,
      label: vendorOf(b),
      cost: b.cost ?? 0,
      billIds: [b.id],
      isSunset: false,
    });
  }
  lines.sort((a, b) => b.cost - a.cost);

  const c = await pave(cfg, {
    job: { $: { id: jobId }, id: {}, location: { account: { id: {}, name: {} } } },
  });
  const acc = c?.job?.location?.account;
  const customer = acc?.id ? { id: acc.id, name: acc.name ?? "" } : null;

  return { customer, lines };
}

/**
 * Uninvoiced vendor bills for a job — the individual bills a new customer invoice
 * will pull, mirroring JobTread's native invoice builder.
 *
 * Confirmed (probes + native-UI network capture, 2026-07): a vendor bill's
 * `referencedDocuments` is the per-bill "already invoiced" flag. When a customer
 * invoice pulls a bill, that bill's referencedDocuments gains a node of type
 * customerInvoice. This is how JT's builder discriminates — per bill, not per
 * cost code.
 *
 * The reference appears at ANY status, DRAFT INCLUDED, so the node's own
 * `status` is what decides here: a bill on a draft invoice is still uninvoiced,
 * because a draft has not gone out. See `_isInvoicedToClient`.
 *
 * NOTE: referencedDocuments nested in paged documents 413s at size 100 (like
 * costItems), but works at ≤50 — we page at 25. A bare "Create invoice" also
 * pulls uninvoiced TIME entries — the "time" line's `timeEntries` carries
 * employee/hours/rate detail for each one.
 */
/** A CSI cost code + the amount coded to it (the breakdown behind one bill or the
 *  code on one time entry). `code` is costCode.number — usually a CSI number, but
 *  can be a bare label (e.g. "Office Admin"); `name` is costCode.name. */
export interface CsiAmount {
  code: string;
  name: string;
  amount: number;
}
export interface UninvoicedBillRef {
  id: string; // JT document id — links to the assistant bill view + JT doc page
  label: string; // invoice # / externalId (or vendor)
  cost: number;
  invoiced: boolean; // already on a customer invoice (only appears when includeInvoiced)
  status?: string; // JT document status: pending (approved for payment) | approved (paid)
  csi?: CsiAmount[]; // this bill's cost items aggregated per CSI code (amount desc)
}
export interface UninvoicedTimeEntryRef {
  id: string;
  employee: string;
  hours: number;
  rate: number;
  cost: number; // the entry's coded cost (hours × rate, JT-authoritative)
  code?: string; // costItem.costCode.number
  codeName?: string; // costItem.costCode.name
}
export interface UninvoicedBillLine {
  key: string;
  label: string; // vendor · invoice#, or the rolled-up Sunset group
  cost: number;
  billIds: string[];
  isSunset: boolean;
  // Individual documents behind this line. A single-vendor line carries one;
  // the Sunset group carries every Sunset bill so the UI can list them under
  // the group total. Empty/undefined for non-document lines (e.g. Time & labor).
  bills?: UninvoicedBillRef[];
  // Individual time entries behind the Time & labor line (employee/hours/rate
  // detail only — no per-entry cost, the group row above already has the total).
  timeEntries?: UninvoicedTimeEntryRef[];
}
export interface UninvoicedBills {
  customer: { id: string; name: string } | null;
  job?: { id: string; name: string };
  lines: UninvoicedBillLine[];
  total: number;
}
