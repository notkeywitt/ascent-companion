#!/usr/bin/env node
/**
 * The session ledger — one file per Claude session, written as the work happens.
 *
 * The problem it solves: work here is sporadic and interrupted. A session ends
 * mid-thought, and days later nothing on disk says what it was doing or how far
 * it got. HANDOFF.md tried to be that record and failed for three reasons this
 * script is built to avoid:
 *
 *   1. One shared file, so two branches editing it conflict. Here every session
 *      gets its OWN file, and git never conflicts on two distinct new files.
 *   2. Written at the end, so an interrupted session wrote nothing. Here the
 *      post-commit hook appends each commit the moment it lands — no memory,
 *      no discipline, no end-of-session ritual required.
 *   3. Prose only, so nothing could answer "what is in flight right now".
 *      Here the state is front matter a machine reads (`status`, `next`), and
 *      `board` renders every session into one table.
 *
 * A session file lives at `.claude/sessions/<date>-<slug>.md` and is keyed to
 * the branch. It looks like this:
 *
 *     ---
 *     slug: session-progress-tracking
 *     branch: claude/session-progress-tracking-qtse7l
 *     status: in-progress          # in-progress | parked | shipped
 *     started: 2026-09-03T04:30:00Z
 *     updated: 2026-09-03T05:12:00Z
 *     goal: Track what each session did and where it stopped
 *     next: Wire the same hooks into ascent-appscript
 *     ---
 *
 *     ## Log
 *     - 2026-09-03 04:52 · `abc1234` companion: add the session ledger
 *       scripts/session.mjs, .githooks/post-commit
 *
 *     ## Notes
 *
 * Commands (all dependency-free, run from anywhere inside the repo):
 *
 *   start [--goal "..."]   create this branch's session file if it has none
 *   path                   print this branch's session file path
 *   log [sha]              append a commit row (the post-commit hook calls this)
 *   set <field> <value>    set a front-matter field (goal | next | status)
 *   note <text>            append a line under ## Notes
 *   touch                  stamp `updated` (the Stop hook calls this)
 *   brief                  the context block SessionStart feeds to Claude
 *   board [--write]        render every session as a table; --write → SESSIONS.md
 *
 * Nothing here talks to the network or to production. It reads git and writes
 * markdown.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

// ── git helpers ─────────────────────────────────────────────────────────────

/** Run a git command, returning trimmed stdout — or `fallback` if it fails. */
function git(args, fallback = "") {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

const ROOT = git(["rev-parse", "--show-toplevel"]);
if (!ROOT) {
  console.error("session: not inside a git repository");
  process.exit(1);
}

const SESSIONS_DIR = join(ROOT, ".claude", "sessions");
const BOARD_PATH = join(ROOT, "SESSIONS.md");
// The same ledger, as data the Assistant's /changelog page imports. Written
// only in the companion (the repo that HAS a src/lib); the Apps Script repo
// gets the markdown board and nothing else.
const JSON_PATH = join(ROOT, "src", "lib", "sessionLog.generated.json");
const REPO = basename(ROOT);

// This repo's ship command. The companion has npm; the Apps Script repo has no
// package.json, so there the script is called directly. Same file, both repos.
const SHIP = existsSync(join(ROOT, "package.json")) ? "npm run ship" : "./scripts/ship.sh";

/** The branch we are on, or "" in a detached HEAD (where a session makes no sense). */
function currentBranch() {
  const b = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return b === "HEAD" ? "" : b;
}

// ── naming ──────────────────────────────────────────────────────────────────

/**
 * A readable slug for a branch.
 *
 * `claude/session-progress-tracking-qtse7l` → `session-progress-tracking`.
 * The `claude/` prefix and the 6-character random suffix the web/iOS client
 * appends carry no meaning, so both come off. Work done straight on `main`
 * (the normal case here) is journalled one file per day instead.
 */
function slugForBranch(branch, today) {
  if (!branch || branch === "main" || branch === "master") return "main";
  let s = branch.replace(/^claude\//, "").replace(/^[a-z]+\//, "");
  s = s.replace(/-[a-z0-9]{6,8}$/i, "");
  s = s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return s || `branch-${today}`;
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `YYYY-MM-DD` in local time — the date a human would call "today". */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── the session file ────────────────────────────────────────────────────────

/**
 * Parse a session file into `{ meta, body }`.
 *
 * Front matter is deliberately flat `key: value` lines, one line per value —
 * no YAML parser, no dependency, and nothing that can half-parse into a wrong
 * status. A line without a colon is ignored.
 */
function parse(text) {
  const meta = {};
  let body = text;
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (m) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i < 1) continue;
      meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    body = text.slice(m[0].length);
  }
  return { meta, body };
}

const META_ORDER = ["slug", "repo", "branch", "status", "started", "updated", "goal", "next"];

function serialize(meta, body) {
  const keys = [...META_ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !META_ORDER.includes(k))];
  const front = keys.map((k) => `${k}: ${meta[k] ?? ""}`).join("\n");
  return `---\n${front}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}

/** Every session file on disk, newest activity first. */
function readAll() {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const path = join(SESSIONS_DIR, f);
      const { meta, body } = parse(readFileSync(path, "utf8"));
      return { file: f, path, meta, body };
    })
    .sort((a, b) => String(b.meta.updated ?? "").localeCompare(String(a.meta.updated ?? "")));
}

/**
 * This branch's session file.
 *
 * Matched on `branch`, not on filename — a branch renamed or re-cut keeps its
 * record. Work on `main` falls back to today's `main` journal so a day of
 * direct-to-production commits still lands somewhere.
 */
function findForBranch(branch) {
  const all = readAll();
  const exact = all.find((s) => s.meta.branch === branch);
  if (exact) return exact;
  if (branch === "main" || branch === "master" || !branch) {
    const name = `${today()}-main.md`;
    return all.find((s) => s.file === name) ?? null;
  }
  return null;
}

/** Create this branch's session file if it has none. Idempotent. */
function ensure(goal) {
  const branch = currentBranch();
  const existing = findForBranch(branch);
  if (existing) {
    if (goal && !existing.meta.goal) {
      existing.meta.goal = goal;
      existing.meta.updated = isoNow();
      writeFileSync(existing.path, serialize(existing.meta, existing.body));
    }
    return existing;
  }

  const slug = slugForBranch(branch, today());
  const path = join(SESSIONS_DIR, `${today()}-${slug}.md`);
  const meta = {
    slug,
    repo: REPO,
    branch: branch || "(detached)",
    status: "in-progress",
    started: isoNow(),
    updated: isoNow(),
    goal: goal ?? "",
    next: "",
  };
  const body = [
    "",
    "## Log",
    "",
    "<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->",
    "",
    "## Notes",
    "",
  ].join("\n");
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(path, serialize(meta, body));
  return { file: basename(path), path, meta, body };
}

function save(session) {
  session.meta.updated = isoNow();
  writeFileSync(session.path, serialize(session.meta, session.body));
}

// ── commands ────────────────────────────────────────────────────────────────

/**
 * Append one commit to the ## Log section.
 *
 * Called by the post-commit hook, so it must never fail loudly and never
 * double-write: a sha already in the file is skipped, which keeps an amended
 * or re-run commit from stacking duplicate rows.
 */
function cmdLog(sha) {
  const session = ensure();
  const full = git(["rev-parse", sha || "HEAD"]);
  if (!full) return;
  const short = full.slice(0, 7);
  if (session.body.includes(`\`${short}\``)) return;

  const subject = git(["log", "-1", "--pretty=%s", full]);
  const when = git(["log", "-1", "--date=format:%Y-%m-%d %H:%M", "--pretty=%ad", full]);
  const files = git(["show", "--name-only", "--pretty=format:", full])
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    // The ledger logging itself is noise in its own log.
    .filter((f) => !f.startsWith(".claude/sessions/"));

  const shown = files.slice(0, 6).join(", ");
  const more = files.length > 6 ? `, +${files.length - 6} more` : "";
  const row = `- ${when} · \`${short}\` ${subject}${files.length ? `\n  ${shown}${more}` : ""}`;

  // Insert at the end of ## Log — before ## Notes if that section exists.
  const marker = "\n## Notes";
  const at = session.body.indexOf(marker);
  session.body =
    at === -1
      ? `${session.body.replace(/\s*$/, "")}\n${row}\n`
      : `${session.body.slice(0, at).replace(/\s*$/, "")}\n${row}\n${session.body.slice(at)}`;
  save(session);
}

