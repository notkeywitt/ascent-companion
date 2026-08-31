/**
 * Gemini invoice extraction — the assistant's port of the Apps Script engine
 * (Ingestion.js callGemini + Config.js PROMPTS.appSheetExpenditure).
 *
 * The prompt below is TUNED against a corpus of real invoices; changes to its
 * rules should be mirrored to/from the Apps Script original. Two deliberate
 * deviations from the email-card variant:
 *   1. No Project rule — the job is ALWAYS human-picked in the UI, never AI
 *      (hard-learned rule from the email card).
 *   2. Vendors are JobTread accounts (id + name) rather than the Vendors sheet,
 *      so the returned "Vendor" is a JT account id.
 *
 * Server-side only (GEMINI_KEY). Never import from client components.
 */

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

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash"; // matches Apps Script CONFIG
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The extraction prompt (port of PROMPTS.appSheetExpenditure, minus Project). */
function buildPrompt(vendorList: string, validCSIs: string): string {
  const csiRule = validCSIs
    ? `MUST be EXACTLY one of: [${validCSIs}]. These are the ONLY codes available — they come from the project's active budget. If absolutely no logical match exists, use "".`
    : `The project has no budget codes loaded — always output "".`;

  return `You are a construction data parser. Extract JSON:
{
  "Vendor": string, "InvoiceNumber": string, "Amount": number, "Tax": number, "DueDate": "YYYY-MM-DD",
  "CSI": string,
  "items": [{"description": string, "price": number, "quantity": number, "line_total": number, "csi": string}]
}

RULES:
1. 'Vendor': You MUST choose the closest matching Vendor name from this list: {${vendorList}} and return the Vendor ID. If no match is found, output the vendor found and append "NEW VENDOR".
2. 'CSI': The primary CSI for the whole invoice. ${csiRule}
3. 'items': Every billed line, INCLUDING shipping, freight, delivery, handling, and fuel-surcharge charges — each as its own line item with its printed amount. For each, 'csi' follows the same rule as 'CSI'. Do NOT create a line item for sales tax, or for Subtotal / Total / Balance Due summary rows.
4. 'Tax': The TOTAL sales tax charged on the invoice, as a positive number (the "Tax" / "Sales Tax" / "Total Tax" summary amount). Keep it OUT of 'items'. 'Amount' is the invoice GRAND TOTAL (subtotal + tax). If the invoice shows no tax, output 0.
5. AMOUNTS ARE READ, NEVER COMPUTED: extract every 'price', 'quantity', and 'line_total' EXACTLY as printed on the document. NEVER adjust, rescale, prorate, or recompute any line amount to make totals reconcile. If the printed line items do not sum to Amount minus Tax, report them as printed anyway — do NOT change them.
6. 'DueDate': The payment due date printed on the invoice, if any; else "".
7. 'InvoiceNumber': The vendor's own invoice or bill number exactly as printed — the value labeled "Invoice #", "Invoice No", "Bill #", "Statement #", "Document #", or "Order #". Preserve letters, digits, and hyphens verbatim; do not add spaces. Do NOT return a purchase-order number, account number, phone number, or date as the invoice number. If no such number is printed, output "".
8. Return ONLY JSON.`;
}

/**
 * Low-level Gemini call (port of callGemini): REST generateContent with the file
 * inlined, retry on 429/502/503, then the same two JSON repair passes the Apps
 * Script engine needed against real Gemini output. Returns null on failure.
 *
 * `bytes`/`mimeType` are optional: omit them for a TEXT-ONLY prompt (the Daily
 * Digest's summary, which is handed structured JSON and no document). The
 * retry, fence-stripping and JSON-repair behavior is identical either way —
 * which is the reason this is one function rather than two that drift.
 */
