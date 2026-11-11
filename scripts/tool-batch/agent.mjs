#!/usr/bin/env node
/**
 * Talks to /api/invoice-review/agent/tools for the /tool-batch skill.
 *
 *   node scripts/tool-batch/agent.mjs due
 *   node scripts/tool-batch/agent.mjs begin
 *   node scripts/tool-batch/agent.mjs submit .tool-batch/results.json
 *   node scripts/tool-batch/agent.mjs finish "message"
 *   node scripts/tool-batch/agent.mjs fail "reason"
 *
 * `begin` hands every waiting tool to this run. It empties .tool-batch/, saves
 * the run to .tool-batch/run.json, downloads each photo to
 * .tool-batch/<toolId>/<n>-<role>.jpg and prints what to read.
 * `submit` posts each result in the file, one tool at a time (each one is two
 * Apps Script writes), and prints how each went.
 *
 * The token is the monthly check's: ~/.ascent-monthly-check/token (run
 * scripts/tool-batch/install.sh). It is read here so it never appears on a
 * command line or in a transcript. TOOL_BATCH_URL overrides the app's address.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(ROOT, ".tool-batch");
const BASE = (process.env.TOOL_BATCH_URL || "https://ascent-companion.vercel.app").replace(/\/$/, "");
const ROUTE = "/api/invoice-review/agent/tools";
const TOKEN_FILE = path.join(os.homedir(), ".ascent-monthly-check", "token");

function token() {
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    console.error(`No token at ${TOKEN_FILE}. Run scripts/tool-batch/install.sh first.`);
    process.exit(3);
  }
}

/** One call. `raw` returns the body as a Buffer (a photo) instead of JSON. */
function call(method, query, body, raw = false) {
  const url = new URL(BASE + ROUTE + (query ? `?${query}` : ""));
  const data = body ? JSON.stringify(body) : undefined;
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: {
          authorization: `Bearer ${token()}`,
          ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const status = res.statusCode ?? 500;
          if (raw && status < 400) return resolve(buf);
          let json;
          try {
            json = JSON.parse(buf.toString("utf8"));
          } catch {
            return reject(new Error(`${method} ${ROUTE} → ${status}: ${buf.toString("utf8").slice(0, 300)}`));
          }
          if (status >= 400 && status !== 422) {
            return reject(new Error(`${method} ${ROUTE} → ${status}: ${json.error ?? ""}`));
          }
          resolve(json);
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");

async function begin() {
  const r = await call("POST", "", { action: "begin" });
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "run.json"), JSON.stringify(r, null, 2));
  const lines = [`${r.items.length} tool(s) to fill in.`, ""];
  for (const item of r.items) {
    const dir = path.join(OUT_DIR, safe(item.toolId));
    mkdirSync(dir, { recursive: true });
    lines.push(`## itemId ${item.id} — toolId ${item.toolId}${item.idSource === "assigned" ? " (no QR; assigned id)" : ""} — by ${item.createdBy || "?"}, ${item.createdAt.slice(0, 16)}`);
    if (!item.photos.length) lines.push("  (no photos)");
    let n = 0;
    for (const p of item.photos) {
      const file = path.join(dir, `${++n}-${p.role}.jpg`);
      try {
        writeFileSync(file, await call("GET", `action=photo&id=${encodeURIComponent(p.id)}`, undefined, true));
        lines.push(`  ${p.role}: ${path.relative(ROOT, file)}`);
      } catch (e) {
        lines.push(`  ${p.role}: download failed — ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  const c = r.catalog;
  lines.push(
    "",
    `Types in use (${c.types.length}): ${c.types.join(" | ") || "none"}`,
    `Tool groups in use (${c.toolGroups.length}): ${c.toolGroups.join(" | ") || "none"}`,
    `Conditions in use: ${c.conditions.join(" | ") || "none"}`,
    `Existing tools: ${c.tools.length} — names and types in .tool-batch/run.json (catalog.tools)`,
  );
  console.log(lines.join("\n"));
}

async function submit(file) {
  const rows = JSON.parse(readFileSync(path.resolve(ROOT, file), "utf8"));
  const list = Array.isArray(rows) ? rows : rows.results;
  if (!Array.isArray(list)) throw new Error("The file must hold an array of results (or { results: [...] }).");
  let added = 0;
  let parked = 0;
  for (const r of list) {
    if (r.skip) {
      await call("POST", "", { action: "skip", itemId: r.itemId, reason: String(r.skip) });
      console.log(`- ${r.itemId}: parked — ${r.skip}`);
      parked++;
      continue;
    }
    const out = await call("POST", "", { action: "add", itemId: r.itemId, fields: r.fields, note: r.note ?? "" });
    if (out.ok) {
      added++;
      console.log(`- ${r.itemId}: added as ${out.toolId}${out.warn ? ` (${out.warn})` : ""}`);
    } else {
      parked++;
      console.log(`- ${r.itemId}: NOT added — ${out.error}`);
    }
  }
  console.log(`\n${added} added, ${parked} parked for the office.`);
}

async function main() {
  const [cmd, a] = process.argv.slice(2);
  switch (cmd) {
    case "due":
      console.log(JSON.stringify(await call("GET", "action=due")));
      return;
    case "begin":
      return begin();
    case "submit":
      return submit(a);
    case "finish":
    case "fail":
      console.log(JSON.stringify(await call("POST", "", { action: cmd, message: a ?? "" })));
      return;
    default:
      console.error("usage: agent.mjs due | begin | submit FILE.json | finish [message] | fail reason");
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
