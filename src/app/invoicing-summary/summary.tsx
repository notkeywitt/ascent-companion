"use client";

import { useCallback, useState } from "react";

import { Chip } from "@/components/ui";
import { money } from "@/lib/money";
import { PAYMENT_LABEL, type InvoiceStatus, type PaymentState } from "@/lib/invoiceStatus";
import type { PackageJobInvoice } from "@/lib/packageInvoices";

/**
 * The month's invoicing figures and statuses — one read, shared by the Invoice
 * Status page and the desktop Home's monthly invoicing widget. What the
 * figures and statuses mean is documented on the page (./page.tsx).
 */

export interface JobLinks {
  appTracking: string;
  appLabor: string;
  jtJob: string;
  jtLabor: string;
  jtInvoice: string;
  jtDocuments: string;
}

export interface JobRow {
  jtJobId: string;
  projectId: string;
  customer: string;
  job: string;
  customerLabel: string;
  jobLabel: string;
  include: boolean;
  note: string;
  labor: number;
  laborHours: number;
  laborPeople: number;
  bills: number;
  billCount: number;
  vendorCount: number;
  cost: number;
  total: number;
  invoiced: boolean;
  invoiceNumber: string;
  invoiceStatus: string;
  invoiceBalance: number;
  trackingSheetUrl: string;
  billingFolderUrl: string;
  /** -1 when the month's folder was never created for this job. */
  billingFolderFiles: number;
  links: JobLinks;
  /** Payment and email state, read live from JobTread. Absent on a job with no
   *  invoice, and when that read failed (the warnings say so). The PRIMARY
   *  invoice's, when the job has two. */
  status?: InvoiceStatus | null;
  /** Every invoice for the month, primary first, each with its own state. A
   *  month can hold two: the normal one and a $0 warranty record. */
  invoices?: (PackageJobInvoice & { status: InvoiceStatus | null })[];
}

/** A job's invoice states — every invoice, or the primary's alone on an old payload. */
export function jobStatuses(j: JobRow): InvoiceStatus[] {
  const list = j.invoices?.length ? j.invoices.map((i) => i.status) : [j.status];
  return list.filter((s): s is InvoiceStatus => !!s);
}

export interface Summary {
  periodKey: string;
  month: number;
  year: number;
  monthLabel: string;
  invoiceMonthLabel: string;
  docTitle: string;
  docId: string;
  docUrl: string;
  /** A figure has moved since the doc was last written. */
  stale: boolean;
  /** The doc has been written at least once. */
  written: boolean;
  /** When Apps Script last read these figures from JobTread. */
  computedAt: string;
  /** How long that read took. Printed, because this month's read is the thing
   *  that runs into Apps Script's ceiling when a month grows. */
  readMs: number;
  headline: string;
  defaultHeadline: string;
  closing: string;
  totals: {
    customers: number;
    jobs: number;
    labor: number;
    bills: number;
    cost: number;
    total: number;
    invoiced: number;
  };
  warnings: string[];
  jobs: JobRow[];
}

/**
 * The month's headline figures, from the jobs the office left IN. Computed from
 * state, not read from the payload: leaving a job out moves the total on the tap.
 */
export function liveTotals(jobs: JobRow[]) {
  const included = jobs.filter((j) => j.include);
  return {
    included,
    total: included.reduce((s, j) => s + j.total, 0),
    labor: included.reduce((s, j) => s + j.labor, 0),
    bills: included.reduce((s, j) => s + j.bills, 0),
    invoiced: included.filter((j) => j.invoiced).length,
    customers: new Set(included.map((j) => j.customerLabel)).size,
    // Over EVERY invoice of a job, not just its primary.
    due: included.reduce(
      (s, j) =>
        s +
        jobStatuses(j).reduce(
          (t, st) => t + (st.payment === "open" || st.payment === "partPaid" ? st.balance : 0),
          0,
        ),
      0,
    ),
    paid: included.reduce((s, j) => s + jobStatuses(j).reduce((t, st) => t + st.amountPaid, 0), 0),
  };
}

/**
 * The month's figures and statuses. `load("")` asks for the BILLING MONTH IN
 * FORCE — the one picked on the home page. `refresh` pays for a live read of
 * the figures; without it they are Apps Script's cache of the last full read,
 * which is what makes opening fast. The statuses are live either way.
 */
export function useInvoicingSummary() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (period: string, refresh = false): Promise<Summary | null> => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (period) q.set("ym", period);
      if (refresh) q.set("refresh", "1");
      const res = await fetch(q.size ? `/api/invoicing-summary?${q}` : "/api/invoicing-summary", {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body as Summary);
      return body as Summary;
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Could not read the month.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, setData, loading, error, load };
}

export const PAYMENT_TONE: Record<PaymentState, string> = {
  draft: "text-warn",
  open: "text-neutral-800 dark:text-neutral-100",
  partPaid: "text-warn",
  paid: "text-ok",
  void: "text-danger",
};

/** Where the money is: Draft / Open / Part paid / Paid / Void, or Not invoiced. */
export function PaymentMark({ job }: { job: JobRow }) {
  if (!job.invoiced) {
    return (
      <Chip tone="warning" title="No client invoice in JobTread for this month yet">
        Not invoiced
      </Chip>
    );
  }
  const s = job.status;
  if (!s) return <span>Invoice status unknown</span>;
  return (
    <span className={`font-semibold ${PAYMENT_TONE[s.payment]}`}>
      {PAYMENT_LABEL[s.payment]}
      {s.payment === "partPaid" ? ` · ${money(s.balance)} due` : ""}
    </span>
  );
}