async function callGemini(
  prompt: string,
  bytes?: Buffer | null,
  mimeType?: string,
): Promise<any | null> {
  const key = process.env.GEMINI_KEY;
  if (!key) throw new Error("GEMINI_KEY is not set.");

  const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const parts: Record<string, unknown>[] = [{ text: prompt }];
  if (bytes && mimeType) {
    parts.push({ inline_data: { mime_type: mimeType, data: bytes.toString("base64") } });
  }
  const payload = JSON.stringify({ contents: [{ parts }] });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
    } catch (e) {
      if (attempt >= MAX_RETRIES) return null;
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }

    if (res.status === 429 || res.status === 502 || res.status === 503) {
      if (attempt >= MAX_RETRIES) return null;
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = await res.json();
    let text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Strip markdown code fences if Gemini ignored "no markdown"
    text = text.replace(/```json|```/g, "").trim();

    const isArray = text.startsWith("[");
    const match = text.match(isArray ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
    if (!match) return null;

    let jsonStr = match[0];
    // Repair pass 1: strip embedded control characters that crash JSON.parse
    jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    // Repair pass 2: insert missing } between adjacent objects in arrays
    jsonStr = jsonStr.replace(/("[^"]*"|[\d.]+|true|false|null)(\s*),(\s*)\{/g, "$1$2}$2,$3{");

    try {
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Read a tool's serial number off a phone photo of its label/nameplate.
 * Reuses callGemini (retries + JSON repair); the prompt returns {"serial": ...}
 * so we get a clean string back. Returns "" when nothing legible, null on failure.
 */
export async function ocrSerialWithGemini(bytes: Buffer, mimeType: string): Promise<string | null> {
  const prompt = `You are reading the SERIAL NUMBER off a photo of a power tool's label or nameplate.
Return ONLY JSON: {"serial": string}

RULES:
1. "serial" = the tool's serial number exactly as printed — the value labeled "Serial", "Serial No", "S/N", "SN", or "Ser". Preserve case, letters, digits, and hyphens verbatim; do not add spaces.
2. If several codes appear, PREFER the one explicitly labeled as a serial number. Ignore model numbers, type/part numbers, voltage/amperage, dates, and barcodes UNLESS no labeled serial exists, in which case return the most likely primary serial.
3. If no serial number is legible, output {"serial": ""}.
4. Return ONLY JSON, no markdown.`;
  const out = await callGemini(prompt, bytes, mimeType);
  if (out && typeof out === "object" && !Array.isArray(out) && typeof out.serial === "string") {
    return out.serial.trim();
  }
  return null;
}

/**
 * Extract a vendor bill from an uploaded document.
 * @param bytes     the file's bytes
 * @param mimeType  application/pdf or an image type
 * @param vendors   JT vendor accounts, injected as "id": "name" pairs
 * @param budgetCodes  the job's budget cost codes, e.g. [{number, name}]
 */
export async function extractBillWithGemini(
  bytes: Buffer,
  mimeType: string,
  vendors: { id: string; name: string }[],
  budgetCodes: { number: string; name: string }[],
): Promise<ExtractedBill | null> {
  const vendorList = vendors.map((v) => `"${v.id}": "${v.name}"`).join(", ");
  // Same shape as the Apps Script getValidCSIString(): code + service name hint.
  const csiList = budgetCodes.map((c) => `"${c.number}" (Matches: ${c.name})`).join(", ");
  const out = await callGemini(buildPrompt(vendorList, csiList), bytes, mimeType);
  return out && typeof out === "object" && !Array.isArray(out) ? (out as ExtractedBill) : null;
}

/**
 * A TEXT-ONLY Gemini call that returns prose, not JSON.
 *
 * Separate from `callGemini` because that one's whole job is to find and repair
 * a JSON object in the answer — which is exactly wrong for a paragraph. Same
 * endpoint, same key, same retry ladder on 429/502/503. Returns null on any
 * failure so a caller can fall back instead of losing its result.
 */
async function callGeminiText(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_KEY;
  if (!key) throw new Error("GEMINI_KEY is not set.");

  const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const payload = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
    } catch {
      if (attempt >= MAX_RETRIES) return null;
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }
    if (res.status === 429 || res.status === 502 || res.status === 503) {
      if (attempt >= MAX_RETRIES) return null;
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }
    if (!res.ok) return null;

    const json = await res.json();
    const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const cleaned = text.replace(/```[a-z]*|```/g, "").trim();
    return cleaned || null;
  }
  return null;
}

/**
 * The Daily Digest's one-paragraph summary. ONE Gemini call per digest run.
 *
 * ⚠️ `structured` MUST already be the digest's check RESULTS — titles, counts,
 * amounts and one-line summaries — never raw source data. No email bodies, no
 * document text, no customer contact details are sent here. That is a privacy
 * rule first (this leaves our infrastructure) and a cost/latency one second:
 * the digest is small, so the call is fast and cheap, and the model has nothing
 * to do but prioritize what the checks already decided.
 *
 * Returns null when Gemini is unconfigured or unreachable — the caller composes
 * a local fallback paragraph rather than showing an empty digest.
 */
export async function summarizeDigestWithGemini(structured: unknown): Promise<string | null> {
  if (!process.env.GEMINI_KEY) return null;
  const prompt = `You are writing the opening paragraph of a construction company's internal
morning digest, for the owner. Below is the STRUCTURED OUTPUT of this morning's automated checks.

Write ONE short paragraph (2-4 sentences, no more than about 70 words) that:
- leads with whatever is most urgent — money at risk, an overdue client or vendor follow-up, a bill that missed its billing month;
- names concrete numbers and dollar figures from the data;
- says plainly if everything is clear;
- mentions any check whose status is "error" as "couldn't be checked", briefly.

Do NOT use markdown, bullet points, headings, or a greeting. Do not invent anything
that is not in the data. Plain sentences only.

DATA:
${JSON.stringify(structured)}`;
  try {
    return await callGeminiText(prompt);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------
 * EMAIL SIGNAL EXTRACTION — appointments and action items mentioned in mail.
 *
 * ⚠️ THIS IS THE ONE PLACE IN THE DIGEST THAT SENDS EMAIL BODY TEXT TO GEMINI.
 * Every other check reads metadata only. This one has to read some body text —
 * "let's meet Thursday at 2" cannot be found by a sender/subject rule — so the
 * body sent here is TRUNCATED (the caller sets how much, see
 * `EmailSignalsConfig.maxBodyChars` in src/lib/digest/settings.ts) and reply
 * chains are already stripped before it reaches this file (Apps Script side,
 * `_jtdStripQuoted`). The ONLY thing that leaves this function and reaches the
 * stored digest is the EXTRACTED result — a title, a date/time hint, a
 * yes/no on whose action it is — never the body text itself.
 * ---------------------------------------------------------------------- */

export interface ExtractedAppointment {
  emailIndex: number;
  title: string;
  date?: string; // YYYY-MM-DD, only when explicitly stated or unambiguous
  time?: string; // free text as printed ("2pm", "9:00 AM") — not parsed
}
export interface ExtractedActionItem {
  emailIndex: number;
  title: string;
  dueHint?: string; // free text ("by Friday", "this week") — not parsed to a date
  owner: "us" | "them"; // "us" = someone is asking us; "them" = we owe them
}
export interface EmailSignalExtraction {
  appointments: ExtractedAppointment[];
  actionItems: ExtractedActionItem[];
}

/**
 * One Gemini pass over a batch of recent inbox emails, returning appointments
 * and action items it can support directly from the text. Batched (all emails
 * in one call, indexed) rather than one call per email — same reasoning as
 * `summarizeDigestWithGemini`: fast, cheap, and it's the only way to keep this
 * to ONE extra Gemini call per digest run.
 *
 * Returns `{appointments:[],actionItems:[]}` for an empty input, and `null`
 * when Gemini is unconfigured or the response can't be trusted (not an object,
 * or missing the expected arrays) — the caller treats `null` as "couldn't run".
 */
export async function extractEmailSignalsWithGemini(
  emails: { subject: string; from: string; date: string; body: string }[],
): Promise<EmailSignalExtraction | null> {
  if (!process.env.GEMINI_KEY) return null;
  if (emails.length === 0) return { appointments: [], actionItems: [] };

  const listing = emails
    .map(
      (e, i) =>
        `[${i}] From: ${e.from}\nDate: ${e.date.slice(0, 10)}\nSubject: ${e.subject}\nBody:\n${e.body}`,
    )
    .join("\n\n---\n\n");

  const prompt = `You are scanning a small construction company's recent inbox email for two things:
APPOINTMENTS (a specific date/time someone should be somewhere or on a call) and ACTION ITEMS
(a request made of the company, or something the company promised to do or send).

Below are ${emails.length} recent email(s), each numbered [emailIndex] — use that exact number.

Return ONLY JSON in this exact shape:
{
  "appointments": [{"emailIndex": number, "title": string, "date": "YYYY-MM-DD" or omit, "time": string or omit}],
  "actionItems": [{"emailIndex": number, "title": string, "dueHint": string or omit, "owner": "us" or "them"}]
}

RULES:
1. Use ONLY what is explicitly stated in the email. Never invent a date, time, or request.
2. "date" is YYYY-MM-DD ONLY when the day is stated outright or is unambiguous relative to that
   email's own Date line (e.g. "next Tuesday"). If unsure, omit "date" and put what was said in
   "time" or the title instead.
3. "owner" on an action item: "us" if the email is asking the company to do something; "them" if
   the company (or the email) said IT will do something for the other party.
4. Skip anything vague, already resolved ("thanks, all set"), or clearly automated/marketing.
5. At most 3 items per email.
6. Return {"appointments":[],"actionItems":[]} if nothing qualifies. No markdown, no commentary.

EMAILS:
${listing}`;

  const out = await callGemini(prompt);
  if (!out || typeof out !== "object" || Array.isArray(out)) return null;

  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

  const appointments = (Array.isArray(out.appointments) ? out.appointments : [])
    .filter((a: any) => isNum(a?.emailIndex) && isStr(a?.title))
    .map((a: any) => ({
      emailIndex: a.emailIndex,
      title: String(a.title),
      date: isStr(a.date) ? String(a.date) : undefined,
      time: isStr(a.time) ? String(a.time) : undefined,
    }));
  const actionItems = (Array.isArray(out.actionItems) ? out.actionItems : [])
    .filter((a: any) => isNum(a?.emailIndex) && isStr(a?.title))
    .map((a: any) => ({
      emailIndex: a.emailIndex,
      title: String(a.title),
      dueHint: isStr(a.dueHint) ? String(a.dueHint) : undefined,
      owner: a.owner === "them" ? ("them" as const) : ("us" as const),
    }));

  return { appointments, actionItems };
}
