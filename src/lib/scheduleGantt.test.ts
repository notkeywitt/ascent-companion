import { describe, expect, it } from "vitest";

import { addDays, buildGantt, daysBetween, isDay, mondayOf, monthSpans, windowDays, type GanttTaskIn } from "./scheduleGantt";

const task = (over: Partial<GanttTaskIn>): GanttTaskIn => ({
  id: "t",
  name: "Frame",
  phase: "",
  startDate: "2026-11-02",
  endDate: "2026-11-04",
  progress: null,
  jobId: "j1",
  jobName: "Smith",
  ...over,
});

describe("scheduleGantt dates", () => {
  it("finds the Monday on or before a day", () => {
    expect(mondayOf("2026-11-19")).toBe("2026-11-16"); // a Thursday
    expect(mondayOf("2026-11-16")).toBe("2026-11-16");
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // a Sunday
  });
  it("adds and counts days across a month end", () => {
    expect(addDays("2026-11-29", 3)).toBe("2026-12-02");
    expect(daysBetween("2026-11-29", "2026-12-02")).toBe(3);
  });
  it("accepts only real YYYY-MM-DD days", () => {
    expect(isDay("2026-11-19")).toBe(true);
    expect(isDay("2026-13-40")).toBe(false);
    expect(isDay("tomorrow")).toBe(false);
    expect(isDay(null)).toBe(false);
  });
  it("lists a window's days", () => {
    expect(windowDays("2026-11-16", 3)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"]);
  });
  it("spans months over the window", () => {
    const spans = monthSpans(windowDays("2026-11-28", 5));
    expect(spans.map((s) => [s.start, s.span])).toEqual([
      [0, 3],
      [3, 2],
    ]);
  });
});

describe("buildGantt", () => {
  const from = "2026-11-02";
  it("places a bar by its first and last day, both included", () => {
    const [job] = buildGantt([task({})], new Map(), from, 28);
    expect(job.bars[0].left).toBeCloseTo((0 / 28) * 100);
    expect(job.bars[0].width).toBeCloseTo((3 / 28) * 100);
  });
  it("clips a task that runs past either end", () => {
    const [job] = buildGantt([task({ startDate: "2026-10-30", endDate: "2026-12-10" })], new Map(), from, 28);
    expect(job.bars[0].left).toBe(0);
    expect(job.bars[0].width).toBe(100);
    expect(job.bars[0].clipStart).toBe(true);
    expect(job.bars[0].clipEnd).toBe(true);
  });
  it("drops a task outside the window and a job left with none", () => {
    expect(buildGantt([task({ startDate: "2027-01-05", endDate: "2027-01-06" })], new Map(), from, 28)).toEqual([]);
  });
  it("labels a job with its customer and orders jobs by earliest start", () => {
    const jobs = buildGantt(
      [
        task({ id: "a", jobId: "j2", jobName: "Barn", startDate: "2026-11-10", endDate: "2026-11-11" }),
        task({ id: "b", jobId: "j1", jobName: "Smith", startDate: "2026-11-03", endDate: "2026-11-04" }),
      ],
      new Map([["j1", "Pat Smith"]]),
      from,
      28,
    );
    expect(jobs.map((j) => j.label)).toEqual(["Pat Smith - Smith", "Barn"]);
  });
  it("orders a job's tasks by phase, then position, then start", () => {
    const [job] = buildGantt(
      [
        task({ id: "late", phasePosition: "b", position: "a", startDate: "2026-11-03" }),
        task({ id: "two", phasePosition: "a", position: "b", startDate: "2026-11-03" }),
        task({ id: "one", phasePosition: "a", position: "a", startDate: "2026-11-09" }),
      ],
      new Map(),
      from,
      28,
    );
    expect(job.bars.map((b) => b.task.id)).toEqual(["one", "two", "late"]);
  });
});
