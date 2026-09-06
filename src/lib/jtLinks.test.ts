import { describe, expect, it } from "vitest";
import { jtTimeUrl } from "./jtLinks";

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

  it("ignores a date that is not a calendar day", () => {
    // An ISO instant sliced wrong, or an empty string, must not reach the URL.
    expect(jtTimeUrl({ userId: "u1", from: "2026-08-23T09:15:00Z" })).toBe(
      "https://app.jobtread.com/time?userId=u1",
    );
  });
});
