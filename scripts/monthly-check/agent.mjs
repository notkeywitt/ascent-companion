#!/usr/bin/env node
/**
 * Talks to /api/invoice-review/agent for the /monthly-check skill.
 *
 *   node scripts/monthly-check/agent.mjs schedule
 *   node scripts/monthly-check/agent.mjs run [YYYY-MM]
 *   node scripts/monthly-check/agent.mjs read YYYY-MM
 *   node scripts/monthly-check/agent.mjs begin YYYY-MM MODEL
 *   node scripts/monthly-check/agent.mjs finish YYYY-MM FILE.json
 *   node scripts/monthly-check/agent.mjs fail YYYY-MM "reason"
 *   node scripts/monthly-check/agent.mjs tracking
 *   node scripts/monthly-check/agent.mjs sheet-columns YYYY-MM FILE.json
 *   node scripts/monthly-check/agent.mjs sheet-check YYYY-MM FILE.json
 *   node scripts/monthly-check/agent.mjs log STATUS "message" [YYYY-MM] [LOGFILE]
 *
 * `read` saves the whole run to .monthly-check/<ym>.json and prints a compact
 * digest of it. `finish` posts { model, note, dispositions } from FILE.json,
 * plus the markdown at its `reportFile` as the full report.
 * `sheet-columns` takes { headers } and says which Tracking Sheet columns to
 * read; `sheet-check` posts { jtJobId, subVendor, labor, headers, codes,
 * columns } and prints what disagrees with JobTread (sheetCompare.ts).
 *
 * The token lives in ~/.ascent-monthly-check/token (install.sh makes it).
 * It is read here so it never appears on a command line or in a transcript.
 * MONTHLY_CHECK_URL overrides the app's address (default: production).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(ROOT, ".monthly-check");
const BASE = (process.env.MONTHLY_CHECK_URL || "https://ascent-companion.vercel.app").replace(/\/$/, "");
const TOKEN_FILE = path.join(os.homedir(), ".ascent-monthly-check", "token");

function token() {
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    console.error(`No token at ${TOKEN_FILE}. Run scripts/monthly-check/install.sh first.`);
    process.exit(3);
  }
}

/** node:http(s), not fetch: fetch drops a response after 5 minutes, and a
 *  month's sweep can run right up to the route's 300 s limit. */