function cmdSet(field, value) {
  const allowed = ["goal", "next", "status"];
  if (!allowed.includes(field)) {
    console.error(`session: set takes one of ${allowed.join(", ")}`);
    process.exit(1);
  }
  const session = ensure();
  session.meta[field] = value;
  save(session);
  console.log(`${field}: ${value}`);
}

function cmdNote(text) {
  const session = ensure();
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const line = `- ${stamp} — ${text}`;
  session.body = session.body.includes("## Notes")
    ? `${session.body.replace(/\s*$/, "")}\n${line}\n`
    : `${session.body.replace(/\s*$/, "")}\n\n## Notes\n\n${line}\n`;
  save(session);
}

/** Commits on this branch that `origin/main` does not have. */
function aheadBehind() {
  const counts = git(["rev-list", "--left-right", "--count", "origin/main...HEAD"]);
  const [behind, ahead] = counts.split(/\s+/).map((n) => Number(n) || 0);
  return { ahead: ahead || 0, behind: behind || 0 };
}

function agoFrom(iso) {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * The block SessionStart prints into Claude's context.
 *
 * It answers the two questions a resumed session opens with — "what was I
 * doing here" and "what else is half-finished" — before the first prompt is
 * read, so neither depends on the owner remembering to say.
 */
function cmdBrief() {
  const branch = currentBranch();
  const session = findForBranch(branch);
  const { ahead, behind } = aheadBehind();
  const out = [];

  out.push("<session-ledger>");
  out.push(`repo: ${REPO} · branch: ${branch || "(detached HEAD)"}`);
  out.push(
    `git: ${ahead} commit(s) not on origin/main, ${behind} commit(s) on origin/main not here` +
      (behind > 0 ? ` — \`${SHIP}\` rebases before it pushes` : ""),
  );

  if (session) {
    out.push("");
    out.push(`this session: ${relative(ROOT, session.path)} (${session.meta.status})`);
    if (session.meta.goal) out.push(`  goal: ${session.meta.goal}`);
    if (session.meta.next) out.push(`  next: ${session.meta.next}`);
    out.push(`  last active: ${agoFrom(session.meta.updated)}`);
  }

  const others = readAll().filter(
    (s) => s.meta.branch !== branch && s.meta.status !== "shipped",
  );
  if (others.length) {
    out.push("");
    out.push("other work in flight:");
    for (const s of others.slice(0, 6)) {
      out.push(`  - ${s.meta.slug} (${s.meta.branch}) — ${s.meta.status}, ${agoFrom(s.meta.updated)}`);
      if (s.meta.next) out.push(`      next: ${s.meta.next}`);
    }
  }

  out.push("");
  out.push("keep it current:");
  out.push("  · commits log themselves (.githooks/post-commit) — do not hand-write log rows");
  out.push('  · before you stop: node scripts/session.mjs set next "the next concrete step"');
  out.push(`  · to ship: ${SHIP} — fetches, rebases onto origin/main, verifies, pushes to main`);
  out.push("</session-ledger>");
  return out.join("\n");
}

/**
 * The commit rows in a session's ## Log, parsed back out.
 *
 * The hook writes them, so the shape is ours and this regex is the only place
 * that has to know it:  `- <date> <time> · \`<sha>\` <subject>` followed by an
 * optional indented line of file paths.
 */
const LOG_ROW = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) · `([0-9a-f]{7})` (.*)$(?:\n {2}(.+))?/gm;

