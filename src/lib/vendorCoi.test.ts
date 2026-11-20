import { describe, expect, it } from "vitest";
import {
  billedSince,
  coiByVendor,
  coiKey,
  coiNeeded,
  coiRegister,
  missingW9,
  coiRequestList,
  coiState,
  gmailComposeUrl,
  type CoiVendorInput,
  type VendorCoiRow,
} from "@/lib/vendorCoi";

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

describe("coiNeeded", () => {
  it("skips stores by name and suppliers by JobTread type", () => {
    expect(coiNeeded("Amazon", "", null)).toBe(false);
    expect(coiNeeded("Home Depot", "", null)).toBe(false);
    expect(coiNeeded("Some Lumber Yard", "Supplier", null)).toBe(false);
    expect(coiNeeded("Det Spec Drywall", "", null)).toBe(true);
  });
  it("lets the office override either way", () => {
    expect(coiNeeded("Amazon", "", true)).toBe(true);
    expect(coiNeeded("Det Spec Drywall", "Subcontractor", false)).toBe(false);
  });
});

describe("coiState", () => {
  const today = "2026-11-09";
  it("counts the expiry day as still good", () => {
    expect(coiState("2026-11-09", today)).toBe("expiring");
    expect(coiState("2026-11-08", today)).toBe("expired");
  });
  it("flags 30 days out as expiring", () => {
    expect(coiState("2026-12-09", today)).toBe("expiring");
    expect(coiState("2026-12-10", today)).toBe("current");
  });
  it("reads no date as unknown", () => {
    expect(coiState("", today)).toBe("unknown");
  });
});

describe("coiRequestList", () => {
  const today = "2026-11-09";
  const v = (over: Partial<CoiVendorInput>): CoiVendorInput => ({
    id: over.name ?? "x",
    name: "Sub",
    vendorType: "",
    coiExpires: "",
    override: null,
    lastBillOn: "2026-10-01",
    emails: ["a@b.com"],
    ...over,
  });
  it("keeps expired and undated subs billed this year", () => {
    const out = coiRequestList(
      [
        v({ name: "Undated" }),
        v({ name: "Expired", coiExpires: "2026-01-01" }),
        v({ name: "Current", coiExpires: "2027-06-01" }),
        v({ name: "Old", lastBillOn: "2025-11-08" }),
        v({ name: "Never billed", lastBillOn: "" }),
        v({ name: "Amazon" }),
      ],
      today,
    ).map((x) => x.name);
    expect(out).toEqual(["Expired", "Undated"]);
  });
  it("includes a COI expiring within 30 days", () => {
    const out = coiRequestList([v({ name: "Soon", coiExpires: "2026-12-01" })], today);
    expect(out.map((x) => x.name)).toEqual(["Soon"]);
  });
  it("counts a bill exactly 365 days back", () => {
    expect(billedSince(today)).toBe("2025-11-09");
    expect(coiRequestList([v({ name: "Edge", lastBillOn: "2025-11-09" })], today)).toHaveLength(1);
  });
});

describe("gmailComposeUrl", () => {
  it("puts every vendor in BCC once, in the office account", () => {
    const u = new URL(gmailComposeUrl(["A@x.com", "a@x.com", "b@y.com"]));
    expect(u.searchParams.get("authuser")).toBe("office@ascentbuildingco.com");
    expect(u.searchParams.get("bcc")).toBe("a@x.com,b@y.com");
    expect(u.searchParams.get("to")).toBe("office@ascentbuildingco.com");
  });
});

describe("coiRegister", () => {
  const today = "2026-11-09";
  const r = (name: string, coiExpires: string, over: Partial<VendorCoiRow> = {}): VendorCoiRow => ({
    id: name,
    name,
    vendorType: "",
    coiExpires,
    override: null,
    lastBillOn: "2026-10-01",
    emails: [],
    lastRequestedOn: "",
    w9: true,
    holdHarmless: "",
    needed: true,
    state: coiState(coiExpires, today),
    ...over,
  });
  it("lists needed subs worst first and drops the rest", () => {
    const out = coiRegister(
      [
        r("Good", "2027-06-01"),
        r("Soon", "2026-11-20"),
        r("None", ""),
        r("Gone", "2026-01-01"),
        r("NotNeeded", "", { needed: false }),
        r("Stale", "", { lastBillOn: "2024-01-01" }),
      ],
      today,
    ).map((x) => x.name);
    expect(out).toEqual(["Gone", "None", "Soon", "Good"]);
  });
  it("flags a needed vendor with no W-9", () => {
    expect(missingW9(r("A", "", { w9: false }))).toBe(true);
    expect(missingW9(r("B", "", { w9: true }))).toBe(false);
    expect(missingW9(r("C", "", { w9: false, needed: false }))).toBe(false);
  });
});
