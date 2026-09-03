import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

/**
 * The invoice capture email tag for a job — read the list, create the missing one.
 *
 * WHAT THE TAG IS. Apps Script (`EmailToJtInvoice.js`) scans Gmail every 15
 * minutes for mail carrying a label named `_JT Invoice <Customer> - <Job>`, and
 * logs each tagged EMAIL as a vendor bill against that job — Drive file,
 * Expenditure row, optional JobTread draft. Tagging is the whole "which job"
 * answer, so a job with no label cannot be captured that way at all.
 *
 * WHY THIS ROUTE EXISTS. Creating the label was the one step of that scheme that
 * needed a laptop, and a hand-typed label that does not match a project is a tag
 * the scan leaves stuck forever. The Assistant has no Gmail grant, so it asks
 * Apps Script — which derives the label text from the SAME project list the
 * resolver matches against. The browser never composes the string; it names a
 * JobTread job.
 *
 *   GET                → { ok, prefix, tags:[{jobId, projectId, label, tag, exists}],
 *                          unresolved:[tagName] }
 *   POST { jobId }     → { ok, tag, label, created }   (created:false = it existed)
 *
 * DEPLOYMENT NOTE. Apps Script deploys by hand (`./deploy.sh` in that repo), so
 * an older `/exec` will not know these actions and answers "Unknown action".
 * That is translated here into a sentence the office can act on rather than
 * surfaced raw.
 */
export const dynamic = "force-dynamic";

/** Apps Script's own wording when the deployment predates an action. */
const UNKNOWN_ACTION = /unknown action/i;
const NEEDS_DEPLOY =
  "The Apps Script web app does not have the invoice-tag actions yet. " +
  "Run ./deploy.sh in the ascent-appscript repo, then try again.";

function unwrap(res: { data?: Record<string, unknown>; error?: string; status: number }) {
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  const b = res.data ?? {};
  if (b.ok !== true) {
    const raw = String(b.error || "Apps Script rejected the request.");
    return NextResponse.json(
      { error: UNKNOWN_ACTION.test(raw) ? NEEDS_DEPLOY : raw },
      { status: 502 },
    );
  }
  return NextResponse.json(b);
}

export async function GET() {
  return unwrap(await callAppsScript<Record<string, unknown>>({ action: "listInvoiceTags" }));
}

export async function POST(req: NextRequest) {
  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const jobId = (body.jobId ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  // Idempotent on the Apps Script side (getOrCreateGmailLabel), so a retry after
  // a lost response cannot create a second label — but a retry is still not
  // requested here, because `isRetryable` treats an unknown action as a write.
  return unwrap(
    await callAppsScript<Record<string, unknown>>({ action: "createInvoiceTag", jobId }),
  );
}
