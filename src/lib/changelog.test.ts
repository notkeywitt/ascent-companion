import { describe, expect, it } from "vitest";

import { mergeEntries, parseLog, plainFrom } from "./changelog.mjs";
import log from "@/data/changelog.json";

const rec = (sha: string, subject: string, body = "") =>
  `${sha}\x1f2026-11-20T06:00:00-08:00\x1f${subject}\x1f${body}\x1e\n`;

describe("parseLog", () => {
  const text =
    rec("aaaaaaaaaaaa", "companion: add jobs budget view", "Change-log: The Jobs page shows the budget.\n\nCo-Authored-By: x") +
    rec("bbbbbbbbbbbb", "companion: land agent-123") +
    rec("cccccccccccc", "lander: update change log") +
    rec("dddddddddddd", "companion: fix the menu");

  it("drops lander commits and strips the prefix", () => {
    expect(parseLog(text)).toEqual([
      { sha: "aaaaaaaa", date: "2026-11-20T06:00:00-08:00", title: "add jobs budget view", plain: "The Jobs page shows the budget." },
      { sha: "dddddddd", date: "2026-11-20T06:00:00-08:00", title: "fix the menu", plain: "fix the menu" },
    ]);
  });

  it("reads an empty log as no entries", () => {
    expect(parseLog("")).toEqual([]);
  });
});

describe("plainFrom", () => {
  it("falls back to the title", () => {
    expect(plainFrom("Co-Authored-By: x", "t")).toBe("t");
    expect(plainFrom("change-log:  Done. ", "t")).toBe("Done.");
  });
});

describe("mergeEntries", () => {
  it("is idempotent", () => {
    const old = [{ sha: "a", date: "", title: "", plain: "" }];
    const once = mergeEntries(old, [{ sha: "b", date: "", title: "", plain: "" }, ...old]);
    expect(once.map((e) => e.sha)).toEqual(["b", "a"]);
    expect(mergeEntries(once, once)).toEqual(once);
  });
});

describe("src/data/changelog.json", () => {
  it("has one entry per sha, every field set", () => {
    expect(new Set(log.map((e) => e.sha)).size).toBe(log.length);
    for (const e of log) expect(e.sha && e.date && e.title && e.plain).toBeTruthy();
  });
});
