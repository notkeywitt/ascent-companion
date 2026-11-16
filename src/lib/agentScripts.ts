/**
 * THE AI SCRIPTS — every Claude Code script the Macs run, in one list.
 *
 * /ai-scripts (admin) draws this list, and the settings each one takes are
 * stored in the companion DB (table agent_script_settings, src/lib/agentRuns.ts).
 * The Mac side reads them through scripts/agent-progress/agent-run.mjs before
 * every run, so a change on the page applies to the next run with no edit to
 * a Mac and no call to Claude.
 *
 * TO ADD A SCRIPT: add an entry here, then in its run.sh call
 *   node scripts/agent-progress/agent-run.mjs check <id>    (heartbeat, paused, Run now)
 *   node scripts/agent-progress/agent-run.mjs run <id> -- "$CLAUDE" -p "/<skill>" …
 * (see scripts/lead-research/run.sh). The page picks the rest up from here.
 *
 * Pure module: no DB, no Node, no React.
 */

export type AgentModel = "opus" | "sonnet" | "haiku";

export const MODELS: { id: AgentModel; label: string; note: string }[] = [
  { id: "opus", label: "Opus", note: "most careful, most expensive" },
  { id: "sonnet", label: "Sonnet", note: "the default for most work" },
  { id: "haiku", label: "Haiku", note: "fastest, cheapest, least thorough" },
];

export function isModel(v: unknown): v is AgentModel {
  return v === "opus" || v === "sonnet" || v === "haiku";
}

export interface AgentScript {
  id: string;
  name: string;
  /** One line for the list. */
  summary: string;
  /** What a run does, step by step. */
  process: string[];
  /** The slash command the run starts with. */
  skill: string;
  defaultModel: AgentModel;
  /** When it runs on its own, in words. */
  schedule: string;
  /** How often a Mac checks in (its launchd interval): Run now starts within this. */
  checkEveryMinutes: number | null;
  /**
   * How a person starts one:
   *   button  — "Run now" here; the Mac runs it on its next check.
   *   page    — it starts from another page (`startHref`); "Run now" only
   *             makes the Mac look for waiting work at once.
   *   hand    — typed in a Claude Code session. The app cannot start it, and
   *             its settings do not apply.
   */
  trigger: "button" | "page" | "hand";
  startHref?: string;
  startLabel?: string;
  /** An optional value "Run now" passes to run.sh, e.g. a billing month. */
  runArg?: { label: string; placeholder: string; pattern: string; hint: string };
  /** Where its results show. */
  resultHref: string;
  resultLabel: string;
  /** Where its files live in the repo. */
  folder: string;
}

