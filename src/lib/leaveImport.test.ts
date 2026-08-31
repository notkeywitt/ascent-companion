import { describe, expect, it } from "vitest";

import { buildImportPlan, columnLeaveType, parseBalanceCsv } from "@/lib/leaveImport";

const CSV = `"fname","lname","username","payroll_id","group_name","Paid Time Off","Sick","Vacation"
"Seth","June","sethjune@gmail.com","","-","80.00","27.96","80.00"
"Cedar","Charnley","ccharnley","","-","67.38","30.75","0"
"Shawn (OLD)","Westervelt","swestervelt8","","-","0","0","0"
`;

const ROSTER = [
  { employeeId: "E1", name: "Seth June", email: "sethjune@gmail.com", jtUserId: "u1" },
  { employeeId: "E2", name: "Cedar Charnley", email: "cedar@ascentbuildingco.com", jtUserId: "u2" },
];

describe("columnLeaveType", () => {
  it("maps the TSheets headers, PTO and Vacation to one pool", () => {
    expect(columnLeaveType("Sick")).toBe("sick");
    expect(columnLeaveType("Paid Time Off")).toBe("pto");
    expect(columnLeaveType("Vacation")).toBe("pto");
    expect(columnLeaveType("payroll_id")).toBe(null);
  });
});

describe("parseBalanceCsv", () => {
  it("sums PTO + Vacation and keeps Sick separate", () => {
    const parsed = parseBalanceCsv(CSV);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0].hours).toEqual({ sick: 27.96, pto: 160 });
    expect(parsed.rows[1].hours).toEqual({ sick: 30.75, pto: 67.38 });
    expect(parsed.ignoredColumns).toContain("payroll_id");
  });

  it("refuses a file with no balance columns", () => {
    expect(() => parseBalanceCsv(`"fname","lname"\n"A","B"\n`)).toThrow(/No balance columns/);
  });
});

describe("buildImportPlan", () => {
  const parsed = parseBalanceCsv(CSV);

  it("matches by email, then by name, and diffs to the CSV number", () => {
    const plan = buildImportPlan({
      parsed,
      roster: ROSTER,
      currentBalance: (id, type) => (id === "E1" && type === "sick" ? 27.96 : 10),
    });
    const seth = plan.rows[0];
    expect(seth.matchedBy).toBe("email");
    expect(seth.changes.find((c) => c.leaveType === "sick")?.delta).toBe(0);
    expect(seth.changes.find((c) => c.leaveType === "pto")).toMatchObject({ current: 10, target: 160, delta: 150 });
    expect(plan.rows[1].matchedBy).toBe("name"); // ccharnley isn't an email
    expect(plan.rows[2].status).toBe("unmatched"); // Shawn (OLD)
    expect(plan.counts.unmatched).toBe(1);
  });

  it("is a no-op when every balance already matches", () => {
    const target: Record<string, number> = { "E1|sick": 27.96, "E1|pto": 160, "E2|sick": 30.75, "E2|pto": 67.38 };
    const plan = buildImportPlan({
      parsed,
      roster: ROSTER,
      currentBalance: (id, type) => target[`${id}|${type}`] ?? 0,
    });
    expect(plan.counts.changes).toBe(0);
    expect(plan.rows.slice(0, 2).every((r) => r.status === "unchanged")).toBe(true);
  });

  it("honours an override, and an empty override skips the line", () => {
    const plan = buildImportPlan({
      parsed,
      roster: ROSTER,
      currentBalance: () => 0,
      overrides: { swestervelt8: "" },
    });
    expect(plan.rows[2].status).toBe("skipped");
    expect(plan.counts.skipped).toBe(1);
  });
});
