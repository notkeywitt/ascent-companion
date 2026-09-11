import { describe, expect, it } from "vitest";
import { guidePathKey, normalizeTopics, parseGuide } from "./pageGuide";

describe("guidePathKey", () => {
  it("keeps a word path", () => {
    expect(guidePathKey("/trackingsheet")).toBe("/trackingsheet");
    expect(guidePathKey("/admin/copy")).toBe("/admin/copy");
    expect(guidePathKey("/")).toBe("/");
  });
  it("folds a record id, so every bill shares one guide", () => {
    expect(guidePathKey("/bill/22ab9x")).toBe("/bill/*");
    expect(guidePathKey("/bill/70cd1z")).toBe("/bill/*");
  });
  it("drops the query string", () => {
    expect(guidePathKey("/trackingsheet?jobId=22x")).toBe("/trackingsheet");
  });
});

describe("normalizeTopics", () => {
  it("drops rows with no id or label, and duplicates", () => {
    const t = normalizeTopics([
      { id: "a", label: "Budget", selector: "div", body: "x" },
      { id: "a", label: "Again" },
      { id: "", label: "No id" },
      { id: "b" },
      "nonsense",
    ]);
    expect(t.map((x) => x.id)).toEqual(["a"]);
  });
  it("fills the optional fields", () => {
    expect(normalizeTopics([{ id: "a", label: "Budget" }])[0]).toEqual({
      id: "a",
      label: "Budget",
      selector: "",
      body: "",
    });
  });
  it("reads bad JSON as no guide", () => {
    expect(parseGuide("{oops")).toEqual([]);
  });
});
