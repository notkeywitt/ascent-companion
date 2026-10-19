import { describe, expect, it } from "vitest";

import { reviewWindow, scheduledReview } from "./schedule";
import { DEFAULT_SETTINGS } from "./settings";

const CFG = DEFAULT_SETTINGS.schedule;
/** 08:00 UTC — the digest's night firing, 1am Pacific in October. */
const night = (iso: string) => new Date(`${iso}T08:00:00Z`);

describe("the invoicing timeline", () => {
  it("runs nightly from the 11th to send day on the 15th, for last month", () => {
    const days = Array.from({ length: 31 }, (_, i) => i + 1)
      .filter((d) => scheduledReview(night(`2026-10-${String(d).padStart(2, "0")}`), CFG, 10))
      .map((d) => d);
    expect(days).toEqual([5, 8, 11, 12, 13, 14, 15]);
    expect(scheduledReview(night("2026-10-11"), CFG, 10)).toMatchObject({
      ym: "2026-09",
      phase: "cutoff",
      sendDate: "2026-10-15",
      daysToSend: 4,
    });
    expect(scheduledReview(night("2026-10-15"), CFG, 10)?.phase).toBe("send-day");
    expect(scheduledReview(night("2026-10-05"), CFG, 10)?.phase).toBe("early");
  });

  it("reviews December in January", () => {
    expect(scheduledReview(night("2027-01-12"), CFG, 10)).toMatchObject({ ym: "2026-12", phase: "daily" });
  });

  it("reads the date in Pacific time, not UTC", () => {
    // 05:00 UTC on the 11th is still the 10th in Lopez — cutoff day, no run.
    expect(scheduledReview(new Date("2026-10-11T05:00:00Z"), CFG, 10)).toBeNull();
  });

  it("keeps the countdown visible on days with no run, and goes quiet after send day", () => {
    expect(reviewWindow(night("2026-10-03"), CFG, 10)).toMatchObject({ due: false, daysToSend: 12 });
    expect(reviewWindow(night("2026-10-16"), CFG, 10)).toBeNull();
  });

  it("does nothing when switched off", () => {
    expect(scheduledReview(night("2026-10-12"), { ...CFG, enabled: false }, 10)).toBeNull();
  });
});
