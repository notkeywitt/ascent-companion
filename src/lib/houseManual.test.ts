import { describe, expect, it } from "vitest";
import { asManual, draftManual, manualHtml, type HouseManual } from "@/lib/houseManual";
import type { SpecList, SpecRow } from "@/lib/specList";

const row = (over: Partial<SpecRow>): SpecRow => ({
  room: "Kitchen", item: "", qty: "", spec: "", specLinks: [], alternates: [], notes: "", question: "",
  impact: "", answer: "", addedBy: "", tag: "", revised: "", other: [], status: "decided", ...over,
});

describe("draftManual", () => {
  it("groups spec rows by room and skips rows with no spec", () => {
    const specs: SpecList = {
      title: "", revision: "", unplaced: [],
      rows: [
        row({ item: "Range", spec: "Bosch 800", specLinks: [{ url: "https://bosch.com/r", text: "" }] }),
        row({ item: "Hood" }),
        row({ room: "Bath", item: "Tile", spec: "Daltile" }),
      ],
    };
    const m = draftManual("Cherry Tree", specs, [{ group: "X", name: "ignored", description: "" }]);
    expect(m.title).toBe("Cherry Tree");
    expect(m.sections).toEqual([
      { title: "Kitchen", items: [{ label: "Range", value: "Bosch 800", url: "https://bosch.com/r" }] },
      { title: "Bath", items: [{ label: "Tile", value: "Daltile", url: "" }] },
    ]);
  });

  it("falls back to JobTread specifications when no list was imported", () => {
    const m = draftManual("J", null, [{ group: "Appliances", name: "Dishwasher", description: " Bosch 500 " }]);
    expect(m.sections).toEqual([{ title: "Appliances", items: [{ label: "Dishwasher", value: "Bosch 500", url: "" }] }]);
  });
});

describe("manualHtml", () => {
  const m: HouseManual = {
    title: "Cherry <Tree>",
    intro: "",
    contacts: [
      { trade: "HVAC", name: "Barron", phone: "360 685-9618", email: "", url: "barronheating.com" },
      { trade: "Empty", name: " ", phone: "", email: "", url: "" },
    ],
    sections: [
      { title: "Appliances", items: [{ label: "Range", value: "Bosch", url: "javascript:alert(1)" }] },
      { title: "Empty", items: [] },
    ],
    links: [{ text: "Pre-cover photos", url: "https://photos.example.com/x" }],
  };
  const html = manualHtml(m);

  it("escapes text and drops unsafe links", () => {
    expect(html).toContain("<h2>Cherry &lt;Tree&gt;</h2>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<dd>Bosch</dd>");
  });

  it("links phones and bare domains, and leaves out empty rows and sections", () => {
    expect(html).toContain('href="tel:3606859618"');
    expect(html).toContain('href="https://barronheating.com"');
    expect(html).not.toContain("<dt>Empty</dt>");
    expect(html).not.toContain("<summary>Empty</summary>");
    expect(html).toContain("Pre-cover photos</a>");
  });
});

describe("asManual", () => {
  it("drops malformed fields", () => {
    expect(asManual({ title: 5, contacts: [{ name: "A", vendorId: "" }, null], sections: "x" })).toEqual({
      title: "", intro: "", contacts: [{ trade: "", name: "A", phone: "", email: "", url: "" }], sections: [], links: [],
    });
    expect(asManual(null)).toBeNull();
  });
});
