import { describe, expect, it } from "vitest";
import { asManual, draftManual, driveIdFromLink, manualHtml, mergeSections, type HouseManual } from "@/lib/houseManual";
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
    sources: [{ id: "abc", name: "Spec Selections", url: "https://drive.google.com/x", isFolder: true }],
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

  it("never prints the linked Drive sources", () => {
    expect(html).not.toContain("Spec Selections");
  });
});

describe("asManual", () => {
  it("drops malformed fields", () => {
    expect(asManual({ title: 5, contacts: [{ name: "A", vendorId: "" }, null], sections: "x" })).toEqual({
      title: "", intro: "", contacts: [{ trade: "", name: "A", phone: "", email: "", url: "" }], sections: [], links: [], sources: [],
    });
    expect(asManual(null)).toBeNull();
  });
});

describe("mergeSections", () => {
  it("adds new items to a same-named section, skips repeats, keeps edits", () => {
    const mine = [{ title: "Kitchen", items: [{ label: "Range", value: "Bosch 800", url: "edited" }] }];
    const out = mergeSections(mine, [
      { title: "kitchen ", items: [{ label: "range", value: "BOSCH 800", url: "" }, { label: "Hood", value: "Zephyr", url: "" }] },
      { title: "Bath", items: [{ label: "Tile", value: "Daltile", url: "" }] },
    ]);
    expect(out).toEqual([
      { title: "Kitchen", items: [{ label: "Range", value: "Bosch 800", url: "edited" }, { label: "Hood", value: "Zephyr", url: "" }] },
      { title: "Bath", items: [{ label: "Tile", value: "Daltile", url: "" }] },
    ]);
    expect(mine[0].items).toHaveLength(1);
  });
});

describe("driveIdFromLink", () => {
  it("reads folder, file and open links, and a bare id", () => {
    expect(driveIdFromLink("https://drive.google.com/drive/u/0/folders/16Dfxhkm6EOze0THWFmS5pONrZ8vwi1ML")).toBe("16Dfxhkm6EOze0THWFmS5pONrZ8vwi1ML");
    expect(driveIdFromLink("https://drive.google.com/file/d/1-ExUZUmpi-wDrXbp2wzWavcAYtEi2aoL/view?usp=drivesdk")).toBe("1-ExUZUmpi-wDrXbp2wzWavcAYtEi2aoL");
    expect(driveIdFromLink("https://docs.google.com/document/d/1knkfLrf7ne2epoetKL4lWyFgolrjoQN4ztFb1T5YQvU/edit")).toBe("1knkfLrf7ne2epoetKL4lWyFgolrjoQN4ztFb1T5YQvU");
    expect(driveIdFromLink("https://drive.google.com/open?id=16Dfxhkm6EOze0THWFmS5pONrZ8vwi1ML")).toBe("16Dfxhkm6EOze0THWFmS5pONrZ8vwi1ML");
    expect(driveIdFromLink("not a link")).toBe("");
  });
});
