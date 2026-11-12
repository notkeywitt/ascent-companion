import { describe, expect, it } from "vitest";
import { buildFolderBill, parseFolderFileName, shortDate } from "./folderBill";

describe("parseFolderFileName", () => {
  it("reads code, amount and description from the filed name", () => {
    expect(parseFolderFileName("26 20 00 - 86.16 - relay_and_flex_conduit_from_all_phase.pdf")).toEqual({
      csi: "26 20 00",
      amount: 86.16,
      description: "Relay and flex conduit from all phase",
      fileName: "26 20 00 - 86.16 - relay_and_flex_conduit_from_all_phase.pdf",
    });
  });
  it("reads a thousands separator and a whole-dollar amount", () => {
    expect(parseFolderFileName("26 40 00 - 2,358.71 - towel_warmer.pdf")?.amount).toBe(2358.71);
    expect(parseFolderFileName("26 10 00 - 500 - panel.pdf")?.amount).toBe(500);
  });
  it("refuses a name that is not in the pattern", () => {
    expect(parseFolderFileName("scan0001.pdf")).toBeNull();
    expect(parseFolderFileName("26 20 00 - abc - thing.pdf")).toBeNull();
    expect(parseFolderFileName("26 20 00 - 0.00 - thing.pdf")).toBeNull();
  });
});

describe("buildFolderBill", () => {
  it("sums to the cent, sorts by code, and names what it skipped", () => {
    const b = buildFolderBill([
      { name: "26 40 00 - 0.10 - b.pdf" },
      { name: "26 20 00 - 0.20 - a.pdf" },
      { name: "notes.txt" },
    ]);
    expect(b.lines.map((l) => l.csi)).toEqual(["26 20 00", "26 40 00"]);
    expect(b.total).toBe(0.3);
    expect(b.skipped).toEqual(["notes.txt"]);
  });
});

describe("shortDate", () => {
  it("prints M/D/YY", () => {
    expect(shortDate("2026-08-01")).toBe("8/1/26");
  });
});
