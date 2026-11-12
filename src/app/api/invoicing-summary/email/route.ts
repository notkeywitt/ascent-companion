import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { callAppsScript } from "@/lib/appsScript";
import { hasGrant } from "@/lib/config";
import { PACKAGE_EMAIL_TO } from "@/lib/invoicingEmail";
import { buildInvoicingEmail, EmailBuildError } from "@/lib/invoicingEmailBuild";
import { getMonthAction, recordMonthAction } from "@/lib/monthActions";

/**
 * POST { ym } — the month's Invoicing Package email as a Gmail draft in the
 * office mailbox. Nothing is attached unless Drive cannot hold a PDF: each PDF
 * is an inline link. The "Draft invoicing email" button on the Package tab.
 * Saves a draft and never sends. Pressed again for the same month, it replaces
 * that month's draft with the latest (Apps Script keeps the draft id). Gated by
 * the `invoicing-summary` view's /api/invoicing-summary prefix.
 *
 * Reads: the month's package (Apps Script's cached read, the one
 * /invoicing-summary shows — so its include/exclude, labels and notes carry into
 * the email), the invoices' ids and QuickBooks ids, the jobs' phases and each
 * job's summary (JobTread). Then Apps Script files each PDF, resolves each link
 * and saves the draft. On success the email's fingerprint is stamped.
 *
 * GET ?ym= — { drafted, draftedAt, stale }. Builds the email again and compares
 * its fingerprint with the one stamped when the draft was made: stale means a
 * bill, amount, coding, note, invoice or link has changed since. No draft yet:
 * answers at once without reading anything.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const STAMP = "invoicing-email";

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const ym = String(((await req.json().catch(() => ({}))) as { ym?: unknown }).ym ?? "");
  try {
    const built = await buildInvoicingEmail(ym);
    const { email, sheetPdfLinks, summaryPdfs, warnings, fingerprint } = built;
    const res = await callAppsScript<{
      ok?: boolean;
      error?: string;
      draftUrl: string;
      updated: boolean;
      warnings: string[];
    }>({ action: "draftInvoicingEmail", ym, to: PACKAGE_EMAIL_TO, ...email, sheetPdfLinks, summaryPdfs }, { timeoutMs: 110_000 });
    if (res.error) return NextResponse.json({ error: `Saving the draft: ${res.error}` }, { status: res.status });
    if (res.data?.ok !== true) {
      return NextResponse.json(
        { error: `Saving the draft: ${res.data?.error || "Apps Script did not say why."}` },
        { status: 502 },
      );
    }
    const session = await auth();
    await recordMonthAction(STAMP, "", ym, session?.user?.email ?? "", fingerprint);
    return NextResponse.json({
      draftUrl: res.data.draftUrl,
      updated: res.data.updated === true,
      warnings: [...warnings, ...(res.data.warnings ?? [])],
    });
  } catch (e) {
    if (e instanceof EmailBuildError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const ym = String(req.nextUrl.searchParams.get("ym") ?? "");
  if (!/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: "ym must look like 2026-09." }, { status: 400 });
  const stamp = await getMonthAction(STAMP, "", ym);
  // A draft made before the fingerprint existed has an empty note: nothing to compare.
  if (!stamp?.note) return NextResponse.json({ drafted: false, draftedAt: "", stale: false });
  try {
    const { fingerprint } = await buildInvoicingEmail(ym);
    return NextResponse.json({ drafted: true, draftedAt: stamp.at, stale: fingerprint !== stamp.note });
  } catch (e) {
    if (e instanceof EmailBuildError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
