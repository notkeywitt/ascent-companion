/**
 * Claude document extraction — the assistant's port of the Apps Script engine
 * (Ingestion.js callClaude + Config.js PROMPTS.appSheetExpenditure).
 *
 * Replaces src/lib/gemini.ts, deleted 2026-09-09 when the Gemini->Claude
 * migration finished. Two paths live here: bill extraction (`/api/add-bill`)
 * and tool-serial OCR (`/api/ocr-serial`).
 *
 * The bill prompt is TUNED against a corpus of real invoices; changes to its
 * rules should be mirrored to/from the Apps Script original. Two deliberate
 * deviations from the email-card variant:
 *   1. No Project rule — the job is ALWAYS human-picked in the UI, never AI
 *      (hard-learned rule from the email card).
 *   2. Vendors are JobTread accounts (id + name) rather than the Vendors sheet,
 *      so the returned "Vendor" is a JT account id.
 *
 * Server-side only (ANTHROPIC_API_KEY). Never import from client components.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface ExtractedItem {
  description?: string;
  price?: number;
  quantity?: number;
  line_total?: number;
  csi?: string;
}

export interface ExtractedBill {
  Vendor?: string; // JT account id, or "<name> NEW VENDOR" when unmatched
  InvoiceNumber?: string; // the vendor's printed invoice/bill number (Vendor Bill Number)
  Amount?: number; // invoice grand total (subtotal + tax)
  Tax?: number; // total sales tax
  DueDate?: string; // yyyy-MM-dd
  CSI?: string; // primary cost code for the whole invoice
  items?: ExtractedItem[];
}

/** Its own knob, same reasoning as digest/claude.ts and invoiceReview/narrate.ts:
 *  a dedicated env var so a future /chat model change can't silently re-price or
 *  re-behave document extraction, and vice versa. */
const MODEL = process.env.ANTHROPIC_MODEL_EXTRACT?.trim() || "claude-sonnet-5";

/**
 * ⚠️ THIS CEILING MUST LEAVE ROOM FOR THINKING, NOT JUST FOR THE ANSWER — the
 * same trap that took out the digest summary on 2026-08-31. Omitting `thinking`
 * runs ADAPTIVE thinking on the current family (it is on by default, not off),
 * and those tokens come out of `max_tokens` before any text block is emitted. A
 * ceiling sized for the JSON alone yields a response with NO text block and
 * `stop_reason: "max_tokens"`. A ceiling is not a spend — you are billed for
 * tokens generated. Do not "optimize" this down to the size of the output.
 */
const MAX_TOKENS = 16_000;

/** /api/ocr-serial declares maxDuration 30, so its own call must land inside that. */
const TIMEOUT_OCR_MS = 25_000;
/** Bill extraction reads a whole multi-page invoice and has no route ceiling. */
const TIMEOUT_BILL_MS = 60_000;

/**
 * Image media types Claude vision accepts. HEIC/HEIF are NOT among them — the
 * add-bill route converts a phone photo to JPEG in the browser before upload
 * for exactly this reason, and rejects anything that still arrives as HEIC with
 * an actionable message rather than letting the API 400.
 */
export const CLAUDE_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

let _client: Anthropic | null = null;
function client(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  return (_client ??= new Anthropic({ apiKey: key }));
}

/**
 * Low-level Claude call. `bytes`/`mimeType` are optional: omit them for a
 * text-only prompt. A PDF goes up as a `document` block and an image as an
 * `image` block — the block type must match the file, which is why this
 * branches on the mime rather than taking the caller's word for it.
 *
 * `schema` is passed as `output_config.format`, so the response is
 * schema-conformant JSON and needs none of the fence-stripping or brace-repair
 * the retired Gemini client had to do. Returns null on any failure the caller
 * should treat as "couldn't read it".
 */
