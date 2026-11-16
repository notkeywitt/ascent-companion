import { describe, expect, it } from "vitest";
import {
  aliveAt,
  clockLabel,
  Flock,
  flockSetup,
  LIFE_DAYS,
  loopDays,
  MAX_GROUPS,
  monthTicks,
  OTHER,
  yearClock,
  type FlockItem,
} from "./flock";

const spread = (f: Flock, g: number) => {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < f.n; i++) if (f.group[i] === g) (sx += f.x[i]), (sy += f.y[i]), n++;
  const mx = sx / n;
  const my = sy / n;
  let d = 0;
  for (let i = 0; i < f.n; i++) if (f.group[i] === g) d += Math.hypot(f.x[i] - mx, f.y[i] - my);
  return d / n;
};

describe("Flock", () => {
  it("gathers a scattered group into a tighter flock and keeps every bird on screen", () => {
    const birds = Array.from({ length: 120 }, (_, i) => ({ group: i % 2, size: 0.5 }));
    const f = new Flock(birds, { pace: [1, 1], affinity: [[0, 0], [0, 0]] }, 600, 400);
    const before = spread(f, 0);
    for (let s = 0; s < 600; s++) f.step();
    expect(spread(f, 0)).toBeLessThan(before);
    for (let i = 0; i < f.n; i++) {
      expect(f.x[i]).toBeGreaterThanOrEqual(0);
      expect(f.x[i]).toBeLessThanOrEqual(600);
      expect(f.y[i]).toBeGreaterThanOrEqual(0);
      expect(f.y[i]).toBeLessThanOrEqual(400);
    }
  });

  it("never lets a bird fly faster than its group's pace allows", () => {
    const f = new Flock([{ group: 0, size: 1 }, { group: 1, size: 1 }], { pace: [0.6, 1.6], affinity: [] }, 300, 300);
    for (let s = 0; s < 50; s++) f.step({ x: 150, y: 150 });
    expect(Math.hypot(f.vx[0], f.vy[0])).toBeLessThanOrEqual(1.6 * 0.6 + 1e-4);
    expect(Math.hypot(f.vx[1], f.vy[1])).toBeLessThanOrEqual(1.6 * 1.6 + 1e-4);
  });
});

describe("flockSetup", () => {
  it("folds groups past the limit into Other, biggest first", () => {
    const items: FlockItem[] = Array.from({ length: 20 }, (_, i) => ({
      key: `job ${i}`,
      link: "v",
      value: 100 - i,
      date: "",
    }));
    const s = flockSetup(items);
    expect(s.names).toHaveLength(MAX_GROUPS);
    expect(s.names[0]).toBe("job 0");
    expect(s.names[MAX_GROUPS - 1]).toBe(OTHER);
    expect(s.params.pace.every((p) => p === 1)).toBe(true);
  });

  it("links two groups that share a vendor, and gives a busy group more pace", () => {
    const s = flockSetup([
      { key: "A", link: "v1", value: 10, date: "2026-11-01" },
      { key: "B", link: "v1", value: 10, date: "2026-01-01" },
      { key: "C", link: "v2", value: 10, date: "2026-01-01" },
    ]);
    const [a, b, c] = ["A", "B", "C"].map((k) => s.names.indexOf(k));
    expect(s.params.affinity[a][b]).toBe(1);
    expect(s.params.affinity[a][c]).toBe(0);
    expect(s.params.pace[a]).toBeGreaterThan(s.params.pace[b]);
  });
});

describe("the year", () => {
  const items = [{ date: "2026-03-01" }, { date: "2026-06-01" }, { date: "" }];
  const clock = yearClock(items);

  it("measures days from the first dated row, and leaves undated rows undated", () => {
    expect(clock.days[0]).toBe(0);
    expect(clock.days[1]).toBe(92);
    expect(Number.isNaN(clock.days[2])).toBe(true);
    expect(loopDays(clock)).toBe(92 + LIFE_DAYS);
  });

  it("keeps a bird alive for LIFE_DAYS from its date, and an undated one always", () => {
    expect(Array.from(aliveAt(clock, 10))).toEqual([1, 0, 1]);
    expect(Array.from(aliveAt(clock, LIFE_DAYS + 1))).toEqual([0, 0, 1]);
    expect(Array.from(aliveAt(clock, 95))).toEqual([0, 1, 1]);
  });

  it("names the month on the clock and ticks each month start", () => {
    expect(clockLabel(clock, 92)).toBe("Jun 2026");
    expect(monthTicks(clock).map(([, m]) => m)).toEqual(["Apr", "May", "Jun", "Jul"]);
  });

  it("gives birth beside the bird's own flock, and leaves the dead out of the count", () => {
    const birds = Array.from({ length: 40 }, (_, i) => ({ group: i < 30 ? 0 : 1, size: 0.5 }));
    const f = new Flock(birds, { pace: [1, 1], affinity: [] }, 800, 600);
    for (let s = 0; s < 200; s++) f.step();
    const targets = birds.map((_, i) => (i === 0 ? 0 : 1));
    f.setTargets(targets);
    for (let s = 0; s < 120; s++) f.step();
    expect(f.live[0]).toBe(0);
    expect(f.count[0]).toBe(29);
    f.setTargets(birds.map(() => 1));
    f.step();
    expect(f.live[0]).toBe(1);
    expect(Math.hypot(f.x[0] - f.cx[0], f.y[0] - f.cy[0])).toBeLessThan(60);
  });
});

describe("wrap-around edges", () => {
  it("brings a bird that leaves one edge back in at the other", () => {
    const f = new Flock([{ group: 0, size: 1 }], { pace: [1], affinity: [] }, 400, 300);
    f.wrap = true;
    f.x[0] = 399;
    f.y[0] = 150;
    f.vx[0] = 1.5;
    f.vy[0] = 0;
    f.step();
    expect(f.x[0]).toBeLessThan(10);
  });

  it("keeps a flock that straddles an edge as one flock, centred on the edge", () => {
    const birds = Array.from({ length: 20 }, () => ({ group: 0, size: 0.5 }));
    const f = new Flock(birds, { pace: [1], affinity: [] }, 400, 300);
    f.wrap = true;
    for (let i = 0; i < 20; i++) {
      f.x[i] = i % 2 ? 395 : 5;
      f.y[i] = 150;
    }
    f.step();
    // A plain mean would say 200, the middle of the screen.
    expect(Math.min(f.cx[0], 400 - f.cx[0])).toBeLessThan(20);
  });
});
