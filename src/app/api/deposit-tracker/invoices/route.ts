import { NextResponse } from "next/server";
import { getOpenCustomerInvoices } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * GET — every client invoice that can take a payment (pending or approved, a
 * balance still owed), by customer, then job, then number. The deposit
 * tracker's invoice list. Read-only; the same walk Receivables uses.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  try {
    const rows = await getOpenCustomerInvoices(getPaveConfig());
    const invoices = rows
      .filter((r) => Math.round(r.balance * 100) > 0)
      .sort(
        (a, b) =>
          a.customerName.localeCompare(b.customerName) ||
          a.jobName.localeCompare(b.jobName) ||
          (Number(a.number) || 0) - (Number(b.number) || 0),
      );
    return NextResponse.json({ invoices });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
