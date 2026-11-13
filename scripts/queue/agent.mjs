#!/usr/bin/env node
/**
 * The /queue skill's only door to App Feedback (.claude/skills/queue/SKILL.md).
 *
 *   node scripts/queue/agent.mjs list
 *   node scripts/queue/agent.mjs result <id> "<what was done>" [open|planned|done|declined]
 *
 * The token: env REVIEW_AGENT_TOKEN, else the monthly check's
 * ~/.ascent-monthly-check/token (same value). It never appears on a command
 * line or in a transcript. QUEUE_URL overrides the address (a local dev server).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const URL_ = (process.env.QUEUE_URL || "https://ascent-companion.vercel.app").replace(/\/$/, "") + "/api/invoice-review/agent/requests";
const TOKEN_FILE = path.join(os.homedir(), ".ascent-monthly-check", "token");

function token() {
  const env = (process.env.REVIEW_AGENT_TOKEN || "").trim();
  if (env) return env;
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    throw new Error(`No token. Set REVIEW_AGENT_TOKEN, or run scripts/monthly-check/install.sh (it writes ${TOKEN_FILE}).`);
  }
}

async function call(body) {
  const res = await fetch(URL_, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${json.error ?? res.statusText}`);
  return json;
}

const [cmd, id, result, status] = process.argv.slice(2);
try {
  if (cmd === "list") {
    const { requests } = await call();
    console.log(`${requests.length} open request(s).`);
    for (const r of requests) {
      console.log(`\n## ${r.id}${r.pushThrough ? " — PUSH THROUGH" : ""} — ${r.title}`);
      console.log(`  ${r.status}, ${r.createdAt.slice(0, 10)}${r.requester ? `, from ${r.requester}` : ""}`);
      if (r.detail) console.log(`  ${r.detail.replace(/\n/g, "\n  ")}`);
    }
  } else if (cmd === "result" && id && result) {
    const { request } = await call({ id: Number(id), result, ...(status ? { status } : {}) });
    console.log(`Request ${request.id} is now ${request.status}.`);
  } else {
    console.error('Usage: agent.mjs list | result <id> "<what was done>" [status]');
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
