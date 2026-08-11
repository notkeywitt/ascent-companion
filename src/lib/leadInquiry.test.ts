import { describe, expect, it } from "vitest";
import {
  BLANK_INQUIRY,
  BUDGETS,
  INQUIRY_ROWS,
  inquirySummary,
  joinMulti,
  normalizeInquiry,
  splitMulti,
  toggleMulti,
  type InquiryFields,
} from "./leadInquiry";

/**
 * The lead intake form's shared definition.
 *
 * Two things here have consequences outside the browser: `normalizeInquiry` is
 * what an untrusted request body becomes before it is stored, and
 * `inquirySummary` is the text that gets WRITTEN into a JobTread customer's Notes
 * on push. A silent drop in either means an answer the office typed never
 * reaches JobTread.
 */

const filled = (over: Partial<InquiryFields> = {}): InquiryFields => ({
  ...BLANK_INQUIRY,
  name: "Jack Warner",
  email: "jack@example.com",
  phone: "(360) 201-5156",
  contactMethod: "Text",
  address: "Shoreland Dr, parcel 25014400300",
  services: "New Build",
  budget: "Under $250k, $250k - $750k",
  ...over,
});

describe("multi-select values", () => {
  it("round-trips the comma-joined form the website's own emails use", () => {
    expect(splitMulti("Under $250k, $250k - $750k")).toEqual(["Under $250k", "$250k - $750k"]);
    expect(joinMulti(["Under $250k", "$250k - $750k"])).toBe("Under $250k, $250k - $750k");
  });

  it("tolerates stray spacing and empties", () => {
    expect(splitMulti(" New Build ,, Consultation ")).toEqual(["New Build", "Consultation"]);
    expect(splitMulti("")).toEqual([]);
  });

  it("toggles a value on and off", () => {
    const on = toggleMulti("", "$250k - $750k", BUDGETS);
    expect(on).toBe("$250k - $750k");
    expect(toggleMulti(on, "$250k - $750k", BUDGETS)).toBe("");
  });

  // The pills are tapped in whatever order the caller likes; the stored value
  // should still read in the form's own order, not tap order.
  it("keeps the option order, not the tap order", () => {
    let v = toggleMulti("", "Over $1.5M", BUDGETS);
    v = toggleMulti(v, "Under $250k", BUDGETS);
    expect(v).toBe("Under $250k, Over $1.5M");
  });
});

describe("normalizeInquiry", () => {
  it("keeps only known keys and trims them", () => {
    const { fields } = normalizeInquiry({ name: "  Jack  ", phone: " 360 ", nope: "x" });
    expect(fields.name).toBe("Jack");
    expect(fields.phone).toBe("360");
    expect("nope" in fields).toBe(false);
  });

  it("reports which keys the body actually carried, so a PATCH can't blank the rest", () => {
    const { present } = normalizeInquiry({ notes: "called back" });
    expect(present).toEqual(["notes"]);
  });

  it("treats an absent key as absent, not as empty", () => {
    const { fields, present } = normalizeInquiry({});
    expect(fields).toEqual(BLANK_INQUIRY);
    expect(present).toEqual([]);
  });

  // The form posts a multi-select as a string, but an API caller may well send an
  // array — both have to land as the same stored value.
  it("accepts an array for a multi-select field", () => {
    const { fields } = normalizeInquiry({ services: ["New Build", " Consultation "] });
    expect(fields.services).toBe("New Build, Consultation");
  });

  it("coerces junk types instead of trusting them", () => {
    const { fields } = normalizeInquiry({ name: 42, notes: null });
    expect(fields.name).toBe("42");
    expect(fields.notes).toBe("");
  });
});

describe("inquirySummary", () => {
  it("carries every answered question, under the website's own labels", () => {
    const text = inquirySummary(filled());
    for (const row of INQUIRY_ROWS) {
      const value = filled()[row.key];
      if (!value) continue;
      expect(text).toContain(row.label);
      expect(text).toContain(value);
    }
  });

  it("leaves unanswered questions out rather than printing blank labels", () => {
    const text = inquirySummary(filled({ residency: "", startDate: "" }));
    expect(text).not.toContain("Residency");
    expect(text).not.toContain("Start Date");
  });

  it("breaks a multi-line answer onto its own lines", () => {
    const text = inquirySummary(filled({ projectDetails: "Line one\nLine two" }));
    expect(text).toContain("Project Details:\nLine one\nLine two");
  });

  it("keeps our own notes separate from the customer's answers", () => {
    const text = inquirySummary(filled({ notes: "Wants a call after 5" }));
    expect(text).toContain("Our notes: Wants a call after 5");
  });

  it("stamps who logged it and when, from the date part only", () => {
    const text = inquirySummary(filled(), {
      loggedAt: "2026-08-11T17:06:01.000Z",
      loggedBy: "office@ascentbuildingco.com",
    });
    expect(text).toContain("2026-08-11 · office@ascentbuildingco.com");
    expect(text).not.toContain("17:06:01");
  });

  it("is still valid text for a lead with nothing but a name", () => {
    const text = inquirySummary({ ...BLANK_INQUIRY, name: "Jack" });
    expect(text.startsWith("Inquiry (logged in Ascent Assistant)")).toBe(true);
  });
});

describe("INQUIRY_ROWS", () => {
  // The rows drive the form's labels, the read-back panel AND the JobTread
  // summary. A key that isn't a real field would silently render blank in all
  // three.
  it("names only real fields", () => {
    for (const row of INQUIRY_ROWS) {
      expect(Object.keys(BLANK_INQUIRY)).toContain(row.key);
    }
  });

  it("leaves out the fields that become real JobTread fields, and our notes", () => {
    const keys = INQUIRY_ROWS.map((r) => r.key);
    expect(keys).not.toContain("name");
    expect(keys).not.toContain("leadSource");
    expect(keys).not.toContain("customerType");
    expect(keys).not.toContain("notes");
  });
});
