import { describe, expect, it } from "vitest";
import { buildWeekActivity, itemEditPatch, nearness, patchItem, pickedItems, weekDates } from "./weekActivity";

describe("weekDates", () => {
  it("runs Sunday to Saturday around a mid-week day", () => {
    expect(weekDates("2026-11-18")).toEqual([
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
    ]);
  });
  it("keeps a Sunday as the first day and crosses a month end", () => {
    expect(weekDates("2026-11-29")[0]).toBe("2026-11-29");
    expect(weekDates("2026-11-29")[6]).toBe("2026-12-05");
  });
});

describe("buildWeekActivity", () => {
  const today = "2026-11-17"; // Tuesday
  const task = {
    id: "t1",
    name: "Framing",
    phase: "Rough",
    startDate: "2026-11-10",
    endDate: "2026-11-16",
    jobId: "a",
    jobName: "Barn",
  };

  it("counts a schedule task on every day it spans inside the week", () => {
    const w = buildWeekActivity(today, [task], []);
    expect(w.jobs[0].days.map((d) => d.length)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(w.jobs[0].total).toBe(2);
    expect(w.jobs[0].days[0][0]).toMatchObject({ kind: "task", phase: "Rough" });
  });

  it("counts a to-do once, on the day it is due", () => {
    const w = buildWeekActivity(
      today,
      [],
      [
        {
          id: "d1",
          name: "Order windows",
          startDate: "2026-11-01",
          endDate: "2026-11-19",
          jobId: "a",
          jobName: "Barn",
        },
        { id: "d2", name: "No date", jobId: "a", jobName: "Barn" },
        { id: "d3", name: "Next week", endDate: "2026-11-23", jobId: "a", jobName: "Barn" },
      ],
    );
    expect(w.jobs[0].days.map((d) => d.length)).toEqual([0, 0, 0, 0, 1, 0, 0]);
  });

  it("sorts the busiest week first and labels a job Customer - Job", () => {
    const w = buildWeekActivity(
      today,
      [
        task,
        {
          ...task,
          id: "t2",
          jobId: "b",
          jobName: "Shed",
          startDate: "2026-11-15",
          endDate: "2026-11-21",
        },
      ],
      [],
      new Map([["b", "Smith"]]),
    );
    expect(w.jobs.map((j) => j.name)).toEqual(["Smith - Shed", "Barn"]);
  });
});

describe("pickedItems and patchItem", () => {
  const w = buildWeekActivity(
    "2026-11-17",
    [
      {
        id: "t1",
        name: "Framing",
        startDate: "2026-11-15",
        endDate: "2026-11-21",
        jobId: "a",
        jobName: "Barn",
      },
    ],
    [
      { id: "d1", name: "Order windows", endDate: "2026-11-17", jobId: "a", jobName: "Barn" },
      { id: "d2", name: "Call", endDate: "2026-11-17", jobId: "b", jobName: "Shed" },
    ],
  );

  it("lists a job's spanning task once, a day across jobs, and a job on a day", () => {
    expect(pickedItems(w, { job: "a", day: null }).map((p) => p.item.id)).toEqual(["t1", "d1"]);
    expect(pickedItems(w, { job: null, day: 2 }).map((p) => p.item.id)).toEqual(["t1", "d1", "d2"]);
    expect(pickedItems(w, { job: "b", day: 2 }).map((p) => p.item.id)).toEqual(["d2"]);
    expect(pickedItems(w, { job: "b", day: 3 })).toEqual([]);
  });

  it("moves, renames and removes an edited to-do", () => {
    const moved = patchItem(w, "todo", "d1", { end: "2026-11-19", name: "Order glass" });
    const a = moved.jobs.find((j) => j.id === "a")!;
    expect(a.days[2].map((i) => i.id)).toEqual(["t1"]);
    expect(a.days[4].map((i) => i.name)).toEqual(["Framing", "Order glass"]);
    expect(a.total).toBe(8);
    expect(patchItem(w, "todo", "d1", { done: true }).jobs.find((j) => j.id === "a")!.total).toBe(7);
    expect(patchItem(w, "todo", "d2", { end: "2026-12-01" }).jobs.find((j) => j.id === "b")!.total).toBe(0);
  });

  it("re-spans an edited task and removes it when done", () => {
    const a = (x: typeof w) => x.jobs.find((j) => j.id === "a")!;
    const moved = patchItem(w, "task", "t1", { start: "2026-11-18", end: "2026-11-19" });
    expect(a(moved).days.map((d) => d.filter((i) => i.id === "t1").length)).toEqual([0, 0, 0, 1, 1, 0, 0]);
    expect(a(patchItem(w, "task", "t1", { done: true })).total).toBe(1);
  });
});

describe("itemEditPatch", () => {
  it("passes only the allowed fields", () => {
    expect(itemEditPatch("task", { name: " Frame ", start: "2026-11-16", end: "2026-11-18", progress: 0.3, id: "x" })).toEqual({
      name: "Frame",
      startDate: "2026-11-16",
      dueDate: "2026-11-18",
    });
    expect(itemEditPatch("todo", { end: "", done: true, description: null })).toEqual({
      dueDate: null,
      done: true,
      description: null,
    });
    expect(itemEditPatch("todo", { start: "2026-11-16" })).toBe("Nothing to change.");
  });

  it("refuses a bad name or bad dates", () => {
    expect(itemEditPatch("todo", { name: "  " })).toBe("It needs a name.");
    expect(itemEditPatch("task", { end: "2026-11-18" })).toBe("A schedule task needs a start and an end.");
    expect(itemEditPatch("task", { start: "2026-11-19", end: "2026-11-18" })).toBe("The start is after the end.");
    expect(itemEditPatch("todo", { end: "11/18/2026" })).toBe("Unreadable date: 11/18/2026");
  });
});

describe("nearness", () => {
  it("is full today and fades away from it", () => {
    expect(nearness(3, 3.5)).toBe(1);
    expect(nearness(4, 3.5)).toBeGreaterThan(nearness(5, 3.5));
    expect(nearness(2, 3.5)).toBeLessThan(nearness(4, 3.5));
  });
  it("sharpens tomorrow as today goes on", () => {
    expect(nearness(4, 3.9)).toBeGreaterThan(nearness(4, 3.1));
  });
});
