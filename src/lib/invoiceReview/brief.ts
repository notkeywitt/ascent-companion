/**
 * The paste-into-Claude briefing.
 *
 * ## Why this exists
 *
 * `narrate.ts` asks Claude to read the month's findings and say what to open
 * first. That needs an `ANTHROPIC_API_KEY`, which costs money and is a Vercel
 * setting. Without one the review still works completely — every check is
 * deterministic and needs no model at all — you just lose the paragraph.
 *
 * This module is the other way to get that paragraph, and more: it renders the
 * whole review as a self-contained markdown briefing that can be pasted into
 * Claude anywhere the office already has it (claude.ai, the desktop app, the
 * phone app). No key, no billing, no configuration — the clipboard is the API.
 *
 * It is deliberately NOT a JSON dump. Claude reads this better as prose with
 * numbers in it, the office can read it themselves to check nothing is missing,
 * and it fits in a chat box.
 *
 * ## The rule the preamble enforces
 *
 * The briefing opens by telling Claude that the arithmetic is already done and
 * must not be redone. Every figure below it was computed by `checks.ts` against
 * JobTread and Drive; a model asked to "check the math" on a summary will
 * happily invent a subtotal that contradicts the source. So the instruction is
 * to triage and advise, never to recompute.
 *
 * Pure — no fetch, no DB, no clock beyond what the payload carries — so both the
 * route and the browser can build the same text.
 */
import { money, type Finding, type ReviewPayload } from "./types";

/** Findings are grouped under these headings, in this order. */
const SECTIONS: { severity: Finding["severity"]; heading: string }[] = [
  { severity: "error", heading: "Needs fixing" },
  { severity: "warning", heading: "Worth a look" },
  { severity: "info", heading: "Context" },
];

const PREAMBLE = [
  "You are helping me review a month of client invoices for Ascent Building Co.,",
  "a construction contractor, before they go out to customers.",
  "",
  "**The arithmetic below is already done.** Every figure comes from automated",
  "checks run against JobTread (the source of truth for all billing) and the",
  "Google Drive folder where we file supplier invoices as backup. Do not redo the",
  "math and do not compute new totals — if you want to cite a number, copy one",
  "from below.",
  "",
  "What I want from you:",
  "1. Which of these should I open first, and why?",
  "2. For anything you'd chase, what would you actually check to settle it?",
  "3. Anything that looks like a pattern rather than a one-off?",
  "",
  "Findings marked *set aside* have already been ruled on — don't raise them again.",
].join("\n");

function findingLine(f: Finding): string {
  const who = [f.customerName, f.jobName].filter(Boolean).join(" · ");
  const inv = f.invoiceNumber ? ` (invoice #${f.invoiceNumber})` : "";
  const amt = f.amount == null ? "" : ` — ${money(f.amount)}`;
  const aside = f.suppressedBy
    ? `\n  - *Set aside* by ${f.suppressedBy.by}: "${f.suppressedBy.reason}"`
    : "";
  return `- **${f.title}**${amt}\n  - ${who}${inv}\n  - ${f.detail}${aside}`;
}

/**
 * The whole review as one markdown document.
 *
 * `includePreamble` is on by default (the clipboard / chat case) and off when
 * something already framed the task — the Claude Code skill, for instance,
 * which has its own instructions and just wants the facts.
 */
export function buildBrief(
  payload: ReviewPayload,
  opts: { includePreamble?: boolean } = {},
): string {
  const { evidence, findings } = payload;
  const live = findings.filter((f) => !f.suppressedBy);
  const invoices = evidence.jobs.reduce((s, j) => s + j.invoices.length, 0);
  const atStake = live.reduce((s, f) => s + Math.abs(f.amount ?? 0), 0);

  const out: string[] = [];
  if (opts.includePreamble !== false) out.push(PREAMBLE, "");

  out.push(`# Invoice review — ${evidence.monthLabel}`, "");
  out.push(
    `${invoices} client invoice${invoices === 1 ? "" : "s"} across ` +
      `${evidence.jobs.length} job${evidence.jobs.length === 1 ? "" : "s"}. ` +
      `${live.length} finding${live.length === 1 ? "" : "s"}, ${money(atStake)} in question.`,
  );
  out.push(`Backup is filed in \`${evidence.folderRoot}\`.`);

  // What was NOT checked is as important as what was — a reader must never
  // mistake a skipped leg for a clean one.
  const caveats: string[] = [];
  if (!evidence.emailChecked) {
    caveats.push("The office mailbox was **not** searched, so nothing here says whether the invoices were actually emailed.");
  }
  for (const w of evidence.warnings) caveats.push(w);
  if (caveats.length) {
    out.push("", "## Gaps in this review", "");
    out.push("**This review is incomplete.** " + caveats.map((c) => `\n- ${c}`).join(""));
  }

  for (const section of SECTIONS) {
    const rows = findings.filter((f) => !f.suppressedBy && f.severity === section.severity);
    if (!rows.length) continue;
    out.push("", `## ${section.heading} (${rows.length})`, "");
    out.push(rows.map(findingLine).join("\n\n"));
  }

  const aside = findings.filter((f) => f.suppressedBy);
  if (aside.length) {
    out.push("", `## Already set aside (${aside.length})`, "");
    out.push(aside.map(findingLine).join("\n\n"));
  }

  if (!findings.length) {
    out.push("", "Nothing was flagged.");
  }

  return out.join("\n") + "\n";
}
