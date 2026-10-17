import { describe, expect, it } from "vitest";

import { metersToMiles, parseLatLng, routeWaypoint, tripMiles } from "./mileageRoute";

describe("routeWaypoint", () => {
  it("sends coordinates as a latLng", () => {
    expect(routeWaypoint("48.53, -123.01")).toEqual({
      location: { latLng: { latitude: 48.53, longitude: -123.01 } },
    });
  });

  it("sends anything else as an address", () => {
    expect(routeWaypoint("  100 Spring St, Friday Harbor, WA ")).toEqual({
      address: "100 Spring St, Friday Harbor, WA",
    });
  });

  it("treats out-of-range numbers as an address", () => {
    expect(routeWaypoint("123,456")).toEqual({ address: "123,456" });
  });
});

describe("parseLatLng", () => {
  it("reads a point, or null for an address", () => {
    expect(parseLatLng("48.5,-122.9")).toEqual({ lat: 48.5, lng: -122.9 });
    expect(parseLatLng("Friday Harbor")).toBeNull();
  });
});

describe("metersToMiles", () => {
  it("converts meters to miles at one decimal", () => {
    expect(metersToMiles(16093.44)).toBe(10);
    expect(metersToMiles(20000)).toBe(12.4);
  });
});

describe("tripMiles", () => {
  it("keeps a one-way trip and doubles a round trip", () => {
    expect(tripMiles(12.4, false)).toBe(12.4);
    expect(tripMiles(12.4, true)).toBe(24.8);
  });
});
