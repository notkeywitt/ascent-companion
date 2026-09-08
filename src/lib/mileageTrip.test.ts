import { describe, expect, it } from "vitest";

import { isStale, parseTrip, pickTrip, type ActiveTrip } from "./mileageTrip";

const base = {
  tripKey: "k1",
  startLat: 48.5,
  startLng: -122.9,
  startTime: "2026-09-08T15:00:00.000Z",
  driver: "Sam",
  jobId: "j1",
  jobLabel: "Harper - Remodel",
  purpose: "material pickup",
  waypoints: [{ lat: 48.51, lng: -122.91, time: "2026-09-08T15:10:00.000Z" }],
  trail: [],
  savedAt: "2026-09-08T15:10:00.000Z",
};

describe("parseTrip", () => {
  it("keeps a complete trip", () => {
    expect(parseTrip(base)).toEqual(base);
  });

  it("restores a trip written by an older build (no savedAt, no trail)", () => {
    const t = parseTrip({ startLat: 48.5, startLng: -122.9, startTime: base.startTime });
    expect(t?.savedAt).toBe(base.startTime);
    expect(t?.trail).toEqual([]);
    expect(t?.tripKey).toBe("");
  });

  it("rejects anything without a usable start point", () => {
    expect(parseTrip(null)).toBeNull();
    expect(parseTrip({ startLat: 48.5, startTime: base.startTime })).toBeNull();
    expect(parseTrip({ ...base, startTime: "not a date" })).toBeNull();
  });

  it("drops junk points instead of the whole trip", () => {
    const t = parseTrip({ ...base, waypoints: [{ lat: "x", lng: 1 }, base.waypoints[0]] });
    expect(t?.waypoints).toEqual(base.waypoints);
  });
});

describe("pickTrip", () => {
  const later: ActiveTrip = { ...base, tripKey: "k2", startTime: "2026-09-08T17:00:00.000Z" };

  it("takes whichever copy exists", () => {
    expect(pickTrip(base, null)).toBe(base);
    expect(pickTrip(null, base)).toBe(base);
    expect(pickTrip(null, null)).toBeNull();
  });

  it("takes the later start", () => {
    expect(pickTrip(base, later)).toBe(later);
    expect(pickTrip(later, base)).toBe(later);
  });

  it("keeps the local copy on a tie — local is never behind on this device", () => {
    const server = { ...base, tripKey: "k3" };
    expect(pickTrip(base, server)).toBe(base);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-09-08T18:00:00.000Z");

  it("is quiet about a trip started hours ago", () => {
    expect(isStale(base.startTime, now)).toBe(false);
  });

  it("flags a trip left open overnight", () => {
    expect(isStale("2026-09-07T18:00:00.000Z", now)).toBe(true);
  });

  it("says no to an unreadable time", () => {
    expect(isStale("", now)).toBe(false);
  });
});
