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
import { computeBillDates, computeLineTaxability, taxReconcileWarning } from "@/lib/billing";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

/**
 * Roadmap D — add a bill without the email card: upload a photo/PDF of an
 * invoice, run it through the Gemini coding engine, and create a DRAFT vendor
 * bill in JobTread (= the coding queue). Mirrors the Gmail add-on's onLogInvoice
 * orchestration:
 *   - the JOB is always human-picked (never AI);
 *   - billing period derives from the UPLOAD moment (arrival date standard),
 *     never a date printed on the document;
 *   - Gemini codes each line against the job's live budget; out-of-budget codes
 *     land UNCODED (the companion's coding queue is the review step, replacing
 *     the AppSheet placeholder-CSI convention);
 *   - respects the COMPANION_WRITES_ENABLED gate — off = full preview, no write.
 *
 * multipart/form-data fields:
 *   file        the invoice (pdf or image), ≤15 MB
 *   jobId       required
 *   externalId  required idempotency key, generated once per file by the UI
 *               ("INV-xxxxxxxx") so a retry can't double-create
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

    // ---- 4. dates — billing period from the upload moment (arrival standard)
    const sunsetId = (process.env.JT_SUNSET_VENDOR_ID ?? "").trim();
    const isSunset =
      (sunsetId !== "" && vendor.id === sunsetId) || /sunset builders/i.test(vendor.name);
    const dates = computeBillDates(new Date(), isSunset, extracted.DueDate);
    warnings.push(...dates.warnings);

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
        name: `${vendor.name} ${externalId} — Review Required`,
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
          name: `${vendor.name} ${externalId} — ${n} items (not itemized)`,
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
      externalId,
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
      externalId,
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
      existing = await findBillByExternalId(cfg, vendor.id, externalId);
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
      const name = file.name && file.name.includes(".") ? file.name : `${externalId}.${ext}`;
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
    let syncKicked = false;
    const syncUrl = process.env.APPS_SCRIPT_SYNC_URL;
    const syncSecret = process.env.APPS_SCRIPT_SYNC_SECRET;
    if (syncUrl && syncSecret) {
      try {
        const kick = await fetch(syncUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: syncSecret }), // queued mode → returns ~1s
          redirect: "follow",
        });
        const kickJson = (await kick.json().catch(() => null)) as { ok?: boolean } | null;
        syncKicked = kickJson?.ok === true;
        if (!syncKicked) {
          warnings.push("Bill created, but the sheet/Drive sync kick didn't confirm — it'll sync on the next hourly run.");
        }
      } catch {
        warnings.push("Bill created, but the sheet/Drive sync kick failed — it'll sync on the next hourly run.");
      }
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
