import { describe, expect, it } from "vitest";
import { jtBudgetUrl, jtJobUrl, jtScheduleUrl, jtTimeUrl } from "./jtLinks";

/* The param names are the owner's, copied from a real filtered JobTread address
   bar (2026-09-06). This suite pins them: a rename here is a silently wrong
   page, not a failure anyone would see. */
describe("jtTimeUrl", () => {
  it("narrows to one person on one day", () => {
    expect(jtTimeUrl({ userId: "22PXG7QbuaEr", from: "2026-08-23", to: "2026-08-23" })).toBe(
      "https://app.jobtread.com/time?userId=22PXG7QbuaEr&startDate=2026-08-23&endDate=2026-08-23",
    );
  });

  it("keeps a span when the selection covers several days", () => {
    expect(jtTimeUrl({ userId: "22PXG7QbuaEr", from: "2026-08-23", to: "2026-08-29" })).toBe(
      "https://app.jobtread.com/time?userId=22PXG7QbuaEr&startDate=2026-08-23&endDate=2026-08-29",
    );
  });

  it("reads a lone day as that day, not an open range", () => {
    expect(jtTimeUrl({ userId: "u1", from: "2026-08-23" })).toBe(
      "https://app.jobtread.com/time?userId=u1&startDate=2026-08-23&endDate=2026-08-23",
    );
  });

  it("drops a filter it has no value for", () => {
    expect(jtTimeUrl({ from: "2026-08-23", to: "2026-08-23" })).toBe(
      "https://app.jobtread.com/time?startDate=2026-08-23&endDate=2026-08-23",
    );
    expect(jtTimeUrl({ userId: "u1" })).toBe("https://app.jobtread.com/time?userId=u1");
    expect(jtTimeUrl()).toBe("https://app.jobtread.com/time");
  });

  it("opens one entry, on that person's list", () => {
    // The owner's own address, verbatim (2026-09-08).
    expect(jtTimeUrl({ userId: "22Pbh8yNT5nK", entryId: "22PdvvExRzQK" })).toBe(
      "https://app.jobtread.com/time?userId=22Pbh8yNT5nK&timeEntryId=22PdvvExRzQK",
    );
  });

  it("ignores a date that is not a calendar day", () => {
    // An ISO instant sliced wrong, or an empty string, must not reach the URL.
    expect(jtTimeUrl({ userId: "u1", from: "2026-08-23T09:15:00Z" })).toBe(
      "https://app.jobtread.com/time?userId=u1",
    );
  });
});

/* The job-page shapes are the owner's too (2026-09-06): a schedule row deep-
   links with `?taskId=`, and the budget page takes no confirmed per-code param. */
describe("job pages", () => {
  const JOB = "22PXejdnU4hm";

  it("points a schedule row at that task", () => {
    expect(jtScheduleUrl(JOB, "22PY5id5uLWs")).toBe(
      "https://app.jobtread.com/jobs/22PXejdnU4hm/schedule?taskId=22PY5id5uLWs",
    );
  });

  it("falls back to the whole schedule with no task", () => {
    const whole = "https://app.jobtread.com/jobs/22PXejdnU4hm/schedule";
    expect(jtScheduleUrl(JOB)).toBe(whole);
    expect(jtScheduleUrl(JOB, null)).toBe(whole);
    expect(jtScheduleUrl(JOB, "  ")).toBe(whole);
  });

  it("has one shape for the job and its budget", () => {
    expect(jtJobUrl(JOB)).toBe("https://app.jobtread.com/jobs/22PXejdnU4hm");
    expect(jtBudgetUrl(JOB)).toBe("https://app.jobtread.com/jobs/22PXejdnU4hm/budget");
  });
});
