#!/usr/bin/env node
/**
 * The AI Scripts page's hands on a Mac (/ai-scripts, src/lib/agentRuns.ts).
 * Every scheduled Claude Code script runs through it, so the page can show
 * live progress, Stop a run, start one, and set its model and instructions.
 *
 *   node scripts/agent-progress/agent-run.mjs check <script>
 *       The tick. Records this Mac as seen and prints one line:
 *         paused       the page paused this script: do nothing
 *         now [value]  someone pressed Run now (with its value, if any)
 *         idle         do the script's own due check
 *       If the app cannot be reached it prints "idle", so a run.sh falls back
 *       to its own logic.
 *
 *   node scripts/agent-progress/agent-run.mjs code <commit> "<note>"
 *       The updater (scripts/mac-update/update.sh) reports which commit this
 *       Mac's repo copy is on and what it last did.
 *
 *   node scripts/agent-progress/agent-run.mjs run <script> [--title "…"] -- "$CLAUDE" -p "/skill" [args…]
 *       Starts Claude Code with the page's settings: the model (replacing any
 *       --model in the args), the extra instructions (added to the prompt) and
 *       the max turns. It adds --output-format stream-json, which makes Claude
 *       Code print each step as it happens at no token cost. This script turns
 *       each step into one readable line, prints it (the run.sh log), and sends
 *       the lines to the app every 5 seconds. When the page asks for Stop it
 *       ends Claude Code and exits 130. Otherwise it exits with Claude's code.
 *
 * The token: env REVIEW_AGENT_TOKEN, else ~/.ascent-monthly-check/token.
 * AGENT_PROGRESS_URL overrides the app's address.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const BASE = (process.env.AGENT_PROGRESS_URL || "https://ascent-companion.vercel.app").replace(/\/$/, "");
const ROUTE = "/api/invoice-review/agent/progress";
const TOKEN_FILE = path.join(os.homedir(), ".ascent-monthly-check", "token");
const MACHINE = os.hostname().replace(/\.local$/, "");
const FLUSH_MS = 5000;

function token() {
  const env = (process.env.REVIEW_AGENT_TOKEN || "").trim();
  if (env) return env;
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

async function call(method, query, body) {
  const res = await fetch(BASE + ROUTE + (query ? `?${query}` : ""), {
    method,
    headers: { authorization: `Bearer ${token()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${ROUTE} → ${res.status}: ${json.error ?? ""}`);
  return json;
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const short = (s, n = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const base = (p) => path.basename(String(p ?? ""));
const host = (u) => {
  try {
    const x = new URL(u);
    return short(x.hostname.replace(/^www\./, "") + x.pathname, 90);
  } catch {
    return short(u, 90);
  }
};

/** One tool call → one line a person can read. */
function describeTool(name, input = {}) {
  switch (name) {
    case "Bash": {
      const cmd = String(input.command ?? "");
      const m = /node\s+scripts\/([\w-]+)\/agent\.mjs\s+(\S+)(.*)/.exec(cmd);
      if (m) return `App: ${m[2]}${m[3].trim() ? ` ${short(m[3].trim(), 100)}` : ""}`;
      return `Ran: ${short(input.description || cmd, 120)}`;
    }
    case "Read":
      return `Read ${base(input.file_path)}`;
    case "Write":
      return `Wrote ${base(input.file_path)}`;
    case "Edit":
      return `Edited ${base(input.file_path)}`;
    case "Glob":
      return `Listed files: ${short(input.pattern, 80)}`;
    case "Grep":
      return `Searched files for "${short(input.pattern, 60)}"`;
    case "WebSearch":
      return `Searched the web: ${short(input.query, 120)}`;
    case "WebFetch":
      return `Read page: ${host(input.url)}`;
    case "Skill":
      return `Started skill /${input.skill ?? input.command ?? ""}`;
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return "Updated its plan";
    default: {
      // mcp__claude_ai_Gmail__search_threads → "Gmail: search threads"
      const m = /^mcp__(?:claude_ai_)?([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name);
      if (m) return `${m[1].replace(/_/g, " ")}: ${m[2].replace(/_/g, " ")}`;
      return `Used ${name}`;
    }
  }
}

async function cmdCheck(script) {
  try {
    const r = await call("GET", `action=check&script=${encodeURIComponent(script)}&machine=${encodeURIComponent(MACHINE)}`);
    const arg = String(r.arg ?? "").replace(/[^\w.:-]/g, "");
    console.log(r.state === "now" ? `now${arg ? ` ${arg}` : ""}` : r.state === "paused" ? "paused" : "idle");
  } catch {
    console.log("idle");
  }
}

function withSettings(args, cfg) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model" || args[i] === "--max-turns" || args[i] === "--output-format") {
      i++;
      continue;
    }
    if (args[i] === "--verbose") continue;
    out.push(args[i]);
  }
  const p = out.indexOf("-p");
  if (p >= 0 && p + 1 < out.length && cfg.extraPrompt) {
    out[p + 1] = `${out[p + 1]}\n\nExtra instructions from the office (set on /ai-scripts):\n${cfg.extraPrompt}`;
  }
  if (cfg.model) out.push("--model", cfg.model);
  if (cfg.maxTurns > 0) out.push("--max-turns", String(cfg.maxTurns));
  out.push("--output-format", "stream-json", "--verbose");
  return out;
}

