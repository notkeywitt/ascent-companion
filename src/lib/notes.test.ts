import { describe, expect, it } from "vitest";

import {
  billingYmForDate,
  changedFields,
  cleanInvolves,
  groupByBillingMonth,
  isNoteDate,
  readNoteFields,
  type Note,
  type NoteFields,
} from "./notes";

const base: NoteFields = {
  body: "Tile order moved",
  jobId: "abc123def",
  jobLabel: "Berger - Main House",
  noteDate: "2026-10-19",
  billingYm: "2026-10",
  involves: ["Seth"],
};

describe("billingYmForDate", () => {
  it("bills the 10th and earlier to the month before", () => {
    expect(billingYmForDate("2026-11-10")).toBe("2026-10");
    expect(billingYmForDate("2026-11-11")).toBe("2026-11");
    expect(billingYmForDate("2027-01-05")).toBe("2026-12");
  });
});

describe("isNoteDate", () => {
  it("rejects shapes and impossible days", () => {
    expect(isNoteDate("2026-10-19")).toBe(true);
    expect(isNoteDate("2026-02-30")).toBe(false);
    expect(isNoteDate("10/19/2026")).toBe(false);
    expect(isNoteDate(undefined)).toBe(false);
  });
});

describe("cleanInvolves", () => {
  it("trims, drops repeats and blanks, ignores non-strings", () => {
    expect(cleanInvolves([" Seth ", "seth", "", 4, "Wyatt  K"])).toEqual(["Seth", "Wyatt K"]);
    expect(cleanInvolves("nope")).toEqual([]);
  });
});

describe("readNoteFields", () => {
  it("makes a new note: billing month follows the date", () => {
    const r = readNoteFields({ body: " hi ", noteDate: "2026-11-05", jobId: "abc123def" });
    expect(r.ok && r.fields).toMatchObject({ body: "hi", billingYm: "2026-10", involves: [] });
  });
  it("lets the writer set the billing month apart from the date", () => {
    const r = readNoteFields({ body: "x", noteDate: "2026-11-05", billingYm: "2026-11" });
    expect(r.ok && r.fields.billingYm).toBe("2026-11");
  });
  it("refuses an empty body, a bad job id, a bad date and a bad month", () => {
    expect(readNoteFields({ body: "  ", noteDate: "2026-11-05" }).ok).toBe(false);
    expect(readNoteFields({ body: "x", noteDate: "2026-11-05", jobId: "no!" }).ok).toBe(false);
    expect(readNoteFields({ body: "x", noteDate: "nope" }).ok).toBe(false);
    expect(readNoteFields({ body: "x", noteDate: "2026-11-05", billingYm: "2026-13" }).ok).toBe(false);
  });
  it("an edit keeps what it does not send", () => {
    const r = readNoteFields({ body: "New text" }, base);
    expect(r.ok && r.fields).toEqual({ ...base, body: "New text" });
  });
  it("drops the job label when the job is cleared", () => {
    const r = readNoteFields({ jobId: "" }, base);
    expect(r.ok && r.fields).toMatchObject({ jobId: "", jobLabel: "" });
  });
});

describe("changedFields", () => {
  it("names only what moved", () => {
    expect(changedFields(base, base)).toEqual([]);
    expect(changedFields(base, { ...base, body: "x", involves: [] })).toEqual(["body", "involves"]);
  });
});

describe("groupByBillingMonth", () => {
  const n = (id: number, ym: string, d: string): Note => ({
    ...base,
    id,
    billingYm: ym,
    noteDate: d,
    authorEmail: "",
    authorName: "",
    createdAt: `${d}T00:00:00Z`,
    updatedAt: "",
    editCount: 0,
  });
  it("sorts months and notes newest first", () => {
    const g = groupByBillingMonth([n(1, "2026-09", "2026-09-30"), n(2, "2026-10", "2026-10-01"), n(3, "2026-10", "2026-10-20")]);
    expect(g.map((x) => x.ym)).toEqual(["2026-10", "2026-09"]);
    expect(g[0].notes.map((x) => x.id)).toEqual([3, 2]);
  });
});
