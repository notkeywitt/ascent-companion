import { describe, expect, it } from "vitest";

import { cleanVehicleInput, dayLabel, insuranceState } from "./vehicleRules";

describe("vehicle rules", () => {
  it("cleans input: trims, upper-cases plate and VIN, checks dates and the name", () => {
    expect(cleanVehicleInput({ name: " F-250 ", plate: "abc123", vin: "1ftx", bogus: "x" }, true)).toEqual({
      values: { name: "F-250", plate: "ABC123", vin: "1FTX" },
    });
    expect(cleanVehicleInput({ plate: "x" }, true).error).toBe("Give the vehicle a name.");
    expect(cleanVehicleInput({ plate: "x" }, false).error).toBeUndefined();
    expect(cleanVehicleInput({ name: "" }, false).error).toBe("Give the vehicle a name.");
    expect(cleanVehicleInput({ name: "a", insurance_expiry: "2026-02-30" }, true).error).toMatch(/date/);
    expect(cleanVehicleInput({ name: "a", insurance_expiry: "" }, true).error).toBeUndefined();
    expect(cleanVehicleInput({ name: "a", vin: "x".repeat(21) }, true).error).toMatch(/over 20/);
    expect(cleanVehicleInput(null, true).error).toBeTruthy();
  });

  it("reads the insurance state", () => {
    expect(insuranceState("2026-11-19", "2026-11-20")).toBe("expired");
    expect(insuranceState("2026-11-20", "2026-11-20")).toBe("soon");
    expect(insuranceState("2026-12-20", "2026-11-20")).toBe("soon");
    expect(insuranceState("2026-12-21", "2026-11-20")).toBe("ok");
    expect(insuranceState("", "2026-11-20")).toBe("");
  });

  it("labels a day", () => {
    expect(dayLabel("2026-10-19")).toBe("Oct 19, 2026");
    expect(dayLabel("")).toBe("");
  });
});
