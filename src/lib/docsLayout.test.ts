import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeps the docs from piling up (CLAUDE.md, "Docs — where a new one goes").
 *
 * - The repo root holds a fixed set of docs. A new one belongs in the doc that
 *   owns its topic, or in docs/plans/ if it is a plan. To add a root doc on
 *   purpose, add it to ROOT_DOCS here.
 * - Every plan in docs/plans/ carries a status line under its title, so a
 *   finished plan is visible and can be deleted.
 */
const repo = join(__dirname, "..", "..");

const ROOT_DOCS = [
  "ARCHITECTURE_REVIEW.md",
  "CLAUDE.md",
  "CODEBASE_MAP.md",
  "DEPLOY.md",
  "FRONTEND_ARCHITECTURE.md",
  "HANDOFF.md",
  "JT_API_REFERENCE.md",
  "PAVE_GOTCHAS.md",
  "README.md",
  "THEME.md",
  "USER_MANUAL.md",
];

const STATUS = /^Status: (draft|agreed|in progress|done) [—-] \d{4}-\d{2}-\d{2}\b/;

describe("docs layout", () => {
  it("adds no new .md file at the repo root", () => {
    const found = readdirSync(repo).filter((f) => f.endsWith(".md")).sort();
    expect(found.filter((f) => !ROOT_DOCS.includes(f))).toEqual([]);
  });

  it("gives every plan in docs/plans/ a status line under its title", () => {
    const dir = join(repo, "docs", "plans");
    const missing = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => {
        const head = readFileSync(join(dir, f), "utf8").split("\n").slice(0, 6);
        return !head.some((line) => STATUS.test(line));
      });
    expect(missing).toEqual([]);
  });
});
