import { NextRequest, NextResponse } from "next/server";
import { getMonthlyInvoiceJobs } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

// GET ?year=&month= — the roster of jobs with uninvoiced bills issued in a
// billing month (the Invoicing tab's default all-jobs preview). Each row is a
// client invoice to stage; the page then loads each job's full breakdown from
// GET /api/stage?jobId=. includeInvoiced=1 / includeDrafts=1 mirror the tab's
// toggles.
export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  if (!year || !month) {
    return NextResponse.json({ error: "Pass year and month" }, { status: 400 });
  }
  const includeInvoiced = req.nextUrl.searchParams.get("includeInvoiced") === "1";
  const includeDrafts = req.nextUrl.searchParams.get("includeDrafts") === "1";
  try {
    const jobs = await getMonthlyInvoiceJobs(
      getPaveConfig(),
      year,
      month,
      includeInvoiced,
      includeDrafts,
    );
    return NextResponse.json({ jobs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
