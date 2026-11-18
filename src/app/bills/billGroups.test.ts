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

  it("reverses the sort", () => {
    expect(shape(groupBills(bills, "date", "none", true))[0][1]).toEqual(["1", "3", "5"]);
    expect(shape(groupBills(bills, "name", "none", true))[0][1]).toEqual(["1", "5", "3"]);
  });

  it("sorts by amount, biggest first", () => {
    const b = [
      { id: "a", fromName: "X", cost: 5 },
      { id: "b", fromName: "Y", cost: 50 },
    ];
    expect(shape(groupBills(b, "amount", "none"))[0][1]).toEqual(["b", "a"]);
    expect(shape(groupBills(b, "amount", "none", true))[0][1]).toEqual(["a", "b"]);
  });

  it("groups by month, newest month first, and reverses", () => {
    const b = [
      { id: "a", fromName: "X", issueDate: "2026-09-30" },
      { id: "b", fromName: "Y", issueDate: "2026-10-02" },
      { id: "c", fromName: "Sunset", issueDate: "2026-10-03" },
    ];
    expect(shape(groupBills(b, "date", "month")).map((g) => g[0])).toEqual(["October 2026", "September 2026", "Sunset"]);
    expect(shape(groupBills(b, "date", "month", true)).map((g) => g[0])).toEqual(["September 2026", "October 2026", "Sunset"]);
  });

  it("groups by day, newest first", () => {
    expect(shape(groupBills(bills, "date", "date")).map((g) => g[0])).toEqual([
      "Oct 4, 2026",
      "Oct 3, 2026",
      "Oct 1, 2026",
      "Sunset",
    ]);
  });

  it("groups by coding status, To code first", () => {
    const b = [
      { id: "a", fromName: "X", reviewed: true },
      { id: "b", fromName: "Y" },
    ];
    expect(shape(groupBills(b, "date", "code")).map((g) => g[0])).toEqual(["To code", "Reviewed"]);
  });

  it("puts Ascent jobs below client jobs when grouped by job", () => {
    const b = [
      { id: "a", fromName: "X", jobName: "Ascent Office" },
      { id: "b", fromName: "Y", jobName: "Zeta" },
      { id: "c", fromName: "Z" },
    ];
    expect(shape(groupBills(b, "date", "job")).map((g) => g[0])).toEqual(["Zeta", "Ascent Office", "No job"]);
  });
});