async function callClaude(
  prompt: string,
  schema: Record<string, unknown>,
  timeoutMs: number,
  bytes?: Buffer | null,
  mimeType?: string,
): Promise<unknown | null> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (bytes && mimeType) {
    const data = bytes.toString("base64");
    if (mimeType === "application/pdf") {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      });
    } else if (CLAUDE_IMAGE_MIME.has(mimeType)) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data,
        },
      });
    } else {
      throw new Error(
        `Claude cannot read "${mimeType}". Upload a PDF, JPEG, PNG, or WebP.`,
      );
    }
  }
  content.push({ type: "text", text: prompt });

  let res: Anthropic.Message;
  try {
    res = await client().messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema } },
      },
      { timeout: timeoutMs },
    );
  } catch (e) {
    // A swallowed failure here is indistinguishable from "the document was
    // unreadable", which is what made a rate limit, an expired key and a
    // platform timeout all look like "Extraction failed — try again". Say what
    // actually went wrong: the caller decides whether to show it or fall back.
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[claudeExtract] ${MODEL} call failed: ${why}`);
    throw new Error(`The reader (${MODEL}) could not be reached: ${why}`);
  }
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
    console.error(`[claudeExtract] stop_reason=${res.stop_reason}`);
    throw new Error(
      res.stop_reason === "max_tokens"
        ? "The reader ran out of room before it answered — the document is too long."
        : "The reader declined to read this document.",
    );
  }

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return JSON.parse(text);
  } catch {
    console.error(`[claudeExtract] unparseable answer (${text.length} chars)`);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * TOOL SERIAL OCR
 * ------------------------------------------------------------------ */

const SERIAL_SCHEMA = {
  type: "object",
  properties: { serial: { type: "string" } },
  required: ["serial"],
  additionalProperties: false,
};

/**
 * Read a tool's serial number off a phone photo of its label/nameplate.
 * Returns "" when nothing is legible, null on failure. The user always reviews
 * and edits the value before saving, so this is best-effort.
 */
export async function ocrSerialWithClaude(
  bytes: Buffer,
  mimeType: string,
): Promise<string | null> {
  const prompt = `You are reading the SERIAL NUMBER off a photo of a power tool's label or nameplate.

RULES:
1. "serial" = the tool's serial number exactly as printed — the value labeled "Serial", "Serial No", "S/N", "SN", or "Ser". Preserve case, letters, digits, and hyphens verbatim; do not add spaces.
2. If several codes appear, PREFER the one explicitly labeled as a serial number. Ignore model numbers, type/part numbers, voltage/amperage, dates, and barcodes UNLESS no labeled serial exists, in which case return the most likely primary serial.
3. If no serial number is legible, output an empty string for "serial".`;

  // Best-effort by contract: the operator types the serial when this returns
  // nothing, so a reader outage must not fail the tool form. callClaude now
  // throws (and logs) instead of hiding the reason — swallow it only here.
  let out: unknown | null = null;
  try {
    out = await callClaude(prompt, SERIAL_SCHEMA, TIMEOUT_OCR_MS, bytes, mimeType);
  } catch {
    return null;
  }
  if (out && typeof out === "object" && !Array.isArray(out)) {
    const serial = (out as Record<string, unknown>).serial;
    if (typeof serial === "string") return serial.trim();
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * BILL EXTRACTION
 * ------------------------------------------------------------------ */

/**
 * Mirrors the shape the prompt asks for. `additionalProperties: false` DROPS any
 * key not declared here, so a field added to the prompt has to be added here
 * too. Nothing is `required`: a document that genuinely shows no due date or no
 * invoice number should come back without the field rather than with an invented
 * one, and every consumer already treats each field as optional.
 */
const BILL_SCHEMA = {
  type: "object",
  properties: {
    Vendor: { type: "string" },
    InvoiceNumber: { type: "string" },
    Amount: { type: "number" },
    Tax: { type: "number" },
    DueDate: { type: "string" },
    CSI: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          price: { type: "number" },
          quantity: { type: "number" },
          line_total: { type: "number" },
          csi: { type: "string" },
        },
        required: ["description", "price", "quantity", "line_total", "csi"],
        additionalProperties: false,
      },
    },
  },
  required: ["Vendor", "InvoiceNumber", "Amount", "Tax", "DueDate", "CSI", "items"],
  additionalProperties: false,
};

/** The extraction prompt (port of PROMPTS.appSheetExpenditure, minus Project). */
function buildPrompt(vendorList: string, validCSIs: string): string {
  const csiRule = validCSIs
    ? `MUST be EXACTLY one of: [${validCSIs}]. These are the ONLY codes available — they come from the project's active budget. If absolutely no logical match exists, use "".`
    : `The project has no budget codes loaded — always output "".`;

  return `You are a construction data parser. Extract the invoice below.

RULES:
1. 'Vendor': You MUST choose the closest matching Vendor name from this list: {${vendorList}} and return the Vendor ID. If no match is found, output the vendor found and append "NEW VENDOR".
2. 'CSI': The primary CSI for the whole invoice. ${csiRule}
3. 'items': Every billed line, INCLUDING shipping, freight, delivery, handling, and fuel-surcharge charges — each as its own line item with its printed amount. For each, 'csi' follows the same rule as 'CSI'. Do NOT create a line item for sales tax, or for Subtotal / Total / Balance Due summary rows.
4. 'Tax': The TOTAL sales tax charged on the invoice, as a positive number (the "Tax" / "Sales Tax" / "Total Tax" summary amount). Keep it OUT of 'items'. 'Amount' is the invoice GRAND TOTAL (subtotal + tax). If the invoice shows no tax, output 0.
5. AMOUNTS ARE READ, NEVER COMPUTED: extract every 'price', 'quantity', and 'line_total' EXACTLY as printed on the document. NEVER adjust, rescale, prorate, or recompute any line amount to make totals reconcile. If the printed line items do not sum to Amount minus Tax, report them as printed anyway — do NOT change them.
6. 'DueDate': The payment due date printed on the invoice in YYYY-MM-DD form, if any; else "".
7. 'InvoiceNumber': The vendor's own invoice or bill number exactly as printed — the value labeled "Invoice #", "Invoice No", "Bill #", "Statement #", "Document #", or "Order #". Preserve letters, digits, and hyphens verbatim; do not add spaces. Do NOT return a purchase-order number, account number, phone number, or date as the invoice number. If no such number is printed, output "".`;
}

/**
 * Extract a vendor bill from an uploaded document.
 * @param bytes     the file's bytes
 * @param mimeType  application/pdf or a Claude-readable image type
 * @param vendors   JT vendor accounts, injected as "id": "name" pairs
 * @param budgetCodes  the job's budget cost codes, e.g. [{number, name}]
 */
export async function extractBillWithClaude(
  bytes: Buffer,
  mimeType: string,
  vendors: { id: string; name: string }[],
  budgetCodes: { number: string; name: string }[],
): Promise<ExtractedBill | null> {
  const vendorList = vendors.map((v) => `"${v.id}": "${v.name}"`).join(", ");
  // Same shape as the Apps Script getValidCSIString(): code + service name hint.
  const csiList = budgetCodes.map((c) => `"${c.number}" (Matches: ${c.name})`).join(", ");
  const out = await callClaude(
    buildPrompt(vendorList, csiList),
    BILL_SCHEMA,
    TIMEOUT_BILL_MS,
    bytes,
    mimeType,
  );
  return out && typeof out === "object" && !Array.isArray(out) ? (out as ExtractedBill) : null;
}
