import { NextRequest, NextResponse } from "next/server";
import { prepareInvoiceDraft, sendInvoiceDraft } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { parseBillingYm } from "@/lib/billing";

// "Create draft invoice" on Tracking Sheets: the month's client invoice as a
// DRAFT in JobTread, built from the same data as the invoice preview. The
// office reviews and sends it there. See src/lib/jobtread/invoiceDraft.ts.
//
// POST /api/invoice-draft { jobId, ym: "2026-10" } →
//   { wrote: true, id, url, price } | { previewed: true, wrote: false, price, input } | { error }
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { jobId?: string; ym?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "").trim();
  const period = parseBillingYm(body.ym);
  if (!jobId || !period) {
    return NextResponse.json({ error: 'jobId and ym ("YYYY-MM") required' }, { status: 400 });
  }
  const cfg = getPaveConfig();
  try {
    const plan = await prepareInvoiceDraft(cfg, jobId, period.billingYear, period.billingMonthNum);
    if (!writesEnabled()) {
      return NextResponse.json({ previewed: true, wrote: false, price: plan.price, input: plan.input });
    }
    const made = await sendInvoiceDraft(cfg, jobId, plan);
    return NextResponse.json({ wrote: true, ...made });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
