import { describe, expect, it } from "vitest";
import { Camera3D } from "./camera3d";
import { Flock3D, SIDE } from "./flock3d";

describe("Camera3D", () => {
  it("puts the cube's centre in the middle of the canvas", () => {
    const c = new Camera3D();
    c.w = 900;
    c.h = 600;
    const p = c.project(SIDE / 2, SIDE / 2, SIDE / 2);
    expect(p.sx).toBeCloseTo(450);
    expect(p.sy).toBeCloseTo(300);
  });

  it("sends a pixel back to a point that projects onto the same pixel", () => {
    const c = new Camera3D();
    c.yaw = 1.1;
    c.pitch = -0.4;
    const w = c.unproject(200, 120);
    const p = c.project(w.x, w.y, w.z);
    expect(p.sx).toBeCloseTo(200, 3);
    expect(p.sy).toBeCloseTo(120, 3);
  });

  it("draws nearer points bigger", () => {
    const c = new Camera3D();
    c.yaw = 0;
    c.pitch = 0;
    expect(c.project(500, 500, 900).scale).toBeGreaterThan(c.project(500, 500, 100).scale);
  });
});

describe("Flock3D", () => {
  it("keeps every bird inside the box with walls, and wraps it with wrap", () => {
    const birds = Array.from({ length: 150 }, (_, i) => ({ group: i % 3, size: 0.5 }));
    const f = new Flock3D(birds, { pace: [1, 1, 1], affinity: [] });
    for (let s = 0; s < 300; s++) f.step({ x: 500, y: 500, z: 500 });
    for (let i = 0; i < f.n; i++) {
      for (const v of [f.x[i], f.y[i], f.z[i]]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(SIDE);
      }
    }
    f.wrap = true;
    f.x[0] = SIDE - 1;
    f.vx[0] = 2.5;
    f.vy[0] = 0;
    f.vz[0] = 0;
    f.step();
    expect(f.x[0]).toBeLessThan(20);
  });

  it("lifts a flat picture onto a sheet through the middle of the box", () => {
    const f = new Flock3D([{ group: 0, size: 1 }], { pace: [1], affinity: [] });
    f.fromFlat([300], [100], 600, 400, [1], [0]);
    expect(f.x[0]).toBeCloseTo(SIDE / 2);
    expect(f.y[0]).toBeCloseTo(SIDE * 0.75);
    expect(Math.abs(f.z[0] - SIDE / 2)).toBeLessThan(20);
  });
});
