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
const MAX_TOKENS_SUMMARY = 900;
const MAX_TOKENS_EXTRACTION = 4096;
const MAX_TOKENS_REPLY = 2048;
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

  const prompt = `You are the owner's executive assistant at a small construction company, writing
their morning brief. Below is the STRUCTURED OUTPUT of this morning's automated checks — crew time
entries, the JobTread and calendar schedule, open to-dos and office reminders, and email needing a
reply.

Write a short brief (4-7 plain sentences, no more than about 160 words) in this order:
1. Recap what the crew did YESTERDAY, by job — who was where, doing what (from the "Crew Activity"
   check's "Yesterday" items). Skip this sentence if there's nothing to recap.
2. State who's on site TODAY and where (the same check's "Right now" items), as the day's plan.
3. Call out emails that need a reply, by name and in brief, and anything on the calendar or
   JobTread schedule worth flagging today.
4. Close with any open reminders/to-dos the owner should keep in mind, named specifically (not just
   a count).

Write it as complete sentences a person would actually say out loud, not a bullet list read back.
Name people and jobs directly (e.g. "Cedar, Rachel, and Greg were at Ferron installing siding").
Name concrete numbers and dollar figures when the data has them. If a whole section has nothing to
report, skip it silently rather than saying "nothing to report" — don't pad. Mention any check whose
status is "error" as "couldn't be checked", briefly, near the end.

Do NOT use markdown, bullet points, headings, or a greeting. Do not invent anything that is not in
the data — every name, job, and number must come from what's given.

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

/* -------------------------------------------------------------------------
 * DIGEST REPLY PARSING — turning a free-text reply to the digest ("remind me
 * about the L&I thing tomorrow, ignore emails from so-and-so") into structured
 * actions against the office's own todo/ignore-rule tables.
 *
 * References to an EXISTING todo or ignore rule are by id, not fuzzy text
 * matching — the caller passes today's open todos and active ignore rules as
 * `context` so Claude can pick the right id directly, and the caller (the
 * reply route) re-validates every id against that same context before writing
 * anything, so a hallucinated id can never touch the database.
 * ---------------------------------------------------------------------- */

export type DigestReplyActionType =
  | "add_todo"
  | "complete_todo"
  | "snooze_todo"
  | "add_ignore_rule"
  | "remove_ignore_rule";

export interface DigestReplyAction {
  type: DigestReplyActionType;
  text?: string; // add_todo
  todoId?: number; // complete_todo, snooze_todo
  snoozeUntil?: string; // add_todo (optional), snooze_todo (required) — YYYY-MM-DD
  pattern?: string; // add_ignore_rule
  reason?: string; // add_ignore_rule (optional)
  ruleId?: number; // remove_ignore_rule
}

export interface DigestReplyContext {
  today: string; // YYYY-MM-DD, for resolving "tomorrow"/"next week" etc.
  openTodos: { id: number; text: string }[];
  activeIgnoreRules: { id: number; pattern: string }[];
}

const DIGEST_REPLY_SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["add_todo", "complete_todo", "snooze_todo", "add_ignore_rule", "remove_ignore_rule"],
          },
          text: { type: "string" },
          todoId: { type: "integer" },
          snoozeUntil: { type: "string" },
          pattern: { type: "string" },
          reason: { type: "string" },
          ruleId: { type: "integer" },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
  },
  required: ["actions"],
  additionalProperties: false,
};

/**
 * One Claude pass over a digest reply, returning the actions it implies. Never
 * throws — returns `null` when Claude is unconfigured, refuses, or the response
 * can't be trusted, and `{actions:[]}` for a reply that implies nothing
 * actionable (the caller should still store the raw text either way).
 */
export async function parseDigestReplyWithClaude(
  text: string,
  context: DigestReplyContext,
): Promise<{ actions: DigestReplyAction[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  if (!text.trim()) return { actions: [] };

  const prompt = `You are turning a construction company owner's short reply to their morning digest
