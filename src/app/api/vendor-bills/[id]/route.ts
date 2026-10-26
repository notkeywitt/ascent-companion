import { NextResponse } from "next/server";
import { getVendorBills, getVendorDetail } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getArchiveBillsForVendor } from "@/lib/billSearch";

/**
 * Read-only: one vendor's bills — job, date, amount, status — plus the
 * vendor's own contact details (email, phone, address), for the /vendors page.
 * `archive` adds the vendor's pre-JobTread bills from the bill search index
 * (lib/billSearch), matched by name — the same rows the header search shows.
 * Both in one response because the page shows them together, off one tap.
 * Deliberately NOT cached: a vendor lookup is a one-off action, not a page
 * every load hits, and bill status can change between visits.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const cfg = getPaveConfig();
    // The details must not sink the bills: a vendor with no contact record
    // still has a month of bills to read.
    const [bills, detail] = await Promise.all([
      getVendorBills(cfg, id),
      getVendorDetail(cfg, id).catch(() => null),
    ]);
    // The archive is extra: an unreadable index must not sink the live bills.
    const archive = detail?.name
      ? await getArchiveBillsForVendor(detail.name).catch(() => [])
      : [];
    return NextResponse.json({
      bills,
      detail,
      archive: archive.map((b) => ({
        id: b.id,
        invoiceId: b.invoiceId,
        jobName: b.jobName,
        amount: b.amount,
        status: b.status,
        issueDate: b.issueDate,
        pdfFileId: b.pdfFileId,
      })),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
