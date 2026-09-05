import { NextRequest, NextResponse } from "next/server";
import { getBillDetail, getSalesTaxLeafId, setBillTax } from "@/lib/jobtread";
import { splitSalesTax } from "@/lib/salesTax";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { journalBillWrite } from "@/lib/billJournal";

// Set a bill's sales tax. The tax is a LINE coded 88 80 00, not a document field
// (src/lib/salesTax.ts), so this reads the bill first: to find the line to write,
// to code it to the job's 88 80 00 budget leaf, and to journal what the tax was
// before. Gated by the writes flag: with writes OFF it previews and sends nothing.
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docId?: string; taxAmount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  const taxAmount = Number(body.taxAmount);
  if (!docId || !Number.isFinite(taxAmount) || taxAmount < 0) {
    return NextResponse.json(
      { error: "docId and a non-negative taxAmount are required" },
      { status: 400 },
    );
  }
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, taxAmount });
  }
  const cfg = getPaveConfig();
  try {
    // The bill's job gives us the 88 80 00 leaf to code the line to. A job whose
    // budget has no such leaf leaves the line uncoded — never routed to a
    // fallback code, which would post sales tax to the wrong QuickBooks account.
    const detail = await getBillDetail(cfg, docId);
    const leafId = await getSalesTaxLeafId(cfg, detail.jobId);
    const prior = splitSalesTax(detail.lines, detail.header.nonRecoverableTax ?? 0).taxAmount;

    const saved = await journalBillWrite({
      route: "/api/bill-tax",
      action: "bill.tax.set",
      cfg,
      docId,
      field: "salesTax",
      // The header snapshot only knows the legacy field; the real prior value is
      // the tax LINE plus that field, which `prior` already holds.
      priorField: "nonRecoverableTax",
      before: prior,
      attempted: taxAmount,
      amount: taxAmount,
      run: () => setBillTax(cfg, docId, taxAmount, leafId),
      after: (saved) => saved,
    });
    return NextResponse.json({
      wrote: true,
      taxAmount: saved,
      priorTaxAmount: prior,
      coded: Boolean(leafId),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
