#!/usr/bin/env node
/**
 * The code ratchet — counts that may only go down.
 *
 * Each metric below is a habit the codebase is trying to leave behind (see the
 * Stage 8 checklist in ARCHITECTURE_REVIEW.md). The counts per file are stored
 * in src/lib/codeRatchet.baseline.json. `src/lib/codeRatchet.test.ts` fails when
 * a count goes UP in any file, and when a count goes DOWN without the baseline
 * being lowered to match — so an improvement is locked in, never lost.
 *
 *   node scripts/code-ratchet.mjs            print the totals and what changed
 *   npm run ratchet                          lower the baseline to today's counts
 *
 * `npm run ratchet` refuses when any metric's TOTAL went up. A moved or renamed
 * file keeps its total, so it passes. To raise a count on purpose, edit the
 * baseline JSON by hand, so the reviewer sees it in the diff.
 *
 * Counting uses the TypeScript parser, so comments and strings never count as
 * code. Test files (*.test.ts) are not measured.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const BASELINE_PATH = join(ROOT, "src", "lib", "codeRatchet.baseline.json");

/** Lines above which a file counts as too large to change safely. */
export const BIG_FILE_LINES = 1500;

/** The shared controls themselves may use a raw <button> or <input>. */
const PRIMITIVES = new Set(["src/components/ui.tsx", "src/components/FileDrop.tsx"]);

/** Names a hand-rolled money formatter goes by. The real one is src/lib/money.ts. */
const MONEY_NAMES = new Set(["money", "money0", "usd", "dollars", "fmtMoney", "formatMoney", "fmtUsd", "fmtDollars"]);

/** What each metric counts, as the test prints it. */
export const METRICS = {
  any: "`any` types — type the value instead",
  rawButton: "raw <button> — use Button from ui.tsx",
  rawInput: "raw <input> — use Input, Checkbox or FileDrop from ui.tsx",
  processEnv: "process.env read outside src/lib/config.ts (NEXT_PUBLIC_* and NODE_ENV excepted)",
  localMoney: "a local money formatter — import money / money0 from src/lib/money.ts",
  tintedBox: "a hand-tinted warning box (bg-amber-50, bg-red-50, …) — use Notice or Banner",
  darkBorderNeutral600: "dark:border-neutral-600 — use border-line-strong",
  bigFile: `a file over ${BIG_FILE_LINES} lines — split it, do not add a new one`,
};

const TINTED = /\bbg-(?:amber|red|yellow|orange|rose)-(?:50|100)\b/g;
const DARK_BORDER_600 = /\bdark:border-neutral-600\b/g;

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const isFunctionValue = (node) =>
  !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

function isProcessEnv(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "env" &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process"
  );
}

/** The env name read off `process.env`, or "" when it is not a plain name. */
function envName(node) {
  const parent = node.parent;
  if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) return parent.name.text;
  if (parent && ts.isElementAccessExpression(parent) && ts.isStringLiteral(parent.argumentExpression)) {
    return parent.argumentExpression.text;
  }
  return "";
}

/** Counts for one file's text. `file` is the repo-relative path with forward slashes. */
export function measureText(file, text) {
  const counts = Object.fromEntries(Object.keys(METRICS).map((k) => [k, 0]));
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const primitive = PRIMITIVES.has(file);

  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) counts.any++;

    if (!primitive && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) {
      if (node.tagName.text === "button") counts.rawButton++;
      if (node.tagName.text === "input") counts.rawInput++;
    }

    if (file !== "src/lib/config.ts" && isProcessEnv(node)) {
      const name = envName(node);
      if (!name.startsWith("NEXT_PUBLIC_") && name !== "NODE_ENV") counts.processEnv++;
    }

    if (file !== "src/lib/money.ts") {
      if (ts.isFunctionDeclaration(node) && node.name && MONEY_NAMES.has(node.name.text)) counts.localMoney++;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && MONEY_NAMES.has(node.name.text) && isFunctionValue(node.initializer)) {
        counts.localMoney++;
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  counts.tintedBox = (text.match(TINTED) ?? []).length;
  counts.darkBorderNeutral600 = (text.match(DARK_BORDER_600) ?? []).length;
  counts.bigFile = text.split("\n").length > BIG_FILE_LINES ? 1 : 0;
  return counts;
}

/** Today's counts: { metric: { file: count } }, files with a zero count left out. */
export function measure() {
  const result = Object.fromEntries(Object.keys(METRICS).map((k) => [k, {}]));
  for (const path of sourceFiles(join(ROOT, "src")).sort()) {
    const file = relative(ROOT, path).split(sep).join("/");
    const counts = measureText(file, readFileSync(path, "utf8"));
    for (const [metric, n] of Object.entries(counts)) if (n > 0) result[metric][file] = n;
  }
  return result;
}

export function readBaseline() {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

export const total = (byFile = {}) => Object.values(byFile).reduce((a, b) => a + b, 0);

/** Every file whose count moved, per metric: rises and falls kept apart. */
export function compare(baseline, current) {
  const rises = [];
  const falls = [];
  for (const metric of Object.keys(METRICS)) {
    const was = baseline[metric] ?? {};
    const now = current[metric] ?? {};
    for (const file of new Set([...Object.keys(was), ...Object.keys(now)])) {
      const a = was[file] ?? 0;
      const b = now[file] ?? 0;
      if (b > a) rises.push({ metric, file, was: a, now: b });
      if (b < a) falls.push({ metric, file, was: a, now: b });
    }
  }
  return { rises, falls };
}

function main() {
  const update = process.argv.includes("--update");
  const current = measure();
  let baseline = null;
  try {
    baseline = readBaseline();
  } catch {
    baseline = null;
  }

  for (const metric of Object.keys(METRICS)) {
    const was = baseline ? total(baseline[metric]) : null;
    const now = total(current[metric]);
    console.log(`${metric.padEnd(22)} ${String(now).padStart(5)}${was === null || was === now ? "" : `  (baseline ${was})`}`);
  }
  if (!update) return;

  if (baseline) {
    const up = Object.keys(METRICS).filter((m) => total(current[m]) > total(baseline[m]));
    if (up.length) {
      console.error(`\nratchet: not updated — these totals went UP: ${up.join(", ")}.`);
      console.error("Fix the new ones (npm test names the files), or raise the baseline by hand in the diff.");
      process.exit(1);
    }
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  console.log(`\nratchet: baseline written — stage ${relative(ROOT, BASELINE_PATH)} with your change.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