function commits(session) {
  const out = [];
  for (const m of session.body.matchAll(LOG_ROW)) {
    out.push({ date: m[1], time: m[2], sha: m[3], subject: m[4].trim(), files: (m[5] ?? "").trim() });
  }
  return out;
}

/** How many commits this session's log holds. */
function commitCount(session) {
  return commits(session).length;
}

/**
 * The ledger as JSON, for the Assistant's /changelog page.
 *
 * Committed rather than built on demand: the deployed app cannot read
 * `.claude/sessions/` (Next.js only bundles files it can trace), and `ship`
 * regenerates this right after the rebase — the same moment it regenerates
 * SESSIONS.md, and for the same reason.
 */
function renderJson() {
  return `${JSON.stringify(
    {
      generatedAt: isoNow(),
      repo: REPO,
      sessions: readAll().map((s) => ({
        slug: s.meta.slug ?? s.file.replace(/\.md$/, ""),
        file: s.file,
        branch: s.meta.branch ?? "",
        status: s.meta.status ?? "in-progress",
        started: s.meta.started ?? "",
        updated: s.meta.updated ?? "",
        goal: s.meta.goal ?? "",
        next: s.meta.next ?? "",
        commits: commits(s),
      })),
    },
    null,
    2,
  )}\n`;
}

function escapePipes(s) {
  return String(s ?? "").replace(/\|/g, "\\|");
}

