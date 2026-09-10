import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildBillPdf } from "@/lib/billPdf";
import { attachFileToDocument, getBillDetail, getJobHeaderInfo } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * The header facts as read off the bill today — what the dialog pre-fills and
 * the office can then type over. Shared by GET (prefill) and POST (the
 * fallback for any field left blank), so the two can never drift apart on
 * what "the bill's own value" means.
 */
async function defaultFields(docId: string) {
  const cfg = getPaveConfig();
  const detail = await getBillDetail(cfg, docId);
  if (!detail.header?.id) throw Object.assign(new Error("That bill does not exist."), { status: 404 });

  const job = detail.jobId ? await getJobHeaderInfo(cfg, detail.jobId).catch(() => null) : null;
  const h = detail.header;
  return {
    detail,
    fields: {
      vendor: h.vendorName || h.fromName || h.subject || h.name || "",
      billNumber: h.number ? String(h.number) : "",
      job: job?.name ?? "",
      customer: job?.customer ?? "",
      issueDate: (h.issueDate ?? "").slice(0, 10),
      dueDate: (h.dueDate ?? "").slice(0, 10) || (h.dueDays ? `net-${h.dueDays}` : ""),
    },
  };
}

/** Read-only: the values the Create File dialog pre-fills. */
export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const docId = req.nextUrl.searchParams.get("docId")?.trim();
  if (!docId) return NextResponse.json({ error: "Pass docId" }, { status: 400 });
  try {
    const { detail, fields } = await defaultFields(docId);
    return NextResponse.json({ ...fields, hasFile: detail.files.length > 0 });
  } catch (e) {
    const status = (e as { status?: number })?.status ?? 502;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read the bill." },
      { status },
    );
  }
}

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
 * JSON body: { docId, description, vendor?, billNumber?, job?, customer?,
 * issueDate?, dueDate? } — the office edits the GET's pre-filled values, and
 * anything left blank falls back to the bill's own value, read fresh here
 * rather than trusted from the client.
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
  // A typed override wins; "" (cleared on purpose, or never sent) falls back
  // to the bill's own value below rather than printing a blank field.
  const overrides: Record<string, string> = {};
  for (const key of ["vendor", "billNumber", "job", "customer", "issueDate", "dueDate"] as const) {
    const v = body?.[key];
    if (typeof v === "string" && v.trim()) overrides[key] = v.trim();
  }

  try {
    const { detail, fields } = await defaultFields(docId);
    if (detail.files.length > 0) {
      return NextResponse.json(
        { error: "This bill already has a file attached." },
        { status: 409 },
      );
    }
    const f = { ...fields, ...overrides };

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

    const vendor = f.vendor || "Vendor";
    const session = await auth().catch(() => null);
    const pdf = buildBillPdf({
      vendor,
      billNumber: f.billNumber,
      job: f.job,
      customer: f.customer,
      issueDate: f.issueDate,
      dueDate: f.dueDate,
      status: h.status ?? "",
      description,
      lines,
      total: h.cost ?? lines.reduce((s, l) => s + l.amount, 0),
      createdBy: session?.user?.email ?? "",
    });

    const stamp = f.issueDate || new Date().toISOString().slice(0, 10);
    const safeVendor = vendor.replace(/[^A-Za-z0-9 .-]/g, "").trim() || "Vendor";
    const name = `${stamp} ${safeVendor}${f.billNumber ? ` #${f.billNumber}` : ""} (no invoice).pdf`;

    const cfg = getPaveConfig();
    const { id } = await attachFileToDocument(cfg, docId, pdf, "application/pdf", name);
    return NextResponse.json({ ok: true, fileId: id, name });
  } catch (e) {
    const status = (e as { status?: number })?.status ?? 502;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create the file." },
      { status },
    );
  }
}
