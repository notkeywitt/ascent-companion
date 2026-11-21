import { describe, expect, it } from "vitest";
import { project } from "@/lib/lopezMap";
import { roadPath } from "@/lib/lopezRoute";

describe("the Lopez road path", () => {
  it("follows the roads from the village to the south end", () => {
    const a = project(48.5165, -122.9135)!; // Lopez Village
    const b = project(48.4405, -122.8265)!; // Mackaye Harbor area
    const path = roadPath(a, b);
    expect(path[0]).toEqual(a);
    expect(path[path.length - 1]).toEqual(b);
    expect(path.length).toBeGreaterThan(20); // a road line, not a straight one
    const len = path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0);
    const straight = Math.hypot(b.x - a.x, b.y - a.y);
    expect(len).toBeGreaterThanOrEqual(straight);
    expect(len).toBeLessThan(straight * 2.5);
  });
});

describe("a start beside a lone road stub", () => {
  it("still finds a road line", () => {
    const a = project(48.4705, -122.9282)!;
    const b = project(48.522, -122.928)!;
    expect(roadPath(a, b).length).toBeGreaterThan(10);
  });
});
