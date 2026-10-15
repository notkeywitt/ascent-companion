import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getInvoiceQboIds, getJobPhaseMap } from "@/lib/jobtread";
import { composeInvoicingEmail, PACKAGE_EMAIL_TO, type PackageJob } from "@/lib/invoicingEmail";

/**
 * POST { ym } — the month's Invoicing Package email as a Gmail draft in the
 * office mailbox, each job's tracking sheet attached as a PDF. The "Draft
 * invoicing email" button on Tracking Sheets' all-jobs view. Saves a draft and
 * never sends. Gated by the `invoicing-summary` view's /api/invoicing-summary
 * prefix.
 *
 * Three reads, then one write to Gmail: the month's package (Apps Script's
 * cached read, the one /invoicing-summary shows — so its include/exclude, labels
 * and notes carry into the email), the invoices' QuickBooks ids and the jobs'
 * phases (JobTread), then Apps Script exports each sheet tab and saves the draft.
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
  if (sum.error) return NextResponse.json({ error: sum.error }, { status: sum.status });
  if (sum.data?.ok !== true) {
    return NextResponse.json({ error: sum.data?.error || "The Invoicing Package could not be read." }, { status: 502 });
  }
  const pkg = sum.data;

  try {
    const cfg = getPaveConfig();
    const invoiced = pkg.jobs.filter((j) => j.include && j.invoiceNumber).map((j) => j.jtJobId);
    const [qboIds, phases] = await Promise.all([getInvoiceQboIds(cfg, invoiced), getJobPhaseMap(cfg)]);
    const email = composeInvoicingEmail({
      docTitle: pkg.docTitle,
      monthName: pkg.invoiceMonthLabel,
      jobs: pkg.jobs,
      qboIds,
      phases,
    });

    const res = await callAppsScript<{
      ok?: boolean;
      error?: string;
      draftUrl: string;
      attached: number;
      warnings: string[];
    }>({ action: "draftInvoicingEmail", to: PACKAGE_EMAIL_TO, ...email }, { timeoutMs: 110_000 });
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
    if (res.data?.ok !== true) {
      return NextResponse.json({ error: res.data?.error || "The draft could not be saved." }, { status: 502 });
    }
    return NextResponse.json({
      draftUrl: res.data.draftUrl,
      attached: res.data.attached,
      sheets: email.sheets.length,
      warnings: res.data.warnings ?? [],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
