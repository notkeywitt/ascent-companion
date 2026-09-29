import { describe, expect, it } from "vitest";
import { groupByRoom, resolveSpecList, type RawSpecRow } from "@/lib/specList";

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
