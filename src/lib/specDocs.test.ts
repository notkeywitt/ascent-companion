import { describe, expect, it } from "vitest";
import { findSnippets, pageText, scanText } from "./specDocs";

const TEXT = [
  "[Page 1]",
  "Finish Schedule",
  "Guest Bath",
  "Floor tile: Fireclay 2x8 Calacatta",
  "Grout: Mapei 09 Avalanche",
  "",
  "[Page 2]",
  "Kitchen",
  "Faucet: Waterstone 5100",
  "",
  "[Page 10]",
  "Tile layout notes",
  "",
  "[Links]",
  "Fireclay 2x8 — https://fireclaytile.com/x",
].join("\n");

describe("pageText", () => {
  it("returns one page, not its neighbours", () => {
    expect(pageText(TEXT, 2)).toBe("Kitchen\nFaucet: Waterstone 5100");
    expect(pageText(TEXT, 1)).toContain("Grout: Mapei");
    expect(pageText(TEXT, 1)).not.toContain("Kitchen");
    expect(pageText(TEXT, 10)).toBe("Tile layout notes");
    expect(pageText(TEXT, 3)).toBe("");
  });
});

describe("findSnippets", () => {
  it("finds lines with any word and their page, links as page 0", () => {
    const { hits, snippets } = findSnippets(TEXT, ["fireclay", "faucet"]);
    expect(hits).toBe(3);
    expect(snippets.map((s) => s.page)).toEqual([1, 2, 0]);
    expect(snippets[0].text).toBe("Guest Bath | Floor tile: Fireclay 2x8 Calacatta | Grout: Mapei 09 Avalanche");
    expect(snippets[2].text).toContain("https://fireclaytile.com/x");
  });

  it("caps snippets but counts every hit", () => {
    const { hits, snippets } = findSnippets(TEXT, ["tile"], 1);
    expect(hits).toBe(3);
    expect(snippets).toHaveLength(1);
  });
});

describe("scanText", () => {
  it("puts OCR pages in the text layer's shape, so pageText finds each one", () => {
    const text = scanText(["  Tile: Fireclay 3x12 \n\n Ocean ", "", "A-201 | Primary bath"]);
    expect(pageText(text, 1)).toBe("Tile: Fireclay 3x12\nOcean");
    expect(pageText(text, 2)).toBe("");
    expect(pageText(text, 3)).toBe("A-201 | Primary bath");
    expect(findSnippets(text, ["ocean"]).snippets[0].page).toBe(1);
  });
});
