import { NextRequest, NextResponse } from "next/server";

import { getPaveConfig, hasGrant } from "@/lib/config";
import { report } from "@/lib/findings";
import { parseYm } from "@/lib/invoiceReview/evidence";
import { preSendCheck } from "@/lib/invoiceReview/preSend";

/**
 * GET /api/invoice-review/job?jobId=…&ym=YYYY-MM
 *
 * The PRE-SEND GATE: the same checks the monthly review runs, against one job,
 * before its invoice goes to the client. The cheapest moment to catch a billing
 * error is the moment before it is sent — see preSend.ts for what it covers and
 * (just as importantly) what it does not.
 *
 * Read-only, and it files nothing: a per-job spot check is not a review of the
 * month, and writing it into the run history would corrupt the trend the
 * learning layer reads.
 *
 * Gated by the `trackingsheet` view in middleware, because that is the screen
 * it is called from — whoever can raise the invoice can check it first.
 */
export const dynamic = "force-dynamic";
// One job: a reconciliation, its bills, its invoices, one Drive listing. Far
// lighter than a full month, but still several Pave round trips.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!jobId) {
    return NextResponse.json({ error: "Pass ?jobId=<job id>." }, { status: 400 });
  }
  const parsed = parseYm(req.nextUrl.searchParams.get("ym")?.trim() ?? "");
  if (!parsed) {
    return NextResponse.json({ error: "Pass ym=YYYY-MM (the billing month)." }, { status: 400 });
  }

  try {
    const result = await preSendCheck(getPaveConfig(), jobId, parsed.year, parsed.month);
    // Into the findings inbox, one scope per job and month. A check that could
    // not read the whole job must not report: an empty report would resolve
    // the rows it failed to see.
    if (!result.evidenceWarnings.length) {
      await report(
        "pre-send",
        result.findings.map((f) => ({
          key: f.key,
          kind: f.kind,
          subject: f.jobId,
          severity: f.severity,
          title: f.jobName ? `${f.jobName}: ${f.title}` : f.title,
          link: "/trackingsheet",
          dismissed: f.suppressedBy
            ? { by: f.suppressedBy.by, reason: f.suppressedBy.reason, at: f.suppressedBy.at }
            : null,
        })),
        `${result.ym}:${jobId}`,
      ).catch(() => {});
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