export const AGENT_SCRIPTS: AgentScript[] = [
  {
    id: "lead-research",
    name: "Lead research",
    summary: "Builds a lead's property dossier from county records, permits and listings.",
    process: [
      "Claims the oldest lead someone asked to research.",
      "Reads the inquiry, then searches the county assessor, permits, inspections, recorded documents, septic and well records, zoning, hazards and listings.",
      "Downloads the photos and documents, and writes a one-paragraph summary.",
      "Pencils in the JobTread fields and the app's property details. A person approves them on the lead.",
    ],
    skill: "/lead-research",
    defaultModel: "sonnet",
    schedule: "Checks every 2 minutes for a lead waiting for research.",
    checkEveryMinutes: 2,
    trigger: "page",
    startHref: "/leads",
    startLabel: "Research a lead",
    resultHref: "/leads",
    resultLabel: "Customers",
    folder: "scripts/lead-research/",
  },
  {
    id: "tool-batch",
    name: "Tool batch",
    summary: "Fills in tools photographed with Batch add: name, type, serial, condition.",
    process: [
      "Takes every tool captured with Batch add, and every tool the office asked Claude to update.",
      "Reads each tool's photos: the tool, its serial plate, any extras.",
      "Works out the name, type, tool group, serial number, accessories and condition.",
      "Writes each tool to the Tools list, or parks it for the office.",
    ],
    skill: "/tool-batch",
    defaultModel: "sonnet",
    schedule: "Checks every 10 minutes. Runs when someone taps Analyze, or captures go quiet for 30 minutes.",
    checkEveryMinutes: 10,
    trigger: "button",
    resultHref: "/tools",
    resultLabel: "Tools",
    folder: "scripts/tool-batch/",
  },
  {
    id: "monthly-check",
    name: "Monthly invoice check",
    summary: "Chases every invoice-review finding and reconciles the tracking sheets.",
    process: [
      "Makes sure the month has a fresh coded review run.",
      "Chases each finding through JobTread, Gmail and Drive, and posts a verdict.",
      "Reconciles each legacy client's tracking sheet (bills and labor) against JobTread.",
      "Posts the month's reading and the full report to Checks.",
    ],
    skill: "/monthly-check",
    defaultModel: "sonnet",
    schedule: "Hourly from 9 am on review days (the 5th, 8th, 11th to the send day).",
    checkEveryMinutes: 60,
    trigger: "button",
    runArg: {
      label: "Billing month",
      placeholder: "YYYY-MM (blank: the month due)",
      pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
      hint: "Leave blank to check the month the schedule says is due.",
    },
    resultHref: "/invoice-review",
    resultLabel: "Checks",
    folder: "scripts/monthly-check/",
  },
  {
    id: "queue",
    name: "Feature requests queue",
    summary: "Works the requests typed into the app and ships each change.",
    process: [
      "Lists the open requests from Feature Requests.",
      "Does the ones the owner picks, each in its own worktree.",
      "Ships each change to the release queue and writes the result back on the request.",
    ],
    skill: "/queue",
    defaultModel: "sonnet",
    schedule: "Never on its own. It ships code, so a person starts it and watches it.",
    checkEveryMinutes: null,
    trigger: "hand",
    resultHref: "/requests",
    resultLabel: "Feature Requests",
    folder: "scripts/queue/",
  },
];

export function scriptById(id: string): AgentScript | undefined {
  return AGENT_SCRIPTS.find((s) => s.id === id);
}

/** The settings a person can change. Empty `model` = the script's default. */
export interface ScriptSettings {
  model: AgentModel;
  paused: boolean;
  extraPrompt: string;
  /** 0 = no limit. */
  maxTurns: number;
}

export const MAX_EXTRA_PROMPT = 4000;
export const MAX_TURNS_LIMIT = 500;

/** Check a settings change from the page. Unknown keys drop out. */
export function cleanSettings(raw: unknown): { ok: Partial<ScriptSettings> } | { error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<ScriptSettings> = {};
  if ("model" in r) {
    if (!isModel(r.model)) return { error: "Model must be opus, sonnet or haiku." };
    out.model = r.model;
  }
  if ("paused" in r) out.paused = r.paused === true;
  if ("extraPrompt" in r) {
    const s = String(r.extraPrompt ?? "").trim();
    if (s.length > MAX_EXTRA_PROMPT) return { error: `Extra instructions are limited to ${MAX_EXTRA_PROMPT} characters.` };
    out.extraPrompt = s;
  }
  if ("maxTurns" in r) {
    const n = Number(r.maxTurns ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > MAX_TURNS_LIMIT) return { error: `Max turns is a whole number from 0 to ${MAX_TURNS_LIMIT}.` };
    out.maxTurns = n;
  }
  return { ok: out };
}

/** A "Run now" argument, checked against the script's pattern. "" is always fine. */
export function cleanRunArg(script: AgentScript, raw: unknown): { ok: string } | { error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: "" };
  if (!script.runArg) return { error: "This script takes no value." };
  return new RegExp(script.runArg.pattern).test(s) ? { ok: s } : { error: `${script.runArg.label}: ${script.runArg.placeholder}.` };
}

/** A run with no new step this long reads as stalled on the page. */
export const STALL_MINUTES = 10;
