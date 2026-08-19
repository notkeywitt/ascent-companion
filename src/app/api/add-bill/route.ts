import { NextRequest, NextResponse } from "next/server";
import {
  attachFileToDocument,
  createVendorBill,
  findBillByExternalId,
  getJobBudget,
  getJobHeaderInfo,
  getVendors,
  type NewBillLine,
  type VendorRef,
} from "@/lib/jobtread";
import { extractBillWithGemini, type ExtractedBill } from "@/lib/gemini";
import {
  companyDateParts,
  computeBillDates,
  computeLineTaxability,
  taxReconcileWarning,
} from "@/lib/billing";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { kickJtSync } from "@/lib/appsScript";

/**
 * Roadmap D — add a bill without the email card: upload a photo/PDF of an
 * invoice, run it through the Gemini coding engine, and create a DRAFT vendor
 * bill in JobTread (= the coding queue). Mirrors the Gmail add-on's onLogInvoice
 * orchestration:
 *   - the JOB is always human-picked (never AI);
 *   - billing period derives from the UPLOAD moment (arrival date standard),
 *     never a date printed on the document;
 *   - the Vendor Bill Number (JobTread externalId) is the invoice/bill number
 *     Gemini reads off the document; when none is legible it falls back to
 *     <Vendor><MMDDYY>-<tag> of the arrival date (e.g. "HomeDepot081926-a1b2c3d4"),
 *     where <tag> is the per-file token so two no-number bills from one vendor on
 *     one day don't collide. That number also serves as the dedup key, so a
 *     re-upload of the same invoice is caught. Sunset bills keep the per-file
 *     idempotency token instead (their numbering is owned by the statement flow);
 *   - Gemini codes each line against the job's live budget; out-of-budget codes
 *     land UNCODED (the assistant's coding queue is the review step, replacing
 *     the AppSheet placeholder-CSI convention);
 *   - respects the COMPANION_WRITES_ENABLED gate — off = full preview, no write.
 *
 * multipart/form-data fields:
 *   file        the invoice (pdf or image), ≤15 MB
 *   jobId       required
 *   externalId  required per-file token from the UI ("INV-xxxxxxxx"); the dedup
 *               key for Sunset bills, superseded by the extracted Vendor Bill
 *               Number for everyone else
 *   vendorId    optional JT account override (skip/replace Gemini's match)
 */

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/** Clean an extracted invoice/bill number for JobTread's externalId (≤32 chars).
 *  Invoice numbers never carry internal spaces, so we strip whitespace and cap
 *  the length; anything left is returned verbatim. */
function sanitizeBillNumber(raw: string): string {
  return String(raw ?? "").replace(/\s+/g, "").trim().slice(0, 32);
}

/** Fallback Vendor Bill Number when the document shows no legible invoice number:
 *  <VendorName><MMDDYY>-<tag> of the ARRIVAL date (e.g. "HomeDepot081926-a1b2c3d4"),
 *  matching the arrival-date billing standard the rest of ingestion uses. The tag
 *  is the per-file token the UI generates: it holds steady across a retry of one
 *  upload (so the dedup still catches a re-submit) but differs between separate
 *  uploads, so two no-number bills from the same vendor on the same day do NOT
 *  collide on the externalId. Alphanumerics only in the vendor part; capped to
 *  JobTread's 32-char externalId, with the date + tag reserved first so they
 *  always survive the cap. */
function fallbackBillNumber(vendorName: string, arrival: Date, tag: string): string {
  const p = companyDateParts(arrival);
  const mmddyy =
    String(p.month).padStart(2, "0") +
    String(p.day).padStart(2, "0") +
    String(p.year).slice(-2);
  const suffix = tag ? `-${tag}` : "";
  const room = Math.max(0, 32 - mmddyy.length - suffix.length);
  const v = vendorName.replace(/[^A-Za-z0-9]/g, "").slice(0, room);
  return (v + mmddyy + suffix).slice(0, 32);
}

