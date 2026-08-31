// READ-ONLY comparison: Gemini vs Claude on the Daily Digest's two LLM calls
// (summary paragraph + email-signals extraction), before cutting the digest
// over from src/lib/gemini.ts to src/lib/digest/claude.ts. Uses representative
// synthetic inputs (not live Gmail/DB data) — this is a low-stakes,
// informational feature, so an eyeball comparison is proportionate; nothing
// here is a repeatable regression test. Run: node scripts/probe-digest-claude.mjs
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const GEMINI_KEY = env.GEMINI_KEY;
const GEMINI_MODEL = env.GEMINI_MODEL || "gemini-2.5-flash";
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = env.ANTHROPIC_MODEL_DIGEST || "claude-sonnet-5";

if (!GEMINI_KEY) console.warn("⚠️  GEMINI_KEY not set in .env.local — Gemini calls will be skipped.");
if (!ANTHROPIC_KEY) console.warn("⚠️  ANTHROPIC_API_KEY not set in .env.local — Claude calls will be skipped.");

const anthropic = ANTHROPIC_KEY ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;

// ---- Gemini (raw fetch, same shape as src/lib/gemini.ts) -------------------

async function callGeminiText(prompt) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) return `<HTTP ${res.status}>`;
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text.replace(/```[a-z]*|```/g, "").trim() || null;
}

async function callGeminiJson(prompt) {
  const text = await callGeminiText(prompt);
  if (!text) return text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return `<no JSON found: ${text.slice(0, 200)}>`;
  try {
    return JSON.parse(match[0]);
  } catch {
    return `<unparseable JSON: ${match[0].slice(0, 200)}>`;
  }
}

// ---- Claude (real SDK, mirrors src/lib/digest/claude.ts) -------------------

async function callClaudeText(prompt) {
  if (!anthropic) return null;
  const res = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") return "<refused>";
  return res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim() || null;
}

async function callClaudeJson(prompt, schema) {
  if (!anthropic) return null;
  const res = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema } },
  });
  if (res.stop_reason === "refusal") return "<refused>";
  if (res.stop_reason === "max_tokens") return "<truncated>";
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    return `<unparseable JSON: ${text.slice(0, 200)}>`;
  }
}

// ---- Scenario 1: digest summary paragraph ----------------------------------

const SUMMARY_SCENARIOS = [
  [
    { check: "Uncaptured Bills", category: "money", status: "warning", summary: "2 uncaptured bills found.", itemCount: 2, topItems: [{ title: "Sunset Builders Supply — Miller Job", amount: 842.17 }, { title: "A1 Septic — Otis Perkins", amount: 250 }] },
    { check: "Reconciliation Flags", category: "money", status: "ok", summary: "No flags.", itemCount: 0, topItems: [] },
    { check: "JobTread To-Dos", category: "todo", status: "error", summary: "Couldn't run this check: JT_GRANT_KEY is not set.", itemCount: 0, topItems: [] },
  ],
  [
    { check: "Waiting on a Reply", category: "todo", status: "warning", summary: "1 thread waiting 4 business days.", itemCount: 1, topItems: [{ title: "Re: change order pricing", date: "2026-08-27" }] },
    { check: "Calendar Events", category: "schedule", status: "ok", summary: "3 events today, nothing conflicting.", itemCount: 3, topItems: [] },
  ],
];

// ---- Scenario 2: email-signals extraction ----------------------------------

const EMAIL_SCHEMA = {
  type: "object",
  properties: {
    appointments: {
      type: "array",
      items: {
        type: "object",
        properties: { emailIndex: { type: "integer" }, title: { type: "string" }, date: { type: "string" }, time: { type: "string" } },
        required: ["emailIndex", "title"],
        additionalProperties: false,
      },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: { emailIndex: { type: "integer" }, title: { type: "string" }, dueHint: { type: "string" }, owner: { type: "string", enum: ["us", "them"] } },
        required: ["emailIndex", "title", "owner"],
        additionalProperties: false,
      },
    },
  },
  required: ["appointments", "actionItems"],
  additionalProperties: false,
};

const EMAILS = [
  { subject: "Site visit this week?", from: "Dana Miller <dana@example.com>", date: "2026-08-28", body: "Can someone come by Thursday at 2pm to look at the deck framing before we close it in?" },
  { subject: "Re: Updated quote", from: "Otis Perkins <otis@example.com>", date: "2026-08-29", body: "Sounds good — please send the revised quote by end of week." },
  { subject: "Thanks!", from: "Vendor Newsletter <no-reply@vendor.com>", date: "2026-08-29", body: "Thanks for being a loyal customer. Check out our new fall catalog!" },
];

function emailListing(emails) {
  return emails.map((e, i) => `[${i}] From: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\nBody:\n${e.body}`).join("\n\n---\n\n");
}

function summaryPrompt(structured) {
  return `You are writing the opening paragraph of a construction company's internal
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
}

function extractionPromptFor(includeSchemaBlock) {
  const schemaBlock = includeSchemaBlock
    ? `Return ONLY JSON in this exact shape:
{
  "appointments": [{"emailIndex": number, "title": string, "date": "YYYY-MM-DD" or omit, "time": string or omit}],
  "actionItems": [{"emailIndex": number, "title": string, "dueHint": string or omit, "owner": "us" or "them"}]
}

`
    : "";
  return `You are scanning a small construction company's recent inbox email for two things:
APPOINTMENTS (a specific date/time someone should be somewhere or on a call) and ACTION ITEMS
(a request made of the company, or something the company promised to do or send).

Below are ${EMAILS.length} recent email(s), each numbered [emailIndex] — use that exact number.

${schemaBlock}RULES:
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
${emailListing(EMAILS)}`;
}

console.log("=== Digest summary paragraph: Gemini vs Claude ===\n");
for (const [i, structured] of SUMMARY_SCENARIOS.entries()) {
  const prompt = summaryPrompt(structured);
  const [gemini, claude] = await Promise.all([callGeminiText(prompt), callClaudeText(prompt)]);
  console.log(`--- Scenario ${i + 1} ---`);
  console.log(`Gemini: ${gemini}`);
  console.log(`Claude: ${claude}`);
  console.log();
}

console.log("=== Email-signals extraction: Gemini vs Claude ===\n");
const geminiExtraction = await callGeminiJson(extractionPromptFor(true));
const claudeExtraction = await callClaudeJson(extractionPromptFor(false), EMAIL_SCHEMA);
console.log("Gemini:", JSON.stringify(geminiExtraction, null, 2));
console.log("Claude:", JSON.stringify(claudeExtraction, null, 2));

console.log("\n=== done — eyeball both sides before flipping run.ts / emailSignals.ts ===");
