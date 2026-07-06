import { NextRequest, NextResponse } from "next/server";
import { getUninvoicedBills, createDraftInvoice } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

// GET ?jobId= — individual uninvoiced bills (what a new draft will pull).
export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "Pass jobId" }, { status: 400 });
  }
  const year = Number(req.nextUrl.searchParams.get("year")) || undefined;
  const month = Number(req.nextUrl.searchParams.get("month")) || undefined;
  try {
    const data = await getUninvoicedBills(getPaveConfig(), jobId, year, month);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

// POST — create a bare DRAFT customer invoice; JobTread auto-pulls the job's
// uninvoiced bills. { jobId, issueDate }. Gated by writes flag.
export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  let body: { jobId?: string; issueDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const jobId = (body.jobId ?? "").trim();
  const issueDate = (body.issueDate ?? "").trim();
  if (!jobId || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    return NextResponse.json({ error: "jobId and YYYY-MM-DD issueDate are required" }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF. Would create a draft invoice; JobTread pulls the uninvoiced bills.",
    });
  }
  try {
    const res = await createDraftInvoice(getPaveConfig(), { jobId, issueDate });
    const created = (res as any)?.createDocument?.createdDocument ?? null;
    return NextResponse.json({ wrote: true, created });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
