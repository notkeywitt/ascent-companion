/**
 * The month's Invoicing Package email, built from live data — shared by the
 * route's POST (drafts it) and GET (asks whether the draft is out of date).
 * Server-only: it reads Apps Script and JobTread.
 *
 * `fingerprint` is a hash of everything the email says: its html (labels,
 * notes, links, invoice and QuickBooks numbers), each job's invoice price, each
 * job's Invoicing Summary (every bill, amount and cost code) and each PDF's
 * name. Drafting stores it (month_action_runs, action "invoicing-email"); the
 * check builds it again and compares. Any change that would change the email
 * changes the hash.
 */
import { createHash } from "node:crypto";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig } from "@/lib/config";
import { getInvoiceRefs, getJobPhaseMap, getMonthInvoiceDetails } from "@/lib/jobtread";
import { invoiceActualHtml } from "@/lib/invoicePreview";
import { issueDateFor } from "@/lib/billingMonths";
import { composeInvoicingEmail, type PackageJob } from "@/lib/invoicingEmail";
import { jobInvoices } from "@/lib/packageInvoices";

export class EmailBuildError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface SummaryPdf {
  jobId: string;
  name: string;
  html: string;
  folderUrl: string;
}

/**
 * `fresh` makes Apps Script re-read JobTread for the month instead of answering
 * from its cache (up to six hours old). Drafting passes it: the invoice links come
 * from that read, and a voided or re-made invoice must not reach the email. The
 * fresh read also refreshes Apps Script's cache, so the stale check that follows
 * (fresh off, because it runs on every page open) compares against the same data.
 */
export async function buildInvoicingEmail(ym: string, { fresh = false }: { fresh?: boolean } = {}) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new EmailBuildError("ym must look like 2026-09.", 400);

  const sum = await callAppsScript<{
    ok?: boolean;
    error?: string;
    docTitle: string;
    invoiceMonthLabel: string;
    jobs: PackageJob[];
  }>({ action: "invoicingSummary", month: Number(m[2]), year: Number(m[1]), fresh }, { timeoutMs: 110_000 });
  // Each failure names its step: reading the month (Apps Script), building the
  // email (JobTread), or saving the draft (the route).
  if (sum.error) throw new EmailBuildError(`Reading the month: ${sum.error}`, sum.status);
  if (sum.data?.ok !== true || !Array.isArray(sum.data.jobs)) {
    throw new EmailBuildError(`Reading the month: ${sum.data?.error || "Apps Script sent no job list."}`, 502);
  }
  const pkg = sum.data;

  try {
    const cfg = getPaveConfig();
    const wanted = pkg.jobs.filter((j) => j.include && jobInvoices(j).length > 0);
    const [invoices, phases] = await Promise.all([
      getInvoiceRefs(cfg, wanted.map((j) => j.jtJobId)),
      getJobPhaseMap(cfg),
    ]);
    // One Invoicing Summary per invoiced job: the job's live JobTread invoices for
    // the month, read as they stand (fee, tax and total are JobTread's own). It
    // never rebuilds them from bills: a draft copy of an approved bill, or a bill
    // already on an earlier invoice, would add cost the invoice does not carry.
    // Apps Script renders each to a PDF in the job's billing folder (or attaches it).
    const warnings: string[] = [];
    const folderOf = new Map(pkg.jobs.map((j) => [j.jtJobId, j.billingFolderUrl ?? ""]));
    const summaryPdfs: SummaryPdf[] = [];
    const first = `${ym}-01`;
    const byJob = await getMonthInvoiceDetails(cfg, wanted.map((j) => j.jtJobId), first, issueDateFor(ym));
    for (const j of wanted) {
      const list = byJob[j.jtJobId];
      if (!list?.length) {
        warnings.push(`${j.customerLabel} - ${j.jobLabel}: summary not built (no live JobTread invoice dated ${ym}).`);
        continue;
      }
      summaryPdfs.push({
        jobId: j.jtJobId,
        name: `${j.customerLabel} - ${j.jobLabel} - Invoicing Summary ${ym}.pdf`.replace(/[\\/]/g, "-"),
        html: invoiceActualHtml(list, ym),
        folderUrl: j.billingFolderUrl ?? "",
      });
    }
    summaryPdfs.sort((a, b) => a.jobId.localeCompare(b.jobId)); // the reads finish in any order
    const email = composeInvoicingEmail({
      docTitle: pkg.docTitle,
      summaryJobIds: summaryPdfs.map((x) => x.jobId),
      ym,
      jobs: pkg.jobs,
      invoices,
      phases,
    });
    const sheetPdfLinks = email.sheetPdfLinks.map((l) => ({ ...l, folderUrl: folderOf.get(l.jobId) ?? "" }));
    const prices = wanted.map((j) => [j.jtJobId, jobInvoices(j).map((i) => [i.number, i.priceWithTax])]);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([email.subject, email.html, sheetPdfLinks, summaryPdfs, prices]))
      .digest("hex")
      .slice(0, 24);
    return { email, sheetPdfLinks, summaryPdfs, warnings, fingerprint };
  } catch (e) {
    if (e instanceof EmailBuildError) throw e;
    console.error("[invoicing-email]", e);
    throw new EmailBuildError(`Building the email: ${e instanceof Error ? e.message : "Unknown error"}`, 502);
  }
}
