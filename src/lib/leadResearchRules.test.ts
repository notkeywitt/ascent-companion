import { describe, expect, it } from "vitest";

import { buildPatches, cleanSubmission, coerceValue, safeFileName, sameValue, type CleanContext } from "./leadResearchRules";

const ctx: CleanContext = {
  catalog: {
    account: [
      { id: "type", name: "Type", type: "option", options: ["Residential", "Commercial"], editable: true },
      { id: "status", name: "Status", type: "option", options: ["New Lead"], editable: true },
    ],
    location: [{ id: "parcel", name: "Parcel Number", type: "text", options: [], editable: true }],
    job: [
      { id: "year", name: "Year Built", type: "number", options: [], editable: true },
      { id: "sqft", name: "Square Footage", type: "number", options: [], editable: true },
      { id: "multi", name: "Tags", type: "text", options: [], editable: false },
    ],
  },
  current: { account: {}, location: { parcel: "" }, job: { sqft: "1,529" } },
  currentAddress: "",
};

describe("cleanSubmission", () => {
  it("pencils in a value for an empty field and ticks it", () => {
    const r = cleanSubmission({ summary: "s", proposals: [{ target: "job", fieldId: "year", value: "1978", source: "https://a.gov/x" }] }, ctx);
    expect(r.dossier.proposals).toHaveLength(1);
    expect(r.dossier.proposals[0]).toMatchObject({ target: "job", fieldId: "year", value: "1978", selected: true, label: "Year Built" });
  });

  it("drops a proposal equal to what JobTread holds", () => {
    const r = cleanSubmission({ summary: "s", proposals: [{ target: "job", fieldId: "sqft", value: "1529" }] }, ctx);
    expect(r.dossier.proposals).toHaveLength(0);
  });

  it("leaves a replacement unticked", () => {
    const r = cleanSubmission({ summary: "s", proposals: [{ target: "job", fieldId: "sqft", value: "1800" }] }, ctx);
    expect(r.dossier.proposals[0]).toMatchObject({ current: "1,529", selected: false });
  });

  it("refuses blocked, unknown, multi-value and badly typed fields", () => {
    const r = cleanSubmission(
      {
        summary: "s",
        proposals: [
          { target: "account", fieldId: "status", value: "New Lead" },
          { target: "account", fieldId: "nope", value: "x" },
          { target: "job", fieldId: "multi", value: "x" },
          { target: "job", fieldId: "year", value: "nineteen" },
          { target: "account", fieldId: "type", value: "Industrial" },
          { target: "planet", fieldId: "type", value: "x" },
        ],
      },
      ctx,
    );
    expect(r.dossier.proposals).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThanOrEqual(6);
  });

  it("matches an option ignoring case, and keeps the list's spelling", () => {
    const r = cleanSubmission({ summary: "s", proposals: [{ target: "account", fieldId: "type", value: "residential" }] }, ctx);
    expect(r.dossier.proposals[0].value).toBe("Residential");
  });

  it("allows the location address, and only that, without a field id", () => {
    const r = cleanSubmission(
      {
        summary: "s",
        proposals: [
          { target: "location", field: "address", value: "310 Salmon Point Rd, Lopez Island, WA" },
          { target: "job", field: "name", value: "x" },
        ],
      },
      ctx,
    );
    expect(r.dossier.proposals).toHaveLength(1);
    expect(r.dossier.proposals[0]).toMatchObject({ fieldId: "", label: "Address", selected: true });
  });

  it("files facts under known groups, drops empty rows and non-http sources", () => {
    const r = cleanSubmission(
      {
        summary: "s",
        facts: [
          { group: "Parcel", label: "Lot size", value: "1.2 acres", source: "https://a.gov" },
          { group: "Weather", label: "Rain", value: "lots", source: "javascript:alert(1)" },
          { group: "Parcel", label: "", value: "x" },
        ],
      },
      ctx,
    );
    expect(r.dossier.facts).toEqual([
      { id: "f1", group: "Parcel", label: "Lot size", value: "1.2 acres", source: "https://a.gov" },
      { id: "f2", group: "Other", label: "Rain", value: "lots", source: "" },
    ]);
  });

  it("warns when there is no summary, and reads a bad match as low", () => {
    const r = cleanSubmission({ match: { confidence: "certain" } }, ctx);
    expect(r.warnings).toContain("No summary was written.");
    expect(r.match.confidence).toBe("low");
  });
});

describe("buildPatches", () => {
  it("groups the picks by target with the reviewer's edited values", () => {
    const r = cleanSubmission(
      {
        summary: "s",
        proposals: [
          { target: "job", fieldId: "year", value: "1978" },
          { target: "location", field: "address", value: "1 Main St" },
          { target: "location", fieldId: "parcel", value: "260231003000" },
        ],
      },
      ctx,
    );
    const patches = buildPatches(r.dossier.proposals, [
      { id: "p1", value: "1979" },
      { id: "p2", value: "1 Main St, Lopez Island" },
      { id: "p3", value: "260231003000" },
      { id: "zzz", value: "x" },
    ]);
    expect(patches).toEqual([
      { target: "job", fields: {}, customFieldValues: { year: "1979" }, proposalIds: ["p1"] },
      { target: "location", fields: { address: "1 Main St, Lopez Island" }, customFieldValues: { parcel: "260231003000" }, proposalIds: ["p2", "p3"] },
    ]);
  });
});

describe("helpers", () => {
  it("coerces numbers and dates", () => {
    expect(coerceValue({ name: "n", type: "number", options: [] }, "$1,234")).toEqual({ value: "1234" });
    expect(coerceValue({ name: "d", type: "date", options: [] }, "6/1/2020")).toHaveProperty("error");
  });
  it("compares values loosely", () => {
    expect(sameValue("1,529", "1529")).toBe(true);
    expect(sameValue(" Lopez  Island ", "lopez island")).toBe(true);
    expect(sameValue("a", "b")).toBe(false);
  });
  it("makes safe file names", () => {
    expect(safeFileName('a/b:c?.pdf')).toBe("a_b_c_.pdf");
    expect(safeFileName("")).toBe("file");
  });
});
