import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildBillPdf } from "@/lib/billPdf";
import { attachFileToDocument, getBillDetail, getJobHeaderInfo } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * WRITE — stand in for a missing vendor invoice.
 *
 * Some bills arrive with no document at all: a phone order, a counter charge,
 * a vendor who never sends a PDF. The bill is real, the cost is real, and the
 * board marks it "No file" — but a bill with no file never reaches Drive, so
 * the month's backup has a hole in it that no amount of coding closes.
 *
 * This makes the missing document: an Ascent-branded record of what the bill
 * says, plus the office's own description of what the charge was for, attached
 * to the same JobTread document. The hourly mirror files it into Drive like any
 * other attachment.
 *
 * Refuses when the bill ALREADY has a file — this is the substitute for a
 * missing invoice, never a second copy on top of a real one.
 *
 * JSON body: { docId, description }
 */
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Writes are OFF (COMPANION_WRITES_ENABLED)." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const docId = String(body?.docId ?? "").trim();
  const description = String(body?.description ?? "").trim();
  if (!docId) return NextResponse.json({ error: "Missing docId." }, { status: 400 });
  if (!description) {
    return NextResponse.json({ error: "A description is required." }, { status: 400 });
  }
  if (description.length > 2000) {
    return NextResponse.json({ error: "Description is longer than 2000 characters." }, { status: 400 });
  }

  try {
    const cfg = getPaveConfig();
    const detail = await getBillDetail(cfg, docId);
    if (!detail.header?.id) {
      return NextResponse.json({ error: "That bill does not exist." }, { status: 404 });
    }
    if (detail.files.length > 0) {
      return NextResponse.json(
        { error: "This bill already has a file attached." },
        { status: 409 },
      );
    }

    const job = detail.jobId
      ? await getJobHeaderInfo(cfg, detail.jobId).catch(() => null)
      : null;
    const h = detail.header;
    const lines = detail.lines.map((l) => ({
      name: l.name || l.description || "Line item",
      code: [l.costCode?.number, l.costCode?.name].filter(Boolean).join(" "),
      quantity: l.quantity ?? null,
      amount: l.cost ?? 0,
    }));
    // The legacy document-tax field, when a pre-2026-09-05 bill still carries
    // one, is a real part of the total and would otherwise vanish from the page.
    if (h.nonRecoverableTax) {
      lines.push({ name: "Sales tax", code: "", quantity: null, amount: h.nonRecoverableTax });
    }

    const vendor = h.fromName || h.subject || h.name || "Vendor";
    const session = await auth().catch(() => null);
    const pdf = buildBillPdf({
      vendor,
      billNumber: h.number ? String(h.number) : "",
      job: job?.name ?? "",
      customer: job?.customer ?? "",
      issueDate: (h.issueDate ?? "").slice(0, 10),
      dueDate: (h.dueDate ?? "").slice(0, 10) || (h.dueDays ? `net-${h.dueDays}` : ""),
      status: h.status ?? "",
      description,
      lines,
      total: h.cost ?? lines.reduce((s, l) => s + l.amount, 0),
      createdBy: session?.user?.email ?? "",
    });

    const stamp = (h.issueDate ?? new Date().toISOString()).slice(0, 10);
    const safeVendor = vendor.replace(/[^A-Za-z0-9 .-]/g, "").trim() || "Vendor";
    const name = `${stamp} ${safeVendor}${h.number ? ` #${h.number}` : ""} (no invoice).pdf`;

    const { id } = await attachFileToDocument(cfg, docId, pdf, "application/pdf", name);
    return NextResponse.json({ ok: true, fileId: id, name });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create the file." },
      { status: 502 },
    );
  }
}
