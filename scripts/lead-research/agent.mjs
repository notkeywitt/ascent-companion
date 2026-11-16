#!/usr/bin/env node
/**
 * Talks to /api/invoice-review/agent/research for the /lead-research skill,
 * and fetches the web for it.
 *
 *   node scripts/lead-research/agent.mjs due
 *   node scripts/lead-research/agent.mjs begin
 *   node scripts/lead-research/agent.mjs pacs <street number> <street name>
 *   node scripts/lead-research/agent.mjs pacs --prop <prop_id>
 *   node scripts/lead-research/agent.mjs fetch <url> [file name]
 *   node scripts/lead-research/agent.mjs submit .lead-research/result.json
 *   node scripts/lead-research/agent.mjs fail "reason"
 *
 * `begin` claims the oldest waiting run (another Mac may have taken it: then
 * it prints "Nothing to research." and the skill stops). It empties
 * .lead-research/, saves the run to .lead-research/run.json and prints the
 * briefing.
 *
 * `pacs` searches the San Juan County assessor (PropertyAccess), the source
 * the old appscript ParcelEnrichment.js used. It saves the results and each
 * parcel's detail page to .lead-research/pages/ and downloads the parcel
 * photos to .lead-research/files/.
 *
 * `fetch` GETs one URL with a cookie jar kept per run. An HTML or text answer
 * is saved to .lead-research/pages/ for Read; anything else (a PDF, a photo)
 * to .lead-research/files/. It prints the path, the type and the size.
 *
 * `submit` uploads every file the result names (in 3 MB chunks), then the
 * dossier. The run then waits for a person on /leads/research/<id>.
 *
 * The token: env REVIEW_AGENT_TOKEN, else ~/.ascent-monthly-check/token (made
 * by the monthly check's install, copied to a second Mac by hand). It is read
 * here so it never appears on a command line or in a transcript.
 * LEAD_RESEARCH_URL overrides the app's address.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, ".lead-research");
const PAGES = path.join(OUT, "pages");
const FILES = path.join(OUT, "files");
const JAR = path.join(OUT, "cookies.json");
const BASE = (process.env.LEAD_RESEARCH_URL || "https://ascent-companion.vercel.app").replace(/\/$/, "");
const ROUTE = "/api/invoice-review/agent/research";
const TOKEN_FILE = path.join(os.homedir(), ".ascent-monthly-check", "token");
const PACS = "https://parcel.sanjuancountywa.gov/PropertyAccess";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

function token() {
  const env = (process.env.REVIEW_AGENT_TOKEN || "").trim();
  if (env) return env;
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    console.error(`No token. Run scripts/lead-research/install.sh (it reads ${TOKEN_FILE}).`);
    process.exit(3);
  }
}

async function call(method, query, body, raw) {
  const res = await fetch(BASE + ROUTE + (query ? `?${query}` : ""), {
    method,
    headers: {
      authorization: `Bearer ${token()}`,
      ...(raw ? { "content-type": "application/octet-stream" } : body ? { "content-type": "application/json" } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${ROUTE} → ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`${method} ${ROUTE} → ${res.status}: ${json.error ?? ""}`);
  return json;
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "file";

function runId() {
  try {
    return JSON.parse(readFileSync(path.join(OUT, "run.json"), "utf8")).runId || "";
  } catch {
    return "";
  }
}

// ── A small cookie jar, per host, kept for the whole run ──────────────────────

function jar() {
  try {
    return JSON.parse(readFileSync(JAR, "utf8"));
  } catch {
    return {};
  }
}
function cookieFor(url) {
  const host = new URL(url).hostname;
  const c = jar()[host] || {};
  return Object.entries(c)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
function keepCookies(url, res) {
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  if (!set.length) return;
  const host = new URL(url).hostname;
  const all = jar();
  const c = all[host] || {};
  for (const line of set) {
    const first = String(line).split(";")[0].trim();
    const eq = first.indexOf("=");
    if (eq > 0) c[first.slice(0, eq)] = first.slice(eq + 1);
  }
  all[host] = c;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(JAR, JSON.stringify(all));
}

/** GET or POST with the jar, following redirects by hand so each hop keeps its cookies. */
async function web(url, opts = {}) {
  let current = url;
  let method = opts.method || "GET";
  let body = opts.body;
  for (let hop = 0; hop < 8; hop++) {
    const cookie = cookieFor(current);
    const res = await fetch(current, {
      method,
      redirect: "manual",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/pdf,image/*,*/*;q=0.8",
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(opts.headers || {}),
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    keepCookies(current, res);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      method = "GET";
      body = undefined;
      continue;
    }
    return { res, url: current };
  }
  throw new Error(`Too many redirects from ${url}`);
}

const EXT = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/tiff": ".tif",
  "text/html": ".html",
  "text/plain": ".txt",
  "application/json": ".json",
};

