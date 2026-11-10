import { describe, expect, it } from "vitest";

import { parseInline, parseReport } from "./reportMarkdown";

describe("parseReport", () => {
  it("reads headings, bullets, tables and paragraphs", () => {
    const b = parseReport(
      "## October\n\nFirst line\nsecond line\n\n- one\n- **two**\n\n| Code | Sheet |\n|---|---|\n| 01 51 10 | $300.00 |",
    );
    expect(b.map((x) => x.kind)).toEqual(["heading", "para", "list", "table"]);
    expect(b[1]).toEqual({ kind: "para", content: [{ kind: "text", text: "First line second line" }] });
    const t = b[3];
    expect(t.kind === "table" && t.rows.length).toBe(1);
  });

  it("links only http(s) and app paths", () => {
    expect(parseInline("[x](javascript:alert(1))")[0].kind).toBe("text");
    expect(parseInline("[page](/invoice-review?ym=2026-10)")[0]).toEqual({
      kind: "link",
      text: "page",
      href: "/invoice-review?ym=2026-10",
    });
    expect(parseInline("see https://a.b/c")[1].kind).toBe("link");
  });
});
