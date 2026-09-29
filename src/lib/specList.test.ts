import { describe, expect, it } from "vitest";
import {
  SPEC_HEADING,
  groupByRoom,
  mergeSpecEntry,
  resolveSpecList,
  suggestBudgetLine,
  type RawSpecRow,
  type SpecRow,
} from "@/lib/specList";

const links = [
  { id: "L1", url: "https://www.urbanfloor.com/product/signature-absolute/", text: "Urban Floor, Signature Absolute", context: "001 Studio Floor", page: 1 },
  { id: "L2", url: "https://broan-nutone.com/509s", text: "Broan-NuTone, 200 CFM", context: "Through Wall Vent", page: 1 },
  { id: "L3", url: "https://example.com/never-used", text: "Loose link", context: "", page: 1 },
];

const row = (over: Partial<RawSpecRow>): RawSpecRow => ({
  room: "001 Studio", item: "Floor", qty: "", spec: "", specLinks: [], alternates: [], notes: "",
  question: "", impact: "", answer: "", addedBy: "", tag: "", revised: "", other: [], status: "decided",
  ...over,
});

describe("resolveSpecList", () => {
  it("turns link ids into links and drops ids the PDF never had", () => {
    const list = resolveSpecList(
      {
        title: "Channel RD Studio",
        revision: "26.09.11",
        rows: [
          row({ spec: "Urban Floor, Signature Absolute", specLinks: ["L1", "L9", "https://evil.example"] }),
          row({ room: "002 Hall", spec: "Urban Floor, Signature Absolute", specLinks: ["L1"] }),
          row({ item: "Through Wall Vent", spec: "BeamBox", alternates: [{ text: "Broan-NuTone", links: ["L2"] }], status: "open" }),
        ],
      },
      links,
    );
    expect(list.rows[0].specLinks).toEqual([{ url: links[0].url, text: links[0].text }]);
    // One link may serve several rows.
    expect(list.rows[1].specLinks[0].url).toBe(links[0].url);
    expect(list.rows[2].alternates[0].links[0].url).toBe(links[1].url);
    expect(list.rows[2].status).toBe("open");
    // A link no row claimed is kept, not lost.
    expect(list.unplaced).toEqual([{ url: links[2].url, text: "Loose link" }]);
  });

  it("drops empty rows and defaults an unknown status to open", () => {
    const list = resolveSpecList(
      { title: "", revision: "", rows: [row({ item: "", spec: "" }), row({ status: "maybe" as never })] },
      [],
    );
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].status).toBe("open");
  });

  it("groups consecutive rows by room, keeping each row's index", () => {
    const list = resolveSpecList(
      { title: "", revision: "", rows: [row({}), row({ item: "Walls" }), row({ room: "003 Bath" })] },
      [],
    );
    const groups = groupByRoom(list.rows);
    expect(groups.map((g) => g.room)).toEqual(["001 Studio", "003 Bath"]);
    expect(groups[1].rows[0].index).toBe(2);
  });
});

const spec = (over: Partial<SpecRow>): SpecRow => ({
  ...resolveSpecList({ title: "", revision: "", rows: [row({ spec: "x" })] }, []).rows[0],
  ...over,
});

describe("mergeSpecEntry", () => {
  const floor = spec({
    room: "001 Studio",
    item: "Floor",
    spec: "Urban Floor, Signature Absolute",
    specLinks: [{ url: "https://www.urbanfloor.com/p", text: "" }],
  });

  it("adds the entry under the heading and keeps the estimator's note", () => {
    const out = mergeSpecEntry("9/1/26 estimate from Montello", floor);
    expect(out).toBe(
      `9/1/26 estimate from Montello\n\n${SPEC_HEADING}\n001 Studio · Floor: Urban Floor, Signature Absolute\nhttps://www.urbanfloor.com/p`,
    );
  });

  it("replaces a row's own entry on a second save and keeps the others", () => {
    const hall = spec({ room: "002 Hall", item: "Floor", spec: "Urban Floor", alternates: [{ text: "Oak: wide", links: [] }], question: "Stain?" });
    let d = mergeSpecEntry(null, floor);
    d = mergeSpecEntry(d, hall);
    d = mergeSpecEntry(d, { ...floor, spec: "Urban Floor, Signature Absolute (revised)" });
    expect(d.split(SPEC_HEADING)).toHaveLength(2);
    expect(d).toContain("001 Studio · Floor: Urban Floor, Signature Absolute (revised)");
    expect(d).not.toContain("Absolute\nhttps://www.urbanfloor.com/p\n002");
    expect(d).toContain("002 Hall · Floor: Urban Floor\nAlternate: Oak: wide\nQuestion: Stain?");
    expect(d.indexOf("001 Studio")).toBeLessThan(d.indexOf("002 Hall"));
  });
});

describe("suggestBudgetLine", () => {
  const lines = [
    { id: "a", name: "09 64 00 Wood Flooring", group: "Finishes", isSpecification: true },
    { id: "b", name: "09 65 19 Tile Flooring", group: "Finishes", isSpecification: true },
    { id: "c", name: "12 30 00 Casework", group: "Furnishings", isSpecification: true },
    { id: "d", name: "22 20 00 Plumbing Trim-out - Materials", group: "Plumbing", isSpecification: true },
  ];
  it("matches on shared word stems", () => {
    expect(suggestBudgetLine(spec({ item: "Floor", spec: "Urban Floor, Signature Absolute" }), lines)).toBe("a");
    expect(suggestBudgetLine(spec({ item: "Floor", spec: "Daltile, 24x24 tile" }), lines)).toBe("b");
  });
  it("keeps the line a row was saved to, and gives up when nothing is close", () => {
    expect(suggestBudgetLine(spec({ item: "Floor", jt: { costItemId: "c", line: "", savedAt: "" } }), lines)).toBe("c");
    expect(suggestBudgetLine(spec({ item: "Refrigerator", spec: "Monogram 24" }), lines)).toBe("");
  });
});