function uniquePath(dir, name) {
  mkdirSync(dir, { recursive: true });
  let p = path.join(dir, name);
  const { name: stem, ext } = path.parse(name);
  for (let i = 2; existsSync(p); i++) p = path.join(dir, `${stem}-${i}${ext}`);
  return p;
}

async function save(url, wanted) {
  const { res, url: finalUrl } = await web(url);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  const textual = type.startsWith("text/") || type.includes("html") || type === "application/json" || type.includes("xml");
  const fromUrl = path.basename(new URL(finalUrl).pathname) || "page";
  let name = safe(wanted || fromUrl);
  if (!path.extname(name) && EXT[type]) name += EXT[type];
  const file = uniquePath(textual ? PAGES : FILES, name);
  writeFileSync(file, buf);
  return { status: res.status, type, size: buf.length, file: path.relative(ROOT, file), finalUrl };
}

// ── San Juan County assessor (PropertyAccess) ────────────────────────────────

const hidden = (html, name) => (new RegExp(`id="${name}"[^>]*value="([^"]*)"`).exec(html) || [])[1] || "";
const propIds = (html) => [...new Set([...html.matchAll(/prop_id=(\d+)/gi)].map((m) => m[1]))];

async function pacsSearch(number, street, year) {
  const { res } = await web(`${PACS}/PropertySearch.aspx?cid=0`);
  const form = await res.text();
  const vs = hidden(form, "__VIEWSTATE");
  const ev = hidden(form, "__EVENTVALIDATION");
  if (!vs || !ev) throw new Error("The assessor search form changed (no __VIEWSTATE).");
  const body = new URLSearchParams({
    __VIEWSTATE: vs,
    __VIEWSTATEGENERATOR: hidden(form, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: ev,
    "propertySearchOptions$searchType": "address",
    "propertySearchOptions$streetNumber": number,
    "propertySearchOptions$streetName": street,
    "propertySearchOptions$city": "",
    "propertySearchOptions$taxyear": String(year),
    "propertySearchOptions$propertyType": "All",
    "propertySearchOptions$orderResultsBy": "Address",
    "propertySearchOptions$recordsPerPage": "25",
    "propertySearchOptions$search": "Search",
  }).toString();
  const out = await web(`${PACS}/PropertySearch.aspx?cid=0`, { method: "POST", body });
  return out.res.text();
}

async function pacs(args) {
  mkdirSync(PAGES, { recursive: true });
  const year = new Date().getFullYear();
  let ids = [];
  if (args[0] === "--prop") {
    ids = [String(args[1] || "").replace(/\D/g, "")].filter(Boolean);
  } else {
    const number = String(args[0] || "").trim();
    // A street-type suffix makes the portal miss ("Salmon" finds "Salmon Point Rd").
    const street = args
      .slice(1)
      .join(" ")
      .trim()
      .replace(/\s+(Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Ln|Lane|Way|Pl|Place|Ct|Court|Blvd|Hwy|Highway|Ter|Terrace|Cir|Circle|Loop|Trl|Trail)\.?$/i, "");
    if (!number || !street) throw new Error("usage: pacs <street number> <street name>  |  pacs --prop <prop_id>");
    let html = "";
    for (const y of [year, year - 1]) {
      html = await pacsSearch(number, street, y);
      ids = propIds(html);
      if (ids.length) break;
    }
    const file = uniquePath(PAGES, `pacs-search-${safe(number + "-" + street)}.html`);
    writeFileSync(file, html);
    console.log(`search results: ${path.relative(ROOT, file)} — ${ids.length} parcel(s): ${ids.join(", ") || "none"}`);
    if (!ids.length) return;
  }
  for (const id of ids.slice(0, 5)) {
    let html = "";
    let used = year;
    for (const y of [year, year - 1]) {
      const { res } = await web(`${PACS}/Property.aspx?cid=0&year=${y}&prop_id=${id}`);
      html = await res.text();
      used = y;
      if (/Improvement|Land|Owner/i.test(html)) break;
    }
    const file = uniquePath(PAGES, `pacs-parcel-${id}.html`);
    writeFileSync(file, html);
    console.log(`parcel ${id} (${used}): ${path.relative(ROOT, file)}  url: ${PACS}/Property.aspx?cid=0&year=${used}&prop_id=${id}`);
    const imgs = [...new Set([...html.matchAll(/ImageRetriever\.aspx\?[^"']*?img_id=(\d+)/gi)].map((m) => m[1]))];
    for (const img of imgs) {
      try {
        const r = await save(`${PACS}/ImageRetriever.aspx?cid=0&img_id=${img}&full=true&ext=.jpg`, `assessor-${id}-${img}.jpg`);
        console.log(`  photo: ${r.file} (${r.type}, ${r.size} bytes)`);
      } catch (e) {
        console.log(`  photo ${img}: failed — ${e instanceof Error ? e.message : e}`);
      }
    }
    const docs = [...new Set([...html.matchAll(/href="([^"]+\.(?:pdf|PDF)[^"]*)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, "&"), `${PACS}/`).toString()))];
    for (const d of docs) console.log(`  linked document: ${d}`);
  }
}

// ── The app ──────────────────────────────────────────────────────────────────

async function begin() {
  const r = await call("POST", "", { action: "begin", runner: os.hostname().replace(/\.local$/, "") });
  if (!r.run) {
    console.log("Nothing to research.");
    return;
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(PAGES, { recursive: true });
  mkdirSync(FILES, { recursive: true });
  writeFileSync(path.join(OUT, "run.json"), JSON.stringify(r.run, null, 2));
  const { lead, subject, fields, filesGoTo, limits } = r.run;
  const lines = [
    `runId: ${r.run.runId}`,
    `Lead: ${lead.name}${lead.inJobTread ? "" : " (not in JobTread yet — fields wait until it is pushed)"}`,
    `Address: ${lead.address || "(none — find it from the inquiry, or stop and say so)"}`,
  ];
  if (subject?.location) {
    const l = subject.location;
    lines.push(`JobTread location: ${[l.address, l.city, l.county, l.state, l.postalCode].filter(Boolean).join(", ")}${l.latitude != null ? ` (${l.latitude}, ${l.longitude})` : ""}`);
  }
  if (subject?.job) lines.push(`Newest job: ${subject.job.number} ${subject.job.name} (${subject.jobCount} job(s))`);
  if (subject?.contact) lines.push(`Contact: ${[subject.contact.name, subject.contact.email, subject.contact.phone].filter(Boolean).join(" · ")}`);
  if (lead.requestNote) lines.push("", `THE OFFICE ASKED: ${lead.requestNote}  (asked by ${lead.requestedBy})`);
  if (lead.inquiry) lines.push("", "INQUIRY:", lead.inquiry);
  if (lead.inquiryFiles?.length) lines.push("Files the customer attached (fetch and read them):", ...lead.inquiryFiles.map((f) => `  ${f.name}: ${f.url}`));
  const jt = Object.entries(lead.jtCustomerFields || {});
  if (jt.length) lines.push("", "JOBTREAD CUSTOMER FIELDS NOW:", ...jt.map(([k, v]) => `  ${k}: ${v}`));
  if (lead.scope) lines.push("", `Project scope (our words): ${lead.scope}`);
  if (lead.ourNotes) lines.push(`Our notes: ${lead.ourNotes}`);
  lines.push("", "FIELDS YOU MAY PROPOSE (target, fieldId, name, type, options, now):");
  for (const target of ["account", "location", "job"]) {
    const list = fields[target] || [];
    if (target === "job" && !subject?.job) {
      lines.push(`  job: no job yet — put job facts in "facts" instead`);
      continue;
    }
    for (const f of list) {
      lines.push(`  ${target} ${f.id} "${f.name}" ${f.type}${f.options?.length ? ` [${f.options.join(" | ")}]` : ""} now="${f.current}"`);
    }
  }
  lines.push(`  location (no fieldId) field "address" now="${subject?.location?.address || ""}"`);
  lines.push("", `Files go to: ${filesGoTo}`, `Limits: ${limits.maxRunFiles} files, ${Math.round(limits.maxFileBytes / 1048576)} MB each, ${Math.round(limits.maxRunBytes / 1048576)} MB in all.`);
  console.log(lines.join("\n"));
}

const MIME = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".tif": "image/tiff", ".tiff": "image/tiff", ".heic": "image/heic", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".txt": "text/plain", ".html": "text/html", ".kml": "application/vnd.google-earth.kml+xml" };

async function submit(file) {
  const id = runId();
  if (!id) throw new Error("No run.json — run begin first.");
  const result = JSON.parse(readFileSync(path.resolve(ROOT, file), "utf8"));
  const files = Array.isArray(result.files) ? result.files : [];
  let sent = 0;
  for (const f of files) {
    const abs = path.resolve(ROOT, String(f.path || ""));
    if (!abs.startsWith(OUT + path.sep) || !existsSync(abs)) {
      console.log(`- ${f.path}: skipped — not a file under .lead-research/`);
      continue;
    }
    const size = statSync(abs).size;
    const ext = path.extname(abs).toLowerCase();
    try {
      const meta = await call("POST", "", {
        action: "file",
        runId: id,
        name: f.name || path.basename(abs),
        kind: f.kind === "photo" || /^image\//.test(MIME[ext] || "") ? "photo" : "document",
        mime: MIME[ext] || "application/octet-stream",
        size,
        source: f.source || "",
        description: f.description || "",
      });
      const bytes = readFileSync(abs);
      const CHUNK = 3 * 1024 * 1024;
      for (let seq = 0; seq < meta.chunks; seq++) {
        await call("PUT", `fileId=${encodeURIComponent(meta.fileId)}&seq=${seq}`, undefined, bytes.subarray(seq * CHUNK, (seq + 1) * CHUNK));
      }
      sent++;
      console.log(`- ${path.relative(ROOT, abs)}: sent (${size} bytes)`);
    } catch (e) {
      console.log(`- ${path.relative(ROOT, abs)}: NOT sent — ${e instanceof Error ? e.message : e}`);
    }
  }
  const { files: _files, ...dossier } = result;
  const out = await call("POST", "", { action: "submit", runId: id, result: dossier });
  console.log(`\n${sent} of ${files.length} file(s) sent. ${out.proposals} JobTread field(s) and ${out.facts} property detail(s) penciled in.`);
  if (out.warnings?.length) console.log("The app left out:\n" + out.warnings.map((w) => `  - ${w}`).join("\n"));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "due":
      console.log(JSON.stringify(await call("GET", "action=due")));
      return;
    case "begin":
      return begin();
    case "pacs":
      return pacs(rest);
    case "fetch": {
      if (!rest[0]) throw new Error("usage: fetch <url> [file name]");
      const r = await save(rest[0], rest[1]);
      console.log(`${r.file}  HTTP ${r.status}  ${r.type || "?"}  ${r.size} bytes${r.finalUrl !== rest[0] ? `  (from ${r.finalUrl})` : ""}`);
      return;
    }
    case "submit":
      return submit(rest[0] || ".lead-research/result.json");
    case "fail":
      console.log(JSON.stringify(await call("POST", "", { action: "fail", runId: runId(), message: rest.join(" ") })));
      return;
    default:
      console.error("usage: agent.mjs due | begin | pacs … | fetch <url> [name] | submit FILE.json | fail reason");
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
