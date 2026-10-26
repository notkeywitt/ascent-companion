import { describe, expect, it } from "vitest";
import { DEFAULT_TITLE_STYLE, galleryFrom, asManual, draftManual, driveIdFromLink, manualHtml, mergeSections, titleCss, type HouseManual } from "@/lib/houseManual";
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
      { title: "Kitchen", items: [{ label: "Range", value: "Bosch 800", url: "https://bosch.com/r" }], subsections: [] },
      { title: "Bath", items: [{ label: "Tile", value: "Daltile", url: "" }], subsections: [] },
    ]);
  });

  it("falls back to JobTread specifications when no list was imported", () => {
    const m = draftManual("J", null, [{ group: "Appliances", name: "Dishwasher", description: " Bosch 500 " }]);
    expect(m.sections).toEqual([{ title: "Appliances", items: [{ label: "Dishwasher", value: "Bosch 500", url: "" }], subsections: [] }]);
  });
});

describe("manualHtml", () => {
  const m: HouseManual = {
    title: "Cherry <Tree>",
    titleStyle: DEFAULT_TITLE_STYLE,
    intro: "",
    contacts: [
      { trade: "HVAC", name: "Barron", phone: "360 685-9618", email: "", url: "barronheating.com" },
      { trade: "Empty", name: " ", phone: "", email: "", url: "" },
    ],
    sections: [
      {
        title: "Appliances",
        items: [{ label: "Range", value: "Bosch", url: "javascript:alert(1)" }],
        subsections: [
          { title: "Laundry", items: [{ label: "Washer", value: "LG WM3400CW\nFront load, white", url: "" }] },
          { title: "Blank", items: [] },
        ],
      },
      { title: "Empty", items: [], subsections: [] },
    ],
    galleries: [
      galleryFrom({ id: "folder1", name: "Pre-cover", url: "https://drive.google.com/f" }, [
        { id: "photo00001", name: "kitchen.jpg", url: "", isFolder: false, mimeType: "image/jpeg", modified: "", shared: true },
        { id: "photo00002", name: "private.jpg", url: "", isFolder: false, mimeType: "image/jpeg", modified: "", shared: false },
        { id: "doc0000001", name: "notes.pdf", url: "", isFolder: false, mimeType: "application/pdf", modified: "", shared: true },
      ]),
      { title: "Nobody shared", folderId: "f2", folderUrl: "", photos: [{ id: "photo00003", name: "x.jpg", shared: false }] },
    ],
    links: [{ text: "Pre-cover photos", url: "https://photos.example.com/x" }],
    sources: [{ id: "abc", name: "Spec Selections", url: "https://drive.google.com/x", isFolder: true }],
  };
  const html = manualHtml(m);

  it("escapes text and drops unsafe links", () => {
    expect(html).toContain(">Cherry &lt;Tree&gt;</h2>");
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

  it("prints sub-sections under their section, keeps line breaks, skips empty ones", () => {
    expect(html).toContain('<h4 class="am-sub">Laundry</h4><dl><dt>Washer</dt><dd>LG WM3400CW<br>Front load, white</dd></dl>');
    expect(html).not.toContain("Blank");
  });

  it("shows a gallery's shared photos only, and leaves out a gallery with none", () => {
    expect(html).toContain("<summary>Pre-cover</summary>");
    expect(html).toContain('src="https://lh3.googleusercontent.com/d/photo00001=w800"');
    expect(html).toContain('alt="kitchen"');
    expect(html).not.toContain("photo00002");
    expect(html).not.toContain("notes");
    expect(html).not.toContain("Nobody shared");
  });

  it("never prints the linked Drive sources", () => {
    expect(html).not.toContain("Spec Selections");
  });
});

describe("asManual", () => {
  it("drops malformed fields", () => {
    expect(asManual({ sections: [{ title: "Old", items: [] }] })?.sections).toEqual([{ title: "Old", items: [], subsections: [] }]);
    expect(asManual({ title: 5, contacts: [{ name: "A", vendorId: "" }, null], sections: "x" })).toEqual({
      title: "", titleStyle: DEFAULT_TITLE_STYLE, intro: "", contacts: [{ trade: "", name: "A", phone: "", email: "", url: "" }], sections: [], galleries: [], links: [], sources: [],
    });
    expect(asManual(null)).toBeNull();
  });
});

describe("mergeSections", () => {
  it("adds new items to a same-named section, skips repeats, keeps edits", () => {
    const sub = { title: "Pantry", items: [] };
    const mine = [{ title: "Kitchen", items: [{ label: "Range", value: "Bosch 800", url: "edited" }], subsections: [sub] }];
    const out = mergeSections(mine, [
      { title: "kitchen ", items: [{ label: "range", value: "BOSCH 800", url: "" }, { label: "Hood", value: "Zephyr", url: "" }] },
      { title: "Bath", items: [{ label: "Tile", value: "Daltile", url: "" }] },
    ]);
    expect(out).toEqual([
      { title: "Kitchen", items: [{ label: "Range", value: "Bosch 800", url: "edited" }, { label: "Hood", value: "Zephyr", url: "" }], subsections: [sub] },
      { title: "Bath", items: [{ label: "Tile", value: "Daltile", url: "" }], subsections: [] },
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

describe("title style", () => {
  it("defaults to the shipped look, and an old manual keeps it", () => {
    expect(asManual({ title: "A" })?.titleStyle).toEqual(DEFAULT_TITLE_STYLE);
    expect(titleCss(DEFAULT_TITLE_STYLE)).toBe("text-transform:uppercase;letter-spacing:0.08em;text-align:center;text-wrap:balance");
  });

  it("writes the chosen font, size, weight and wrap, and keeps typed line breaks", () => {
    const m = asManual({
      title: "Cherry\nTree",
      titleStyle: { font: "Georgia, serif", size: 64, weight: "300", italic: true, upper: false, spacing: 0, lineHeight: 1.1, align: "left", wrap: "nowrap" },
    })!;
    expect(titleCss(m.titleStyle)).toBe(
      "font-family:Georgia, serif;font-size:min(64px,16vw);font-weight:300;font-style:italic;text-transform:none;letter-spacing:0em;line-height:1.1;text-align:left;white-space:nowrap",
    );
    expect(manualHtml(m)).toContain(">Cherry<br>Tree</h2>");
  });

  it("strips anything from a font name that could break out of the style", () => {
    const m = asManual({ titleStyle: { font: 'x;}" onload="alert(1)<>', size: 9999, weight: "bold" } })!;
    expect(m.titleStyle.font).not.toMatch(/[;<>(){}]/);
    expect(m.titleStyle.size).toBe(200);
    expect(m.titleStyle.weight).toBe("");
    expect(manualHtml({ ...m, title: "T" })).not.toContain('" onload');
  });
});
