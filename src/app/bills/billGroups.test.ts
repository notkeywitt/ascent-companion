import { describe, expect, it } from "vitest";
import { groupBills } from "./billGroups";

const bills = [
  { id: "1", fromName: "Hagen Lumber", jobName: "Berger", issueDate: "2026-10-01" },
  { id: "2", fromName: "Sunset Builders Supply", jobName: "Berger", issueDate: "2026-10-05" },
  { id: "3", fromName: "A1 Septic", jobName: "Gormley", issueDate: "2026-10-03" },
  { id: "4", fromName: "Sunset Builders Supply", jobName: "Gormley", issueDate: "2026-10-02" },
  { id: "5", fromName: "Ace", issueDate: "2026-10-04" },
];
const shape = (g: ReturnType<typeof groupBills>) => g.map((x) => [x.title, x.bills.map((b) => b.id)]);

describe("groupBills", () => {
  it("keeps Sunset together and last when ungrouped, newest first", () => {
    expect(shape(groupBills(bills, "date", "none"))).toEqual([
      ["To code", ["5", "3", "1"]],
      ["Sunset", ["2", "4"]],
    ]);
  });

  it("sorts by vendor name", () => {
    expect(shape(groupBills(bills, "name", "none"))[0][1]).toEqual(["3", "5", "1"]);
  });

  it("groups by job, with No job then Sunset at the foot", () => {
    expect(shape(groupBills(bills, "date", "job"))).toEqual([
      ["Berger", ["1"]],
      ["Gormley", ["3"]],
      ["No job", ["5"]],
      ["Sunset", ["2", "4"]],
    ]);
  });

  it("groups by vendor", () => {
    expect(shape(groupBills(bills, "date", "vendor")).map((g) => g[0])).toEqual([
      "A1 Septic",
      "Ace",
      "Hagen Lumber",
      "Sunset",
    ]);
  });
});
