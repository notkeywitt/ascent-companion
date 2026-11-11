import { describe, expect, it } from "vitest";

import { haversineKm, nearestSite } from "./nearestSite";

const shop = { id: "s", label: "Ascent - Shop", lat: 48.5, lng: -122.9 };
const office = { id: "o", label: "Ascent - Office", lat: 48.5, lng: -122.9 };
const job = { id: "j", label: "Smith - House", lat: 48.52, lng: -122.9 };

describe("nearestSite", () => {
  it("prefers the Shop among sites at one address", () => {
    expect(nearestSite([office, shop, job], { lat: 48.5, lng: -122.9 })?.site.id).toBe("s");
  });
  it("picks the nearest job", () => {
    expect(nearestSite([office, shop, job], { lat: 48.521, lng: -122.9 })?.site.id).toBe("j");
  });
  it("returns null past the limit or with no coordinates", () => {
    expect(nearestSite([job], { lat: 48.6, lng: -122.9 }, 1)).toBeNull();
    expect(nearestSite([{ id: "x", label: "x", lat: null, lng: null }], { lat: 0, lng: 0 })).toBeNull();
  });
  it("measures km", () => {
    expect(haversineKm({ lat: 48.5, lng: -122.9 }, { lat: 48.52, lng: -122.9 })).toBeCloseTo(2.22, 1);
  });
});
