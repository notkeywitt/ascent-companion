import { NextRequest, NextResponse } from "next/server";
import { setBillIssueDate } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { journalBillWrite } from "@/lib/billJournal";

// Set a bill's issueDate (its billing month = last day). Gated by writes flag.
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docId?: string; issueDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  const issueDate = (body.issueDate ?? "").trim();
  if (!docId || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    return NextResponse.json({ error: "docId and YYYY-MM-DD issueDate required" }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, issueDate });
  }
  const cfg = getPaveConfig();
  try {
    // The issue date IS the billing period in JobTread, so this is one of the
    // most consequential single-field edits in the app — and the one most worth
    // being able to trace back to a person and a prior value.
    const saved = await journalBillWrite({
      route: "/api/bill-issuedate",
      action: "bill.issueDate.set",
      cfg,
      docId,
      field: "issueDate",
      priorField: "issueDate",
      attempted: issueDate,
      run: () => setBillIssueDate(cfg, docId, issueDate),
      after: (saved) => saved,
    });
    return NextResponse.json({ wrote: true, issueDate: saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
