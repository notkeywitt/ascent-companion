import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { inlineParts, isAmount, isSignOff, parseSummary, parseSummaryFile } from "./weeklySummary";
import { readSummaries } from "./weeklySummaryFiles";

const SAMPLE = `<!-- gmail-draft-id: r1 -->
<!-- doc: https://docs.google.com/document/d/abc/edit -->
# Week of Nov 16 – Nov 21, 2026

### Needs you
| Who | Item |
|---|---|
| Casey | **Topic:** one line. |

### Billing
> 143 bills · $65,267.21 total
- **Label:** a bullet
- second

-Keillor
`;

describe("parseSummary", () => {
  const s = parseSummary(SAMPLE);

  it("reads the title and the Doc link, and drops comments", () => {
    expect(s.title).toBe("Week of Nov 16 – Nov 21, 2026");
    expect(s.docUrl).toBe("https://docs.google.com/document/d/abc/edit");
    expect(s.blocks.some((b) => b.t === "p" && b.s.includes("<!--"))).toBe(false);
  });

  it("makes a table with its header and no divider row", () => {
    expect(s.blocks[1]).toEqual({
      t: "table",
      head: ["Who", "Item"],
      rows: [["Casey", "**Topic:** one line."]],
    });
  });

  it("groups bullets, keeps the callout, and leaves the sign-off as a paragraph", () => {
    expect(s.blocks.map((b) => b.t)).toEqual(["h", "table", "h", "callout", "ul", "p"]);
    const ul = s.blocks[4];
    expect(ul.t === "ul" && ul.items).toEqual(["**Label:** a bullet", "second"]);
  });

  it("shows only a Google Docs https link", () => {
    expect(parseSummary("<!-- doc: https://evil.example/x -->\n# T").docUrl).toBeNull();
    expect(parseSummary("<!-- doc: javascript:alert(1) -->\n# T").docUrl).toBeNull();
  });
});

describe("small helpers", () => {
  it("splits bold from plain text", () => {
    expect(inlineParts("**A:** b **c**")).toEqual([
      { bold: true, text: "A:" },
      { bold: false, text: " b " },
      { bold: true, text: "c" },
    ]);
  });
  it("spots an amount and a sign-off", () => {
    expect(isAmount("$12,466.00")).toBe(true);
    expect(isAmount("Draft. $5")).toBe(false);
    expect(isSignOff("-Keillor")).toBe(true);
    expect(isSignOff("- a bullet")).toBe(false);
  });
  it("reads a file name", () => {
    expect(parseSummaryFile("2026-11-21-claude.md")).toEqual({ weekEnd: "2026-11-21", kind: "claude" });
    expect(parseSummaryFile("2026-11-21-final.md")?.kind).toBe("final");
    expect(parseSummaryFile("notes.md")).toBeNull();
  });
});

describe("readSummaries", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "weekly-"));
  writeFileSync(path.join(dir, "2026-11-07-claude.md"), "<!-- doc: https://docs.google.com/document/d/old/edit -->\n# Old draft");
  writeFileSync(path.join(dir, "2026-11-07-final.md"), "# Old final");
  writeFileSync(path.join(dir, "2026-11-21-claude.md"), "# New draft");
  writeFileSync(path.join(dir, "readme.txt"), "ignore me");

  it("lists newest week first, one record per week, preferring the final", () => {
    const list = readSummaries(dir);
    expect(list.map((r) => [r.weekEnd, r.kind, r.title])).toEqual([
      ["2026-11-21", "claude", "New draft"],
      ["2026-11-07", "final", "Old final"],
    ]);
  });

  it("keeps the draft's Doc link when the final has none", () => {
    expect(readSummaries(dir)[1].docUrl).toBe("https://docs.google.com/document/d/old/edit");
  });

  it("returns an empty list when the folder is missing", () => {
    expect(readSummaries(path.join(dir, "nope"))).toEqual([]);
  });
});
