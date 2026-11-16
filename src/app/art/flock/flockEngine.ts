import type { CloudSetId } from "@/lib/art/cloud";
import { divisionOf, type ArtBillRow, type ArtBudgetRow, type ArtTimeRow } from "@/lib/art/rows";
import {
  aliveAt,
  clockLabel,
  Flock,
  flockSetup,
  loopDays,
  monthTicks,
  OTHER,
  yearClock,
  type FlockItem,
  type FlockSetup,
  type YearClock,
} from "@/lib/art/flock";
import type { DrawFrame } from "../artKit";

/**
 * The Job Flock's engine: the simulation, its trails, the year clock and the
 * drawing, in one object that lives across frames. The Job Flock page and the
 * desktop screen saver (src/components/FlockSaver.tsx) both drive one.
 * Not React: a page keeps it in a ref and calls `draw` from ArtCanvas.
 */

export type FlockBy = "job" | "division" | "vendor" | "type" | "person";

export const FLOCK_BY: Record<CloudSetId, { value: FlockBy; label: string }[]> = {
  bills: [
    { value: "job", label: "Job" },
    { value: "vendor", label: "Vendor" },
    { value: "division", label: "Division" },
    { value: "type", label: "Cost type" },
  ],
  labor: [
    { value: "job", label: "Job" },
    { value: "person", label: "Person" },
    { value: "division", label: "Division" },
  ],
  budget: [
    { value: "job", label: "Job" },
    { value: "division", label: "Division" },
    { value: "type", label: "Cost type" },
  ],
};

export function flockItems(set: CloudSetId, rows: unknown[], by: FlockBy): FlockItem[] {
  if (set === "bills") {
    return (rows as ArtBillRow[]).map((r) => {
      const key = by === "vendor" ? r.vendor : by === "division" ? `Div ${divisionOf(r.code)}` : by === "type" ? r.type : r.job;
      return { key: key || "None", link: by === "job" ? r.vendor : r.job, value: r.cost, date: r.date };
    });
  }
  if (set === "labor") {
    return (rows as ArtTimeRow[]).map((r) => {
      const key = by === "person" ? r.person : by === "division" ? `Div ${divisionOf(r.code)}` : r.job;
      return { key, link: by === "job" ? r.person : r.job, value: r.hours, date: r.start.slice(0, 10) };
    });
  }
  return (rows as ArtBudgetRow[]).map((r) => {
    const key = by === "division" ? `Div ${divisionOf(r.code)}` : by === "type" ? r.type : r.job;
    return { key, link: by === "job" ? divisionOf(r.code) : r.job, value: r.cost, date: "" };
  });
}

const TRAIL = 7;
const SETTLE_STEPS = 500;
/** Opacity steps a group's birds are drawn in, so each is one fill. */
const BUCKETS = 4;

export class FlockEngine {
  setup: FlockSetup | null = null;
  flock: Flock | null = null;
  clock: YearClock | null = null;
  /** Year mode on, and how long one loop of the year takes. */
  year = false;
  loopMs = 120_000;
  /** Days into the clock, while the year runs. */
  t = 0;
  focus: number | null = null;
  /** Show the timeline (a line and a playhead) along the bottom. */
  timeline = true;
  /** Write the months and the date on the picture. */
  timelineText = true;
  /** Draw each flock's name at its centre. */
  labels = true;

  private rows: unknown = null;
  /** Bumped when the rows change; the flock is rebuilt when it lags. */
  private gen = 0;
  private flockGen = -1;
  private shownSetup: FlockSetup | null = null;
  private trail: Float32Array | null = null;
  private trailAt = 0;
  private hawk: { x: number; y: number; until: number } | null = null;
  private lastNow = 0;
  private targets: Float32Array<ArrayBuffer> | null = null;
  private frames = 0;

