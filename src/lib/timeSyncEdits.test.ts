import { describe, expect, it } from "vitest";

import { applyEdits, type WorkedRow } from "./timeSync";

// Casey's 9/15 record — JobTread refused it: "Unknown time entry type 'Thomas - PM'".
const row: WorkedRow = {
  entryId: "te-1",
  date: "2026-09-15",
  employee: "Casey Zautke",
  jtUserId: "u1",
  jobLabel: "Jim Thomas › Patio Repair",
  jobId: "j1",
  costCode: "01 31 00",
  costItemId: "c1",
  payType: "Thomas - PM",
  start: "2026-09-15 11:00",
  end: "2026-09-15 13:00",
  note: "Production management",
  jtStatus: "JobTread error: Unknown time entry type",
};

describe("applyEdits", () => {
  it("changes only what differs and names it", () => {
    const r = applyEdits(row, {
      jobId: "j1",
      costItemId: "c1",
      payType: "Berger - Principal",
      start: "2026-09-15T11:00",
      end: "2026-09-15T13:00",
      note: "Production management",
    });
    expect(r.error).toBeUndefined();
    expect(r.row.payType).toBe("Berger - Principal");
    expect(r.changed).toEqual(['pay type "Thomas - PM" → "Berger - Principal"']);
  });

  it("reads the sheet's single-digit hour as the same minute", () => {
    const r = applyEdits({ ...row, start: "2026-09-23 7:00", end: "2026-09-23 8:00" }, {
      start: "2026-09-23T07:00",
      end: "2026-09-23T08:00",
    });
    expect(r.changed).toEqual([]);
  });

  it("takes a new job's label and a new line's code", () => {
    const r = applyEdits(row, { jobId: "j2", jobLabel: "Ferron › Otis Perkins Addition", costItemId: "c2", costCode: "01 31 20" });
    expect(r.row.jobLabel).toBe("Ferron › Otis Perkins Addition");
    expect(r.row.costCode).toBe("01 31 20");
    expect(r.changed).toHaveLength(2);
  });

  it("refuses a stop at or before the start", () => {
    expect(applyEdits(row, { end: "2026-09-15T10:00" }).error).toMatch(/after the start/);
    expect(applyEdits(row, { start: "nonsense" }).error).toMatch(/unreadable/);
  });
});