into structured actions. Today's date is ${context.today}.

Today's OPEN REMINDERS (reference by "todoId" to act on one; never invent an id):
${context.openTodos.length ? context.openTodos.map((t) => `[${t.id}] ${t.text}`).join("\n") : "(none)"}

ACTIVE EMAIL IGNORE RULES (reference by "ruleId" to remove one; never invent an id):
${context.activeIgnoreRules.length ? context.activeIgnoreRules.map((r) => `[${r.id}] ${r.pattern}`).join("\n") : "(none)"}

THE REPLY:
"""
${text}
"""

Turn it into zero or more actions:
- "add_todo": a new reminder — a fresh instruction, note, or thing to follow up on that isn't already
  one of the open reminders above. "snoozeUntil" (YYYY-MM-DD) only if a specific date/relative day was
  stated ("remind me tomorrow" -> tomorrow's date computed from today's date above); omit otherwise.
- "complete_todo": the reply says a specific open reminder above is done/handled/no longer needed —
  give its exact "todoId".
- "snooze_todo": the reply asks to be reminded about a specific open reminder above at a later date —
  give its exact "todoId" and the computed "snoozeUntil" (YYYY-MM-DD).
- "add_ignore_rule": the reply asks to stop being told about email from a specific person/company —
  "pattern" is the shortest distinguishing substring of their name or domain (e.g. "Acme Plumbing" or
  "acmeplumbing.com"), lowercase. Add a short "reason" only if the reply gave one.
- "remove_ignore_rule": the reply asks to start flagging a sender again that's on the ignore list
  above — give its exact "ruleId".

RULES: Only act on what the reply explicitly says — never invent a reminder, a date, or a sender that
isn't named. If the reply doesn't map to any of today's open reminders or ignore rules, treat it as a
NEW "add_todo" instead of guessing at an id. If nothing in the reply is actionable, return an empty
array.`;

  let res: Anthropic.Message;
  try {
    res = await client().messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS_REPLY,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: { type: "json_schema", schema: DIGEST_REPLY_SCHEMA } },
      },
      { timeout: TIMEOUT_MS },
    );
  } catch {
    return null;
  }
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;

  const raw = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let out: unknown;
  try {
    out = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!out || typeof out !== "object" || Array.isArray(out)) return null;

  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  const VALID_TYPES: DigestReplyActionType[] = [
    "add_todo",
    "complete_todo",
    "snooze_todo",
    "add_ignore_rule",
    "remove_ignore_rule",
  ];

  const record = out as Record<string, unknown>;
  const actions = (Array.isArray(record.actions) ? record.actions : [])
    .filter((a: any) => VALID_TYPES.includes(a?.type))
    .map(
      (a: any): DigestReplyAction => ({
        type: a.type,
        text: isStr(a.text) ? String(a.text) : undefined,
        todoId: isNum(a.todoId) ? a.todoId : undefined,
        snoozeUntil: isStr(a.snoozeUntil) ? String(a.snoozeUntil) : undefined,
        pattern: isStr(a.pattern) ? String(a.pattern).toLowerCase() : undefined,
        reason: isStr(a.reason) ? String(a.reason) : undefined,
        ruleId: isNum(a.ruleId) ? a.ruleId : undefined,
      }),
    )
    // Drop anything missing the field its type actually needs — a schema-valid
    // but semantically incomplete action (the caller re-checks ids against
    // `context` on top of this).
    .filter((a) => {
      if (a.type === "add_todo") return isStr(a.text);
      if (a.type === "complete_todo") return isNum(a.todoId);
      if (a.type === "snooze_todo") return isNum(a.todoId) && isStr(a.snoozeUntil);
      if (a.type === "add_ignore_rule") return isStr(a.pattern);
      if (a.type === "remove_ignore_rule") return isNum(a.ruleId);
      return false;
    });

  return { actions };
}