/** Resolve Gemini's Vendor answer (ideally a JT account id) to an account. */
function resolveVendor(extractedVendor: string, vendors: VendorRef[]): VendorRef | null {
  const raw = extractedVendor.trim();
  if (!raw) return null;
  const cleaned = raw.replace(/\s*NEW VENDOR\s*$/i, "").trim();
  const byId = vendors.find((v) => v.id === cleaned || v.id === raw);
  if (byId) return byId;
  const lc = cleaned.toLowerCase();
  const byName = vendors.find((v) => v.name.trim().toLowerCase() === lc);
  if (byName) return byName;
  // last resort: unambiguous substring match on the name
  const contains = vendors.filter(
    (v) => lc.length >= 4 && v.name.toLowerCase().includes(lc),
  );
  return contains.length === 1 ? contains[0] : null;
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  if (!process.env.GEMINI_KEY) {
    return NextResponse.json({ error: "GEMINI_KEY is not set." }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  const jobId = String(form.get("jobId") ?? "").trim();
  const externalId = String(form.get("externalId") ?? "").trim();
  const vendorOverride = String(form.get("vendorId") ?? "").trim();
  const singleLine = /^(1|true|on|yes)$/i.test(String(form.get("singleLine") ?? "").trim());

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (!jobId) return NextResponse.json({ error: "Pick a job first." }, { status: 400 });
  if (!/^INV-[0-9a-f]{8}$/i.test(externalId)) {
    return NextResponse.json({ error: "Missing or malformed externalId." }, { status: 400 });
  }
  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: `Unsupported file type "${mime}". Upload a PDF or photo.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 15 MB." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());

  const cfg = getPaveConfig();
  const warnings: string[] = [];

  try {
    // ---- 1. context for the prompt: live budget codes + JT vendor accounts --
    const [budget, vendors, jobInfo] = await Promise.all([
      getJobBudget(cfg, jobId),
      getVendors(cfg),
      getJobHeaderInfo(cfg, jobId),
    ]);
    // one coding target per cost code (first budget leaf wins, like the
    // Apps Script budget map); Gemini sees each code once
    const codeToItem = new Map<string, { id: string; name: string }>();
    for (const b of budget) {
      if (!codeToItem.has(b.number)) codeToItem.set(b.number, { id: b.id, name: b.name });
    }
    const budgetCodes = [...codeToItem.entries()].map(([number, v]) => ({
      number,
      name: v.name,
    }));

    // ---- 2. Gemini extraction (job comes from the picker, not AI) ----------
    const extracted: ExtractedBill | null = await extractBillWithGemini(
      bytes,
      mime,
      vendors,
      budgetCodes,
    );
    if (!extracted) {
      return NextResponse.json(
        { error: "Gemini extraction failed — nothing was created. Try again." },
        { status: 502 },
      );
    }

    // ---- 3. resolve the vendor account --------------------------------------
    let vendor: VendorRef | null = null;
    if (vendorOverride) {
      vendor = vendors.find((v) => v.id === vendorOverride) ?? null;
      if (!vendor) {
        return NextResponse.json({ error: "Unknown vendorId override." }, { status: 400 });
      }
    } else {
      vendor = resolveVendor(String(extracted.Vendor ?? ""), vendors);
    }
    if (!vendor) {
      // Not an error — the UI shows the vendor picker and resubmits with vendorId.
      return NextResponse.json(
        {
          vendorUnresolved: true,
          extractedVendor: String(extracted.Vendor ?? ""),
          message:
            "Couldn't match the vendor to a JobTread account. Pick one and resubmit " +
            "(or add the vendor in JobTread first).",
        },
        { status: 422 },
      );
    }

    // ---- 4. dates + Vendor Bill Number — both anchored to the upload moment ---
    const sunsetId = (process.env.JT_SUNSET_VENDOR_ID ?? "").trim();
    const isSunset =
      (sunsetId !== "" && vendor.id === sunsetId) || /sunset builders/i.test(vendor.name);
    const arrival = new Date();
    const dates = computeBillDates(arrival, isSunset, extracted.DueDate);
    warnings.push(...dates.warnings);

    // Vendor Bill Number (JobTread's externalId, shown as the bill's number and
    // used for dedup). For non-Sunset bills, use the invoice/bill number Gemini
    // read off the document; when none is legible, fall back to <Vendor><MMDDYY>
    // of the arrival date. Sunset keeps the per-file idempotency token it already
    // carried (its own numbering convention is handled by the statement flow).
    const extractedBillNumber = sanitizeBillNumber(String(extracted.InvoiceNumber ?? ""));
    // Disambiguator for the fallback: the per-file token's hex tail (INV-<tag>).
    const tag = externalId.replace(/^INV-/i, "").trim();
    const billNumber = isSunset
      ? externalId
      : extractedBillNumber || fallbackBillNumber(vendor.name, arrival, tag);
    if (!isSunset && !extractedBillNumber) {
      warnings.push(
        `No invoice number was legible on the document — set the Vendor Bill Number to "${billNumber}" ` +
          `(vendor + arrival date + a unique tag). Edit it in JobTread if the invoice has a number.`,
      );
    }

    // ---- 5. line items — code against the budget, uncoded when out-of-budget
    const tax = computeLineTaxability(extracted.Tax);
    const items = extracted.items ?? [];
    let uncoded = 0;
    let lines: NewBillLine[] = items.map((it) => {
      const csi = String(it.csi ?? "").trim();
      const target = csi ? codeToItem.get(csi) : undefined;
      if (csi && !target) uncoded++;
      // qty: keep an explicit 0 (credit/removal lines), default blank/non-numeric
      // to 1 — same semantics as the Apps Script _jtParseQty
      const qn = parseFloat(String(it.quantity));
      return {
        name: String(it.description ?? "Line Item"),
        description: csi,
        unitCost: Number(it.price) || 0,
        quantity: Number.isFinite(qn) ? qn : 1,
        isTaxable: tax.lineIsTaxable,
        jobCostItemId: target?.id,
        costCode: csi || undefined,
      };
    });
    if (uncoded > 0) {
      warnings.push(
        `${uncoded} line(s) had a cost code outside the job's budget — they land uncoded; ` +
          `code them in the queue.`,
      );
    }
    // Guarantee at least one line (same fallback as production)
    if (lines.length === 0) {
      lines.push({
        name: `${vendor.name} ${billNumber} — Review Required`,
        unitCost: Number(extracted.Amount) || 0,
        quantity: 1,
        isTaxable: tax.lineIsTaxable,
      });
      warnings.push("No line items extracted — created a single summary line.");
    }

    // Optional "don't itemize": collapse the extracted lines into ONE cost item at
    // the exact net total (tax stays on nonRecoverableTax). Carries the shared cost
    // code if every line agrees on one, otherwise leaves it uncoded to code once in
    // the queue. For invoices with a ton of lines that don't need breaking down.
    if (singleLine && lines.length > 1) {
      const n = lines.length;
      const net = lines.reduce((s, l) => s + (Number(l.unitCost) || 0) * (Number(l.quantity) || 0), 0);
      const csis = [...new Set(lines.map((l) => l.costCode).filter(Boolean))];
      const oneCode = csis.length === 1 ? (csis[0] as string) : undefined;
      lines = [
        {
          name: `${vendor.name} ${billNumber} — ${n} items (not itemized)`,
          description: oneCode ?? "",
          unitCost: net,
          quantity: 1,
          isTaxable: tax.lineIsTaxable,
          jobCostItemId: oneCode ? codeToItem.get(oneCode)?.id : undefined,
          costCode: oneCode,
        },
      ];
      warnings.push(
        `Collapsed ${n} extracted lines into one${oneCode ? ` (coded ${oneCode})` : " — code it in the queue"}.`,
      );
    }

    const reconcile = taxReconcileWarning(extracted);
    if (reconcile) warnings.push(reconcile);

    const codes = [...new Set(lines.map((l) => l.costCode).filter(Boolean))].join(", ");
    const billArgs = {
      jobId,
      accountId: vendor.id,
      vendorName: isSunset ? "Sunset Builders Supply" : vendor.name,
      subject: `${jobInfo.name} - ${vendor.name}${codes ? ` - ${codes}` : ""}`,
      externalId: billNumber,
      issueDate: dates.issueDate,
      dueDate: dates.dueDate,
      dueDays: dates.dueDays,
      taxAmount: tax.taxAmount,
      jobLocationName: jobInfo.name || undefined,
      jobLocationAddress: jobInfo.address || undefined,
      lines,
    };

    const summary = {
      vendor: vendor.name,
      vendorId: vendor.id,
      isSunset,
      amount: Number(extracted.Amount) || 0,
      tax: tax.taxAmount,
      lineCount: lines.length,
      codedLines: lines.filter((l) => l.jobCostItemId).length,
      billingMonth: dates.billing.billingMonthNum,
      billingYear: dates.billing.billingYear,
      issueDate: dates.issueDate,
      dueDate: dates.dueDate ?? `net-${dates.dueDays}`,
      externalId: billNumber,
      warnings,
    };

    // ---- 6. writes gate (DRY_RUN parity) ------------------------------------
    if (!writesEnabled()) {
      return NextResponse.json({
        previewed: true,
        wrote: false,
        message:
          "Writes are OFF (COMPANION_WRITES_ENABLED not set). This is what WOULD be created.",
        ...summary,
        lines: lines.map((l) => ({
          name: l.name,
          csi: l.costCode ?? "",
          coded: Boolean(l.jobCostItemId),
          unitCost: l.unitCost,
          quantity: l.quantity,
        })),
      });
    }

    // ---- 7. idempotency — fail CLOSED on API error, adopt an existing doc ---
    let existing: string | null;
    try {
      existing = await findBillByExternalId(cfg, vendor.id, billNumber);
    } catch (e) {
      return NextResponse.json(
        {
          error:
            "Couldn't verify whether this bill already exists in JobTread — not creating, " +
            "to avoid a duplicate. Try again in a moment.",
        },
        { status: 502 },
      );
    }
    if (existing) {
      return NextResponse.json({
        previewed: false,
        wrote: false,
        alreadyExisted: true,
        docId: existing,
        ...summary,
      });
    }

    // ---- 8. create the draft bill, then attach the file ---------------------
    const { id: docId } = await createVendorBill(cfg, billArgs);

    let fileAttached = true;
    try {
      const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1] || "bin";
      const name = file.name && file.name.includes(".") ? file.name : `${billNumber}.${ext}`;
      await attachFileToDocument(cfg, docId, bytes, mime, name);
    } catch (e) {
      fileAttached = false;
      warnings.push(
        `Bill created but the file attach failed (${e instanceof Error ? e.message : "unknown"}) — ` +
          `attach it manually in JobTread.`,
      );
    }

    // ---- 9. nudge the Apps Script full sync (fire-and-forget, FAIL-SAFE) -----
    // Kick runFullJtSync so this new bill — and any vendor just added for it —
    // mirrors into the Expenditure sheet + Drive within ~1-2 min instead of
    // waiting up to an hour for the scheduled run. runFullJtSync now refreshes
    // Vendors BEFORE importing bills, so the backfilled row resolves the vendor
    // cleanly. This must NEVER affect the bill result: any error (missing env,
    // network, non-JSON) is swallowed — the hourly runFullJtSync is the backstop.
    // null = the bridge isn't configured at all, which is not worth warning about.
    const kick = await kickJtSync();
    const syncKicked = kick === true;
    if (kick === false) {
      warnings.push("Bill created, but the sheet/Drive sync kick didn't confirm — it'll sync on the next hourly run.");
    }

    return NextResponse.json({
      previewed: false,
      wrote: true,
      docId,
      fileAttached,
      syncKicked,
      ...summary,
      warnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