function call(method, route, body) {
  const url = new URL(BASE + route);
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
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            return reject(new Error(`${method} ${route} → ${res.statusCode}: ${text.slice(0, 300)}`));
          }
          if ((res.statusCode ?? 500) >= 400) {
            return reject(new Error(`${method} ${route} → ${res.statusCode}: ${json.error ?? text.slice(0, 300)}`));
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

const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The run, compact: what Claude needs to start chasing, not the raw evidence. */
function digest(r) {
  const p = r.payload;
  if (!p) return `No filed run for ${r.ym}.`;
  const ev = p.evidence;
  const lines = [
    `# ${ev.monthLabel ?? r.ym} — filed ${r.storedAt} by ${r.ranBy}`,
    `emailChecked=${ev.emailChecked} mailTruncated=${ev.mailTruncated} jobs=${ev.jobs?.length ?? 0}`,
    `evidence warnings (${ev.warnings.length}):`,
    ...ev.warnings.map((w) => `  - ${w}`),
    `standing instructions: ${r.instructions.length ? r.instructions.map((t) => `"${t}"`).join("; ") : "none"}`,
    `pass: ${r.investigation ? `${r.investigation.status} (${r.investigation.model}, ${r.investigation.finishedAt || r.investigation.startedAt})` : "none yet"}`,
    "",
  ];
  const live = p.findings.filter((f) => !f.suppressedBy);
  lines.push(`findings: ${live.length} live, ${p.findings.length - live.length} ruled out`);
  for (const f of live) {
    const h = f.history ? (f.history.isNew ? "NEW" : `seen ${f.history.runsSeen}x since ${String(f.history.firstSeenAt).slice(0, 10)}`) : "no history";
    lines.push(
      `- [${f.severity}] ${f.kind} | ${f.customerName ?? ""} / ${f.jobName ?? ""} | ${f.amount != null ? money(f.amount) : ""} | ${h}`,
      `  key: ${f.key}`,
      `  ${f.title ?? ""}${f.detail ? ` — ${f.detail}` : ""}`,
    );
    if (f.disposition) lines.push(`  last verdict: ${f.disposition.verdict} — ${f.disposition.why}`);
  }
  return lines.join("\n");
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case "schedule":
      console.log(JSON.stringify(await call("GET", "/api/invoice-review/agent?action=schedule"), null, 2));
      return;
    case "run":
      console.log(JSON.stringify(await call("POST", "/api/invoice-review/agent", { action: "run", ...(a ? { ym: a } : {}) }), null, 2));
      return;
    case "read": {
      const r = await call("GET", `/api/invoice-review/agent?action=read&ym=${encodeURIComponent(a ?? "")}`);
      mkdirSync(OUT_DIR, { recursive: true });
      const file = path.join(OUT_DIR, `${r.ym}.json`);
      writeFileSync(file, JSON.stringify(r, null, 2));
      console.log(digest(r));
      console.log(`\nfull run: ${file}`);
      return;
    }
    case "pass": {
      // The month's pass status alone: running | done | error | none.
      const r = await call("GET", `/api/invoice-review/agent?action=read&ym=${encodeURIComponent(a ?? "")}`);
      console.log(r.investigation?.status ?? "none");
      return;
    }
    case "begin":
      console.log(JSON.stringify(await call("POST", "/api/invoice-review/agent", { action: "begin", ym: a, model: b })));
      return;
    case "finish": {
      const body = JSON.parse(readFileSync(b, "utf8"));
      if (body.reportFile) body.report = readFileSync(path.resolve(ROOT, body.reportFile), "utf8");
      delete body.reportFile;
      console.log(JSON.stringify(await call("POST", "/api/invoice-review/agent", { ...body, action: "finish", ym: a })));
      return;
    }
    case "tracking": {
      const r = await call("GET", "/api/invoice-review/agent?action=tracking");
      for (const j of r.jobs) console.log(`${j.jtJobId}\t${j.spreadsheetId}\t${j.label}`);
      if (!r.jobs.length) console.log("No jobs have a Tracking Sheet.");
      return;
    }
    case "sheet-columns": {
      const body = JSON.parse(readFileSync(b, "utf8"));
      console.log(JSON.stringify(await call("POST", "/api/invoice-review/agent", { action: "sheet-columns", ym: a, headers: body.headers })));
      return;
    }
    case "sheet-check": {
      const body = JSON.parse(readFileSync(b, "utf8"));
      const r = await call("POST", "/api/invoice-review/agent", { ...body, action: "sheet-check", ym: a });
      const out = path.join(OUT_DIR, `${a}.sheet.${body.jtJobId}.result.json`);
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(out, JSON.stringify(r, null, 2));
      console.log(
        `bills: JobTread ${money(r.jtTotal)}, sheet ${money(r.sheetTotal)}, difference ${money(r.difference)}` +
          (r.laborJt ? ` | labor: JobTread ${r.laborJt.hours} h ${money(r.laborJt.cost)}` : "") +
          (r.laborSheet ? `, sheet ${r.laborSheet.hours} h ${money(r.laborSheet.cost)}` : "") +
          (r.invoiceColumns ? ` | columns ${JSON.stringify(r.invoiceColumns)}` : ""),
      );
      for (const i of r.issues) {
        console.log(`- [${i.kind}] ${i.detail} (${i.where})`);
        for (const l of i.lines ?? []) console.log(`    ${l.vendor} ${l.bill} (${l.status}) ${l.name}: ${money(l.cost)}`);
      }
      if (!r.issues.length) console.log("No discrepancies.");
      console.log(`full result: ${out}`);
      return;
    }
    case "log": {
      // log STATUS "message" [ym] [logfile]
      const [, status, message, ym, logFile] = process.argv.slice(2);
      let tail = "";
      if (logFile) {
        try {
          tail = readFileSync(logFile, "utf8").split("\n").slice(-60).join("\n");
        } catch {
          /* no log to attach */
        }
      }
      console.log(JSON.stringify(await call("POST", "/api/invoice-review/agent", { action: "log", status, message, ym: ym || "", log: tail })));
      return;
    }
    case "fail":
      console.log(JSON.stringify(await call("POST", "/api/invoice-review/agent", { action: "fail", ym: a, error: b })));
      return;
    default:
      console.error(
        "usage: agent.mjs schedule | run [ym] | read ym | pass ym | begin ym model | finish ym file | fail ym reason |" +
          " tracking | sheet-columns ym file | sheet-check ym file | log status message [ym] [logfile]",
      );
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