function truncate(s, n) {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * The board: every session in one table, grouped by state.
 *
 * Generated, never hand-edited — which is what lets it be committed at all.
 * `ship` regenerates it AFTER rebasing onto origin/main, so the version being
 * pushed is always the union of every session file on main plus this one.
 */
function renderBoard() {
  const all = readAll();
  const open = all.filter((s) => s.meta.status === "in-progress");
  const parked = all.filter((s) => s.meta.status === "parked");
  const shipped = all.filter((s) => s.meta.status === "shipped").slice(0, 15);

  const lines = [];
  lines.push(`# SESSIONS — ${REPO}`);
  lines.push("");
  lines.push(
    "What each Claude session was doing, and where it stopped. **Generated —",
    "do not hand-edit.** Run `node scripts/session.mjs board --write`, or let",
    "`ship` do it. The record for one session is its own file under",
    "`.claude/sessions/`; this page is only the index over them.",
  );
  lines.push("");

  const table = (rows, cols) => {
    lines.push(`| ${cols.join(" | ")} |`);
    lines.push(`|${cols.map(() => "---").join("|")}|`);
    for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
    lines.push("");
  };

  lines.push("## In flight");
  lines.push("");
  if (open.length === 0) {
    lines.push("_Nothing open._");
    lines.push("");
  } else {
    table(
      open.map((s) => [
        `[${escapePipes(s.meta.slug)}](.claude/sessions/${s.file})`,
        `\`${escapePipes(s.meta.branch)}\``,
        escapePipes(agoFrom(s.meta.updated)),
        String(commitCount(s)),
        escapePipes(truncate(s.meta.next || s.meta.goal, 80)) || "—",
      ]),
      ["Session", "Branch", "Last active", "Commits", "Next step"],
    );
  }

  if (parked.length) {
    lines.push("## Parked");
    lines.push("");
    table(
      parked.map((s) => [
        `[${escapePipes(s.meta.slug)}](.claude/sessions/${s.file})`,
        `\`${escapePipes(s.meta.branch)}\``,
        escapePipes(agoFrom(s.meta.updated)),
        escapePipes(truncate(s.meta.next || s.meta.goal, 80)) || "—",
      ]),
      ["Session", "Branch", "Parked", "Picks up at"],
    );
  }

  lines.push("## Shipped");
  lines.push("");
  if (shipped.length === 0) {
    lines.push("_Nothing shipped yet._");
    lines.push("");
  } else {
    table(
      shipped.map((s) => [
        `[${escapePipes(s.meta.slug)}](.claude/sessions/${s.file})`,
        escapePipes(String(s.meta.updated ?? "").slice(0, 10)),
        String(commitCount(s)),
        escapePipes(truncate(s.meta.goal, 80)) || "—",
      ]),
      ["Session", "Shipped", "Commits", "What it did"],
    );
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

// ── entry point ─────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "start": {
    const gi = rest.indexOf("--goal");
    const goal = gi === -1 ? undefined : rest.slice(gi + 1).join(" ");
    const s = ensure(goal);
    console.log(relative(ROOT, s.path));
    break;
  }
  case "path": {
    const s = findForBranch(currentBranch());
    if (!s) process.exit(1);
    console.log(relative(ROOT, s.path));
    break;
  }
  case "log":
    cmdLog(rest[0]);
    break;
  case "set":
    cmdSet(rest[0], rest.slice(1).join(" "));
    break;
  case "note":
    cmdNote(rest.join(" "));
    break;
  case "touch": {
    const s = findForBranch(currentBranch());
    if (s) save(s);
    break;
  }
  // Exit 0 = this session has landed work but never said where it stops.
  // The Stop hook asks about that once; every other exit means stay quiet.
  case "needs-next": {
    const s = findForBranch(currentBranch());
    const wanted = !!s && !s.meta.next && s.meta.status === "in-progress" && commitCount(s) > 0;
    process.exit(wanted ? 0 : 1);
    break;
  }
  case "brief":
    console.log(cmdBrief());
    break;
  case "board": {
    const md = renderBoard();
    if (rest.includes("--write")) {
      writeFileSync(BOARD_PATH, md);
      console.log(relative(ROOT, BOARD_PATH));
      // Only where there is an app to read it.
      if (existsSync(join(ROOT, "src", "lib"))) {
        writeFileSync(JSON_PATH, renderJson());
        console.log(relative(ROOT, JSON_PATH));
      }
    } else {
      process.stdout.write(md);
    }
    break;
  }
  default:
    console.log(
      [
        "session — the per-session ledger",
        "",
        "  start [--goal ...]   create this branch's session file",
        "  path                 print its path",
        "  log [sha]            append a commit row (post-commit hook)",
        "  set <goal|next|status> <value>",
        "  note <text>          append a line under ## Notes",
        "  touch                stamp `updated`",
        "  brief                the SessionStart context block",
        "  board [--write]      the index over every session → SESSIONS.md",
      ].join("\n"),
    );
    if (cmd) process.exit(1);
}
