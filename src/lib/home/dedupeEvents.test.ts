import { describe, expect, it } from "vitest";
import { dedupeEvents } from "./dedupeEvents";

describe("dedupeEvents", () => {
  it("keeps one copy of an event on two calendars", () => {
    const a = { title: "Site walk", start: "09:00", startLabel: "9:00", endLabel: "10:00" };
    expect(dedupeEvents([a, { ...a }, { ...a, title: "Other" }])).toHaveLength(2);
    expect(dedupeEvents([{ iCalUID: "x", title: "A" }, { iCalUID: "x", title: "B" }])).toHaveLength(1);
  });
});
