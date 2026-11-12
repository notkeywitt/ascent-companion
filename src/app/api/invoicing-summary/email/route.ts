import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getInvoiceRefs, getJobPhaseMap, getUninvoicedBills } from "@/lib/jobtread";
import { invoicePreviewHtml } from "@/lib/invoicePreview";
import type { Detail } from "@/components/BillingSummary";
import { composeInvoicingEmail, PACKAGE_EMAIL_TO, type PackageJob } from "@/lib/invoicingEmail";
import { jobInvoices } from "@/lib/packageInvoices";

/**
 * POST { ym } — the month's Invoicing Package email as a Gmail draft in the
 * office mailbox. Nothing is attached: each PDF is an inline link. The "Draft
 * invoicing email" button on Tracking Sheets' all-jobs view. Saves a draft and
 * never sends. Pressed again for the same month, it replaces that month's draft
 * with the latest (Apps Script keeps the draft id). Gated by the
 * `invoicing-summary` view's /api/invoicing-summary prefix.
 *
 * Three reads, then one write to Gmail: the month's package (Apps Script's
 * cached read, the one /invoicing-summary shows — so its include/exclude, labels
 * and notes carry into the email), the invoices' ids and QuickBooks ids and the
 * jobs' phases and each job's summary (JobTread), then Apps Script renders each
 * summary to a PDF in the job's billing folder, resolves each link and saves the draft.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const ym = String(((await req.json().catch(() => ({}))) as { ym?: unknown }).ym ?? "");
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return NextResponse.json({ error: "ym must look like 2026-09." }, { status: 400 });

  const sum = await callAppsScript<{
    ok?: boolean;
    error?: string;
    docTitle: string;
    invoiceMonthLabel: string;
    jobs: PackageJob[];
  }>({ action: "invoicingSummary", month: Number(m[2]), year: Number(m[1]) }, { timeoutMs: 110_000 });
  // Each failure names its step: reading the month (Apps Script), building the
  // email (JobTread), or saving the draft (Apps Script).
  if (sum.error) return NextResponse.json({ error: `Reading the month: ${sum.error}` }, { status: sum.status });
  if (sum.data?.ok !== true || !Array.isArray(sum.data.jobs)) {
    return NextResponse.json(
      { error: `Reading the month: ${sum.data?.error || "Apps Script sent no job list."}` },
      { status: 502 },
    );
  }
  const pkg = sum.data;

  try {
    const cfg = getPaveConfig();
    const invoiced = pkg.jobs
      .filter((j) => j.include && jobInvoices(j).length > 0)
      .map((j) => j.jtJobId);
    const [invoices, phases] = await Promise.all([getInvoiceRefs(cfg, invoiced), getJobPhaseMap(cfg)]);
    // One Invoicing Summary per invoiced job: the same preview the Summary view
    // prints, read with the Board's own flags (invoiced and draft bills included).
    // Apps Script renders each to a PDF in the job's billing folder.
    const warnings: string[] = [];
    const summaryPdfs: { jobId: string; name: string; html: string; folderUrl: string }[] = [];
    const wanted = pkg.jobs.filter((j) => j.include && jobInvoices(j).length > 0 && j.billingFolderUrl);
    for (const j of pkg.jobs) {
      if (j.include && jobInvoices(j).length > 0 && !j.billingFolderUrl) {
        warnings.push(`${j.customerLabel} - ${j.jobLabel}: no billing folder on Drive, so no Invoicing Summary PDF.`);
      }
    }
    for (let i = 0; i < wanted.length; i += 4) {
      await Promise.all(
        wanted.slice(i, i + 4).map(async (j) => {
          try {
            const detail = await getUninvoicedBills(cfg, j.jtJobId, Number(m[1]), Number(m[2]), true, true);
            summaryPdfs.push({
              jobId: j.jtJobId,
              name: `${j.customerLabel} - ${j.jobLabel} - Invoicing Summary ${ym}.pdf`.replace(/[\\/]/g, "-"),
              html: invoicePreviewHtml(detail as unknown as Detail, ym),
              folderUrl: j.billingFolderUrl ?? "",
            });
          } catch (e) {
            warnings.push(`${j.customerLabel} - ${j.jobLabel}: summary not built (${e instanceof Error ? e.message : "error"}).`);
          }
        }),
      );
    }
    const email = composeInvoicingEmail({
      docTitle: pkg.docTitle,
      monthName: pkg.invoiceMonthLabel,
      summaryJobIds: summaryPdfs.map((x) => x.jobId),
      jobs: pkg.jobs,
      invoices,
      phases,
    });

    const res = await callAppsScript<{
      ok?: boolean;
      error?: string;
      draftUrl: string;
      updated: boolean;
      warnings: string[];
    }>({ action: "draftInvoicingEmail", ym, to: PACKAGE_EMAIL_TO, ...email, summaryPdfs }, { timeoutMs: 110_000 });
    if (res.error) return NextResponse.json({ error: `Saving the draft: ${res.error}` }, { status: res.status });
    if (res.data?.ok !== true) {
      return NextResponse.json(
        { error: `Saving the draft: ${res.data?.error || "Apps Script did not say why."}` },
        { status: 502 },
      );
    }
    return NextResponse.json({
      draftUrl: res.data.draftUrl,
      updated: res.data.updated === true,
      warnings: [...warnings, ...(res.data.warnings ?? [])],
    });
  } catch (e) {
    console.error("[invoicing-email]", e);
    return NextResponse.json(
      { error: `Building the email: ${e instanceof Error ? e.message : "Unknown error"}` },
      { status: 502 },
    );
  }
}
