#!/usr/bin/env node
/**
 * Keep CODEBASE_MAP.md honest — a DRIFT CHECK, not a regenerator.
 *
 * The maps carry hand-written one-line descriptions that a machine can't
 * reproduce, so this script never rewrites them (same rule as
 * gen-billing-vectors.mjs: it can't clobber prose it can't author). Instead it
 * walks both repos' source trees and flags the staleness that actually bites a
 * new session:
 *
 *   • a source file / route / table exists on disk but is NOT named in the map
 *     ("undocumented" — the map has fallen behind the tree), and
 *   • the map names a lib/.js file that no longer exists ("stale" — a rename or
 *     delete left a dangling row).
 *
 * When either shows up, the fix is a human edit to CODEBASE_MAP.md: add the row
 * with a real description, or drop the dead one. This script just tells you where.
 *
 *   node scripts/check-codebase-map.mjs [path-to-ascent-appscript]
 *   npm run check:map
 *
 * Exit 0 = both maps cover the tree. Exit 1 = drift found (usable in CI or a
 * pre-commit hook). The appscript half is skipped (not failed) if its repo
 * isn't found alongside this one.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const companionRoot = resolve(here, "..");
const appscriptRoot = resolve(process.argv[2] ?? resolve(here, "../../ascent-appscript"));

let drift = 0;

/** Files whose basename appears verbatim (as a substring) in `haystack`. */
function report(label, expected, haystack) {
  const missing = expected.filter((token) => !haystack.includes(token));
  if (missing.length === 0) {
    console.log(`  ok   ${label} (${expected.length})`);
  } else {
    drift += missing.length;
    console.log(`  DRIFT ${label}: ${missing.length} not in map`);
    for (const m of missing) console.log(`         + ${m}`);
  }
}

/** List files under `dir` (recursive), returning paths relative to `dir`. */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => resolve(e.parentPath ?? e.path, e.name).slice(dir.length + 1));
}

// ── ascent-companion ────────────────────────────────────────────────────────
function checkCompanion() {
  const mapPath = resolve(companionRoot, "CODEBASE_MAP.md");
  console.log("ascent-companion / CODEBASE_MAP.md");
  if (!existsSync(mapPath)) {
    console.log("  DRIFT map file is missing");
    drift += 1;
    return;
  }
  const map = readFileSync(mapPath, "utf8");
  const src = resolve(companionRoot, "src");

  // lib modules — 1:1 table rows (skip tests and non-code fixtures)
  const lib = listFiles(resolve(src, "lib"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.split("/").pop());
  report("src/lib modules", lib, map);

  // reverse: a `foo.ts`/`foo.tsx` named in the map whose file no longer exists
  // anywhere under src/ (catches a rename/delete that left a dangling row)
  const srcBasenames = new Set(listFiles(src).map((f) => f.split("/").pop()));
  const staleTs = [...map.matchAll(/`([A-Za-z][\w-]*\.tsx?)`/g)]
    .map((m) => m[1])
    .filter((name, i, a) => a.indexOf(name) === i)
    .filter((name) => !srcBasenames.has(name));
  if (staleTs.length) {
    drift += staleTs.length;
    console.log(`  DRIFT map rows point at missing files:`);
    for (const s of staleTs) console.log(`         - ${s}`);
  }

  // components — listed by name
  const components = listFiles(resolve(src, "components"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, "").split("/").pop());
  report("src/components", components, map);

  // top-level page routes (first segment under src/app that owns a page.tsx),
  // excluding api and dynamic [segments]
  const appFiles = listFiles(resolve(src, "app"));
  const pageRoutes = [
    ...new Set(
      appFiles
        .filter((f) => f.endsWith("page.tsx") && !f.startsWith("api/"))
        .map((f) => f.split("/")[0])
        .filter((seg) => seg !== "page.tsx" && !seg.startsWith("[")),
    ),
  ];
  report("app page routes", pageRoutes, map);

  // top-level api route domains (first segment under src/app/api)
  const apiRoutes = [
    ...new Set(
      appFiles
        .filter((f) => f.startsWith("api/") && f.endsWith("route.ts"))
        .map((f) => f.split("/")[1])
        .filter((seg) => seg && !seg.startsWith("[")),
    ),
  ];
  report("api route domains", apiRoutes, map);

  // db tables
  const schema = existsSync(resolve(src, "db/schema.ts"))
    ? readFileSync(resolve(src, "db/schema.ts"), "utf8")
    : "";
  const tables = [...schema.matchAll(/sqliteTable\(\s*"([A-Za-z_]+)"/g)].map((m) => m[1]);
  report("db tables", tables, map);
}

// ── ascent-appscript ────────────────────────────────────────────────────────
function checkAppscript() {
  console.log("\nascent-appscript / CODEBASE_MAP.md");
  if (!existsSync(appscriptRoot)) {
    console.log(`  skip  repo not found at ${appscriptRoot} (pass its path as arg 1)`);
    return;
  }
  const mapPath = resolve(appscriptRoot, "CODEBASE_MAP.md");
  if (!existsSync(mapPath)) {
    console.log("  DRIFT map file is missing");
    drift += 1;
    return;
  }
  const map = readFileSync(mapPath, "utf8");

  // every .js file should be named in the map
  const jsFiles = readdirSync(appscriptRoot)
    .filter((f) => f.endsWith(".js"))
    .sort();
  report(".js files", jsFiles, map);

  // reverse: a `Foo.js` named in the map that no longer exists
  const staleJs = [...map.matchAll(/`([A-Za-z][\w]*\.js)`/g)]
    .map((m) => m[1])
    .filter((name, i, a) => a.indexOf(name) === i)
    .filter((name) => !existsSync(resolve(appscriptRoot, name)));
  if (staleJs.length) {
    drift += staleJs.length;
    console.log(`  DRIFT map rows point at missing files:`);
    for (const s of staleJs) console.log(`         - ${s}`);
  }
}

checkCompanion();
checkAppscript();

console.log("");
if (drift === 0) {
  console.log("✓ CODEBASE_MAP.md covers the tree in both repos.");
  process.exit(0);
} else {
  console.log(
    `✗ ${drift} item(s) drifted. Add the new entries to CODEBASE_MAP.md (with a\n` +
      `  one-line description), or remove rows for files that are gone. This script\n` +
      `  never edits the map itself — the descriptions are yours to write.`,
  );
  process.exit(1);
}
