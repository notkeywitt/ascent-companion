import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W, placeJobs, project } from "@/lib/lopezMap";

describe("the Lopez map", () => {
  it("projects the island's corners to the map's corners, and drops a point off it", () => {
    expect(project(48.5728118, -122.9455097)).toEqual({ x: 0, y: 0 });
    const se = project(48.4181187, -122.8001947)!;
    expect(se.x).toBeCloseTo(MAP_W);
    expect(se.y).toBeCloseTo(MAP_H);
    expect(project(47.6, -122.3)).toBeNull(); // Seattle
  });

  it("draws one dot per address, in its most important phase", () => {
    const shop = { lat: 48.4938623, lng: -122.8980627 };
    const { places, offMap } = placeJobs([
      { id: "a", name: "Office", phase: "Ascent", ...shop },
      { id: "b", name: "Shop", phase: "Active", ...shop },
      { id: "c", name: "No address", phase: "Active", lat: null, lng: null },
    ]);
    expect(places).toHaveLength(1);
    expect(places[0].phase).toBe("Active");
    expect(places[0].jobs.map((j) => j.id)).toEqual(["a", "b"]);
    expect(offMap).toBe(1);
  });
});
