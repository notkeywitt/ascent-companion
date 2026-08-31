/**
 * Claude engine for the Daily Digest — the summary paragraph and the
 * email-signals extraction. Replaces the Gemini versions in src/lib/gemini.ts
 * (`summarizeDigestWithGemini`, `extractEmailSignalsWithGemini`), which stay in
 * place for the pipelines that still use Gemini (invoice capture, tool-serial
 * OCR) — this file is the digest's own, so a future Gemini removal there
 * doesn't touch this one.
 *
 * Server-only; the API key stays here (same convention as gemini.ts,
 * src/lib/anthropic.ts, src/lib/invoiceReview/narrate.ts — each of those keeps
 * its own client and its own model env var, deliberately not shared).
 */
import Anthropic from "@anthropic-ai/sdk";

/** Sonnet by default: same reasoning as narrate.ts's ANTHROPIC_MODEL_REVIEW —
 *  a dedicated knob so a future /chat model change can't silently re-price or
 *  re-behave the digest, and vice versa. */
const MODEL = process.env.ANTHROPIC_MODEL_DIGEST?.trim() || "claude-sonnet-5";
const MAX_TOKENS_SUMMARY = 600;
const MAX_TOKENS_EXTRACTION = 4096;
/** The digest route has its own budget; don't let one slow call eat it. */
const TIMEOUT_MS = 30_000;

let _client: Anthropic | null = null;
function client(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  return (_client ??= new Anthropic({ apiKey: key }));
}

/**
 * The Daily Digest's one-paragraph summary. ONE Claude call per digest run.
 *
 * ⚠️ `structured` MUST already be the digest's check RESULTS — titles, counts,
 * amounts and one-line summaries — never raw source data. No email bodies, no
 * document text, no customer contact details are sent here. That is a privacy
 * rule first (this leaves our infrastructure) and a cost/latency one second:
 * the digest is small, so the call is fast and cheap, and the model has nothing
 * to do but prioritize what the checks already decided.
 *
 * Returns null when Claude is unconfigured or unreachable — the caller composes
 * a local fallback paragraph rather than showing an empty digest.
 */
export async function summarizeDigestWithClaude(structured: unknown): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;

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
    const res = await client().messages.create(
      { model: MODEL, max_tokens: MAX_TOKENS_SUMMARY, messages: [{ role: "user", content: prompt }] },
      { timeout: TIMEOUT_MS },
    );
    if (res.stop_reason === "refusal") return null;
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------
 * EMAIL SIGNAL EXTRACTION — appointments and action items mentioned in mail.
 *
 * ⚠️ THIS IS THE ONE PLACE IN THE DIGEST THAT SENDS EMAIL BODY TEXT TO CLAUDE.
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

const EMAIL_SIGNAL_SCHEMA = {
  type: "object",
  properties: {
    appointments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          emailIndex: { type: "integer" },
          title: { type: "string" },
          date: { type: "string" },
          time: { type: "string" },
        },
        required: ["emailIndex", "title"],
        additionalProperties: false,
      },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          emailIndex: { type: "integer" },
          title: { type: "string" },
          dueHint: { type: "string" },
          owner: { type: "string", enum: ["us", "them"] },
        },
        required: ["emailIndex", "title", "owner"],
        additionalProperties: false,
      },
    },
  },
  required: ["appointments", "actionItems"],
  additionalProperties: false,
};

/**
 * One Claude pass over a batch of recent inbox emails, returning appointments
 * and action items it can support directly from the text. Batched (all emails
 * in one call, indexed) rather than one call per email — same reasoning as
 * `summarizeDigestWithClaude`: fast, cheap, and it's the only way to keep this
 * to ONE extra Claude call per digest run.
 *
 * Returns `{appointments:[],actionItems:[]}` for an empty input, and `null`
 * when Claude is unconfigured or the response can't be trusted (refused,
 * truncated, or missing the expected arrays) — the caller treats `null` as
 * "couldn't run".
 */
export async function extractEmailSignalsWithClaude(
  emails: { subject: string; from: string; date: string; body: string }[],
): Promise<EmailSignalExtraction | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
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

RULES:
1. Use ONLY what is explicitly stated in the email. Never invent a date, time, or request.
2. "date" is YYYY-MM-DD ONLY when the day is stated outright or is unambiguous relative to that
   email's own Date line (e.g. "next Tuesday"). If unsure, omit "date" and put what was said in
   "time" or the title instead.
3. "owner" on an action item: "us" if the email is asking the company to do something; "them" if
   the company (or the email) said IT will do something for the other party.
4. Skip anything vague, already resolved ("thanks, all set"), or clearly automated/marketing.
5. At most 3 items per email.
6. Return empty arrays if nothing qualifies.

EMAILS:
${listing}`;

  let res: Anthropic.Message;
  try {
    res = await client().messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS_EXTRACTION,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: { type: "json_schema", schema: EMAIL_SIGNAL_SCHEMA } },
      },
      { timeout: TIMEOUT_MS },
    );
  } catch {
    return null;
  }
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let out: unknown;
  try {
    out = JSON.parse(text);
  } catch {
    return null;
  }
  if (!out || typeof out !== "object" || Array.isArray(out)) return null;

  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

  const record = out as Record<string, unknown>;
  const appointments = (Array.isArray(record.appointments) ? record.appointments : [])
    .filter((a: any) => isNum(a?.emailIndex) && isStr(a?.title))
    .map((a: any) => ({
      emailIndex: a.emailIndex,
      title: String(a.title),
      date: isStr(a.date) ? String(a.date) : undefined,
      time: isStr(a.time) ? String(a.time) : undefined,
    }));
  const actionItems = (Array.isArray(record.actionItems) ? record.actionItems : [])
    .filter((a: any) => isNum(a?.emailIndex) && isStr(a?.title))
    .map((a: any) => ({
      emailIndex: a.emailIndex,
      title: String(a.title),
      dueHint: isStr(a.dueHint) ? String(a.dueHint) : undefined,
      owner: a.owner === "them" ? ("them" as const) : ("us" as const),
    }));

  return { appointments, actionItems };
}
