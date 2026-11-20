#!/usr/bin/env node
// Add the commits on HEAD that src/data/changelog.json does not have yet.
// The lander runs it just before it pushes main (scripts/land.sh), because it
// has full history; Vercel's clone is shallow. Re-running adds nothing.
// An empty log starts from the last 14 days.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { LOG_FORMAT, mergeEntries, parseLog } from "../../src/lib/changelog.mjs";

const FILE = "src/data/changelog.json";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20 });

let existing = [];
try {
  existing = JSON.parse(readFileSync(FILE, "utf8"));
} catch {
  // no file yet: start one
}

const last = existing[0]?.sha;
const range = last ? [`${last}..HEAD`] : ["--since=14 days ago", "HEAD"];
const fresh = parseLog(git("log", "--no-merges", `--format=${LOG_FORMAT}`, ...range));
const merged = mergeEntries(existing, fresh);

if (merged.length !== existing.length) {
  writeFileSync(FILE, JSON.stringify(merged, null, 1) + "\n");
}
console.log(`changelog: ${merged.length - existing.length} new`);
