import { describe, expect, it } from "vitest";
import { coiByVendor, coiKey } from "@/lib/vendorCoi";

describe("coiByVendor", () => {
  it("keeps each vendor's newest year and skips other files", () => {
    expect(
      coiByVendor(["Acme COI - 2025.pdf", "Acme COI - 2026", "Acme Supply COI - 2024.pdf", "notes.txt"]),
    ).toEqual({ acme: 2026, "acme supply": 2024 });
  });

  it("matches a vendor whose name Drive refuses, as Apps Script files it", () => {
    expect(coiByVendor(["A B Electric COI - 2026.pdf"])[coiKey("A/B Electric")]).toBe(2026);
  });
});