async function cmdRun(script, title, claudeArgs) {
  if (!claudeArgs.length) throw new Error('usage: run <script> [--title "…"] -- "$CLAUDE" -p "/skill" …');
  let cfg = { runId: "", model: "", extraPrompt: "", maxTurns: 0 };
  try {
    cfg = await call("POST", "", { action: "start", script, machine: MACHINE, title });
  } catch (e) {
    console.log(`${stamp()} (the app could not be reached; running without live progress: ${e instanceof Error ? e.message : e})`);
  }
  const [bin, ...rest] = claudeArgs;
  const args = withSettings(rest, cfg);
  console.log(`${stamp()} starting ${script} on ${MACHINE}${cfg.model ? ` (${cfg.model})` : ""}`);

  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  let queue = [];
  let stopped = false;
  let final = null;
  const push = (kind, text) => {
    if (!text) return;
    console.log(`${stamp()} ${kind === "step" ? "" : `[${kind}] `}${text}`);
    queue.push({ at: new Date().toISOString(), kind, text });
  };

  const flush = async () => {
    if (!cfg.runId) return;
    const batch = queue;
    queue = [];
    try {
      const r = await call("POST", "", { action: "events", runId: cfg.runId, events: batch });
      if (r.stop && !stopped) {
        stopped = true;
        push("note", "Stopped from the AI Scripts page.");
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
      }
    } catch {
      queue = batch.concat(queue).slice(-400); // keep them for the next try
    }
  };
  const timer = setInterval(flush, FLUSH_MS);

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      if (line.trim()) push("note", short(line, 300));
      return;
    }
    if (ev.type === "system" && ev.subtype === "init") {
      push("note", `Claude Code started (${ev.model ?? "model unknown"})`);
    } else if (ev.type === "assistant") {
      for (const c of ev.message?.content ?? []) {
        if (c.type === "tool_use") push("step", describeTool(c.name, c.input));
        else if (c.type === "text" && c.text?.trim()) push("note", short(c.text, 400));
      }
    } else if (ev.type === "result") {
      final = ev;
    }
  });
  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    if (line.trim()) push("error", short(line, 300));
  });

  const code = await new Promise((resolve) => {
    child.on("close", (c) => resolve(c ?? 1));
    child.on("error", (e) => {
      push("error", `Could not start Claude Code: ${e.message}`);
      resolve(1);
    });
  });
  clearInterval(timer);

  const usage = final?.usage ?? {};
  const failed = code !== 0 || final?.is_error || (final?.subtype && final.subtype !== "success");
  const status = stopped ? "stopped" : failed ? "error" : "done";
  if (final?.result) console.log(`\n${final.result}\n`);
  push("note", status === "done" ? "Finished." : status === "stopped" ? "Stopped." : `Ended with an error (${final?.subtype ?? `exit ${code}`}).`);
  await flush();
  if (cfg.runId) {
    await call("POST", "", {
      action: "end",
      runId: cfg.runId,
      status,
      costUsd: typeof final?.total_cost_usd === "number" ? final.total_cost_usd : null,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      result: short(final?.result ?? "", 2000),
    }).catch(() => {});
  }
  console.log(`${stamp()} ${status}${typeof final?.total_cost_usd === "number" ? ` — $${final.total_cost_usd.toFixed(2)}` : ""}`);
  return stopped ? 130 : code === 0 && failed ? 1 : code;
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd, script] = argv;
  if (cmd === "code") {
    const version = String(argv[1] ?? "").trim();
    await call("GET", `action=code&machine=${encodeURIComponent(MACHINE)}&version=${encodeURIComponent(version)}&note=${encodeURIComponent(String(argv[2] ?? ""))}`);
    return;
  }
  if (!script) {
    console.error('usage: agent-run.mjs check <script> | run <script> [--title "…"] -- <claude> args…');
    process.exit(2);
  }
  if (cmd === "check") return cmdCheck(script);
  if (cmd === "run") {
    const sep = argv.indexOf("--");
    const opts = argv.slice(2, sep < 0 ? argv.length : sep);
    const t = opts.indexOf("--title");
    const title = t >= 0 ? String(opts[t + 1] ?? "") : "";
    process.exit(await cmdRun(script, title, sep < 0 ? [] : argv.slice(sep + 1)));
  }
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
