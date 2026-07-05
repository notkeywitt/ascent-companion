import { NextRequest, NextResponse } from "next/server";
import { getMonthlyBills, createDraftInvoice, type InvoiceLine } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

// GET ?jobId=&year=&month= — the month's unbilled costs per code + customer.
export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  if (!jobId || !year || !month) {
    return NextResponse.json({ error: "Pass jobId, year, month" }, { status: 400 });
  }
  try {
    const data = await getMonthlyBills(getPaveConfig(), jobId, year, month);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

// POST — create a DRAFT customer invoice from the chosen lines.
// { jobId, accountId, issueDate, lineItems[] }. Gated by writes flag.
export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  let body: { jobId?: string; accountId?: string; issueDate?: string; lineItems?: InvoiceLine[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { jobId, accountId, issueDate } = body;
  const lineItems = (body.lineItems ?? []).filter((l) => l.name && l.cost > 0);
  if (!jobId || !accountId || !issueDate || lineItems.length === 0) {
    return NextResponse.json(
      { error: "jobId, accountId, issueDate and at least one positive line are required" },
      { status: 400 },
    );
  }
  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF. This is what would be created as a draft invoice.",
      draft: { jobId, accountId, issueDate, lineItems },
    });
  }
  try {
    const res = await createDraftInvoice(getPaveConfig(), { jobId, accountId, issueDate, lineItems });
    const created = (res as any)?.createDocument?.createdDocument ?? null;
    return NextResponse.json({ wrote: true, created });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