  /** New rows or a new grouping. Same rows re-group the birds in place. */
  setData(set: CloudSetId, rows: unknown[], by: FlockBy) {
    const items = flockItems(set, rows, by);
    this.setup = flockSetup(items);
    if (this.rows !== rows) {
      this.clock = yearClock(items);
      this.rows = rows;
      this.gen++;
      // Open on the middle of the work, not its thin first days.
      const dated = Array.from(this.clock.days)
        .filter((d) => !Number.isNaN(d))
        .sort((a, b) => a - b);
      if (dated.length) this.t = dated[Math.floor(dated.length / 2)];
    }
  }

  /** The pointer, as a hawk, for a moment. */
  poke(x: number, y: number, ms = 1200) {
    this.hawk = { x, y, until: performance.now() + ms };
  }
  calm() {
    this.hawk = null;
  }

  /** The flock nearest (x, y) within 60px, or -1. */
  groupAt(x: number, y: number): number {
    const f = this.flock;
    if (!f || !this.setup) return -1;
    let best = -1;
    let bd = 60 * 60;
    for (let g = 0; g < this.setup.names.length; g++) {
      if (!f.count[g]) continue;
      const d = (f.cx[g] - x) ** 2 + (f.cy[g] - y) ** 2;
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  /** The month on the clock, when the year runs. */
  label(): string {
    return this.year && this.clock ? clockLabel(this.clock, this.t) : "";
  }

  draw = (f: DrawFrame) => {
    const { ctx, w, h, colors, ink, quiet, reduced, now } = f;
    const setup = this.setup;
    if (!setup) return;
    const dt = this.lastNow ? Math.min(100, now - this.lastNow) : 16;
    this.lastNow = now;

    // Build, re-group or replace the flock.
    let flock = this.flock;
    if (!flock || this.flockGen !== this.gen) {
      this.flockGen = this.gen;
      const fresh = new Flock(setup.birds, setup.params, w, h);
      if (flock) fresh.inherit(flock);
      flock = this.flock = fresh;
      this.trail = null;
      if (reduced) for (let s = 0; s < SETTLE_STEPS; s++) fresh.step();
    } else if (this.shownSetup !== setup) {
      flock.regroup(
        setup.birds.map((b) => b.group),
        setup.params,
      );
      if (reduced) for (let s = 0; s < SETTLE_STEPS; s++) flock.step();
    }
    this.shownSetup = setup;
    flock.resize(w, h);

    // The year: move the clock, set who is alive, and let each flock's pace
    // follow how many of its birds are alive now.
    const clock = this.clock;
    const yearOn = this.year && !!clock && clock.span > 0;
    if (yearOn && clock) {
      // Through a thin stretch the clock hurries: ten times with no bird
      // alive, four times with only a handful.
      let alive = 0;
      if (this.targets) for (let i = 0; i < this.targets.length && alive < 12; i++) if (this.targets[i] > 0) alive++;
      const rate = !this.targets ? 1 : alive === 0 ? 10 : alive < 12 ? 4 : 1;
      if (!reduced) this.t = (this.t + ((dt * rate) / this.loopMs) * loopDays(clock)) % loopDays(clock);
      this.targets = aliveAt(clock, this.t, this.targets ?? undefined);
      flock.setTargets(this.targets);
      if (this.frames++ % 20 === 0) {
        const max = Math.max(1, ...Array.from(flock.count));
        flock.params = {
          ...flock.params,
          pace: setup.params.pace.map((_, g) => 0.6 + flock!.count[g] / max),
        };
      }
    } else if (flock.target[0] !== 1 || flock.params !== setup.params) {
      flock.allAlive();
      flock.params = setup.params;
    }

    if (!reduced) flock.step(this.hawk && this.hawk.until > now ? this.hawk : null);
    else if (yearOn) flock.step(null);

    // Trails: a ring of the last few positions per bird.
    const n = flock.n;
    if (!this.trail || this.trail.length !== n * TRAIL * 2) {
      this.trail = new Float32Array(n * TRAIL * 2);
      for (let k = 0; k < TRAIL; k++) {
        for (let i = 0; i < n; i++) {
          this.trail[(k * n + i) * 2] = flock.x[i];
          this.trail[(k * n + i) * 2 + 1] = flock.y[i];
        }
      }
    }
    const tr = this.trail;
    const slot = this.trailAt;
    for (let i = 0; i < n; i++) {
      // A bird just born starts with no trail, not a streak from where it died.
      const from = flock.born[i] ? 0 : slot;
      const to = flock.born[i] ? TRAIL - 1 : slot;
      for (let k = from; k <= to; k++) {
        tr[(k * n + i) * 2] = flock.x[i];
        tr[(k * n + i) * 2 + 1] = flock.y[i];
      }
    }
    this.trailAt = (slot + 1) % TRAIL;

    const G = setup.names.length;
    const colorOf = (g: number) => (setup.names[g] === OTHER ? quiet : colors[g % colors.length]);
    const alphaOf = (g: number) => (this.focus === null || this.focus === g ? 1 : 0.12);
    const bucketOf = (i: number) => Math.min(BUCKETS - 1, Math.floor(flock!.alpha[i] * BUCKETS));

    for (let g = 0; g < G; g++) {
      const col = colorOf(g);
      for (let b = 0; b < BUCKETS; b++) {
        const a = alphaOf(g) * ((b + 1) / BUCKETS);
        if (!reduced) {
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.22 * a;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            if (flock.group[i] !== g || !flock.live[i] || bucketOf(i) !== b) continue;
            for (let k = 1; k <= TRAIL; k++) {
              const s = (slot + k) % TRAIL;
              const px = tr[(s * n + i) * 2];
              const py = tr[(s * n + i) * 2 + 1];
              if (k === 1) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
          }
          ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.9 * a;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (flock.group[i] !== g || !flock.live[i] || bucketOf(i) !== b) continue;
          const sp = Math.hypot(flock.vx[i], flock.vy[i]) || 1;
          const ux = flock.vx[i] / sp;
          const uy = flock.vy[i] / sp;
          const L = 3 + flock.size[i] * 4;
          const W = 1.2 + flock.size[i] * 1.6;
          const x = flock.x[i];
          const y = flock.y[i];
          ctx.moveTo(x + ux * L, y + uy * L);
          ctx.lineTo(x - ux * L * 0.6 - uy * W, y - uy * L * 0.6 + ux * W);
          ctx.lineTo(x - ux * L * 0.6 + uy * W, y - uy * L * 0.6 - ux * W);
          ctx.closePath();
        }
        ctx.fill();
      }
    }

    if (this.labels) {
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = ink;
      for (let g = 0; g < G; g++) {
        if (setup.names[g] === OTHER || flock.count[g] < 8) continue;
        ctx.globalAlpha = 0.6 * alphaOf(g);
        ctx.fillText(setup.names[g].slice(0, 24), flock.cx[g], flock.cy[g] - 10);
      }
    }

    // The year's timeline: month ticks, the playhead and the month.
    if (yearOn && clock && this.timeline) {
      const pad = 18;
      const y0 = h - 16;
      const span = loopDays(clock);
      const xOf = (d: number) => pad + (d / span) * (w - 2 * pad);
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, y0);
      ctx.lineTo(w - pad, y0);
      ctx.stroke();
      ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = quiet;
      ctx.globalAlpha = 0.8;
      for (const [d, m] of monthTicks(clock)) {
        const x = xOf(d);
        ctx.fillRect(x, y0 - 3, 1, 6);
        if (this.timelineText) ctx.fillText(m, x, y0 + 12);
      }
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = ink;
      const px = xOf(this.t);
      ctx.beginPath();
      ctx.arc(px, y0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (this.timelineText) {
        ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.globalAlpha = 0.55;
        ctx.fillText(clockLabel(clock, this.t), pad, 24);
      }
    }
    ctx.globalAlpha = 1;
  };
}
