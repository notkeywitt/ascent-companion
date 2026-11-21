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
import { Camera3D, TankCamera, tankSize } from "@/lib/art/camera3d";
import { Flock3D, SIDE } from "@/lib/art/flock3d";
import type { DrawFrame } from "../artKit";

/**
 * The Job Flock's engine: the simulation, the year clock and the
 * drawing, in one object that lives across frames. The Job Flock page and the
 * desktop screen saver (src/components/FlockSaver.tsx) both drive one.
 * Not React: a page keeps it in a ref and calls `draw` from ArtCanvas.
 *
 * Three spaces. Flat: the 2-D flock (src/lib/art/flock.ts) in canvas pixels.
 * 3D: the flock in a cube (flock3d.ts), seen through an orbit camera
 * (camera3d.ts) that turns slowly on its own, and by drag and wheel. Tank: the
 * same 3D flock in a wide, shallow box seen straight on, like a fish tank
 * (TankCamera): depth shows as size, fog and a slow sway of the eye. All are
 * reduced each frame to the same screen arrays (place, heading, size, fade),
 * and one drawing routine draws either. Switching space keeps every bird
 * where it appears: flat → 3D lifts the picture onto a sheet in the box and
 * tilts the camera back; 3D → flat starts each bird at its projected place.
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

const SETTLE_STEPS = 500;
/** Opacity steps a group's birds are drawn in, so each is one fill. */
const BUCKETS = 4;
/** Hue steps within a flock's colour; a bird's `shade` picks one. */
const SHADES = 5;
/** The widest hue shift either way, in degrees, and the lightness shift, in %. */
const HUE_SPREAD = 18;
const LIGHT_SPREAD = 5;

/** "#rrggbb", "#rgb" or "rgb(r, g, b)" → [h 0..360, s 0..100, l 0..100]. */
function hslOf(c: string): [number, number, number] | null {
  const t = c.trim();
  let rgb: number[] | null = null;
  const hex = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const v = hex[1].length === 3 ? hex[1].split("").map((x) => x + x).join("") : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  } else {
    const m = t.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l * 100];
  const sat = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, sat * 100, l * 100];
}

const shadeCache = new Map<string, string[]>();
/** A flock's colour in SHADES steps of hue, from one side of it to the other. */
function shadesOf(c: string): string[] {
  const hit = shadeCache.get(c);
  if (hit) return hit;
  const hsl = hslOf(c);
  const out = Array.from({ length: SHADES }, (_, k) => {
    if (!hsl) return c;
    const f = (k / (SHADES - 1)) * 2 - 1;
    const h = (hsl[0] + f * HUE_SPREAD + 360) % 360;
    const l = Math.max(8, Math.min(92, hsl[2] + f * LIGHT_SPREAD));
    return `hsl(${h.toFixed(1)}, ${hsl[1].toFixed(1)}%, ${l.toFixed(1)}%)`;
  });
  // A colour fade makes a new colour every frame; keep the cache small.
  if (shadeCache.size > 64) shadeCache.clear();
  shadeCache.set(c, out);
  return out;
}

export type FlockSpace = "flat" | "3d" | "tank";

/** A camera that has not been touched for this long starts orbiting again. */
const IDLE_ORBIT_MS = 4000;

export class FlockEngine {
  setup: FlockSetup | null = null;
  flock: Flock | null = null;
  flock3: Flock3D | null = null;
  camera = new Camera3D();
  tank = new TankCamera();
  clock: YearClock | null = null;
  space: FlockSpace = "flat";
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
  /** Edges wrap around instead of turning birds back. */
  wrap = false;
  /** Draw each flock's name at its centre. */
  labels = true;

  private rows: unknown = null;
  /** Bumped when the rows change; the flock is rebuilt when it lags. */
  private gen = 0;
  private flockGen = -1;
  private shownSetup: FlockSetup | null = null;
  private hawk: { x: number; y: number; until: number } | null = null;
  private lastNow = 0;
  private targets: Float32Array<ArrayBuffer> | null = null;
  private frames = 0;
  private touched = 0;
  /** The camera's tilt eases toward this after a switch into 3D. */
  private pitchTo: number | null = null;
  // Screen arrays, refilled each frame.
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private hx = new Float32Array(0);
  private hy = new Float32Array(0);
  private sc = new Float32Array(0);
  private fade = new Float32Array(0);
  private gsx = new Float32Array(0);
  private gsy = new Float32Array(0);

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

  /** Turn the 3D camera by a drag of (dx, dy) pixels. */
  drag(dx: number, dy: number) {
    this.touched = performance.now();
    this.pitchTo = null;
    this.camera.orbit(dx * 0.006, dy * 0.006);
  }

  /** Zoom the 3D camera; a wheel's deltaY. */
  wheel(dy: number) {
    this.touched = performance.now();
    this.camera.zoom(Math.exp(dy * 0.0012));
  }

  /** The flock nearest (x, y) on screen within 60px, or -1. */
  groupAt(x: number, y: number): number {
    if (!this.setup || !this.gsx.length) return -1;
    const count = this.sim()?.count;
    let best = -1;
    let bd = 60 * 60;
    for (let g = 0; g < this.setup.names.length; g++) {
      if (!count?.[g]) continue;
      const d = (this.gsx[g] - x) ** 2 + (this.gsy[g] - y) ** 2;
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

  /** The simulation now running. */
  private sim(): Flock | Flock3D | null {
    return this.space === "flat" ? this.flock : this.flock3;
  }

  /** The box this space wants: a cube, or the tank for a canvas of w × h. */
  private fitBox(f: Flock3D, w: number, h: number) {
    if (this.space === "tank") {
      const t = tankSize(w, h);
      f.resize(t.sx, t.sy, t.sz);
    } else {
      f.resize(SIDE, SIDE, SIDE);
    }
  }

  /** Make sure the right simulation exists for the space, the rows and the grouping. */
  private ensure(setup: FlockSetup, w: number, h: number, reduced: boolean) {
    const settle = (f: Flock | Flock3D) => {
      if (reduced) for (let s = 0; s < SETTLE_STEPS; s++) f.step();
    };
    if (this.space !== "flat") {
      if (!this.flock3 || this.flockGen !== this.gen) {
        const fresh = new Flock3D(setup.birds, setup.params);
        this.fitBox(fresh, w, h);
        if (this.flock3) fresh.inherit(this.flock3);
        else if (this.flock) {
          // Lift the flat picture into the box, seen face-on, then tilt back.
          const f = this.flock;
          fresh.fromFlat(f.x, f.y, f.w, f.h, f.vx, f.vy);
          if (this.space === "3d") {
            this.camera.yaw = 0;
            this.camera.pitch = 0;
            this.pitchTo = 0.32;
            this.touched = 0;
          }
        }
        this.flock3 = fresh;
        this.flock = null;
        this.flockGen = this.gen;
        settle(fresh);
      } else {
        if (this.shownSetup !== setup) {
          this.flock3.regroup(
            setup.birds.map((b) => b.group),
            setup.params,
          );
          settle(this.flock3);
        }
        // Cube ↔ tank: every bird keeps its place as a share of the box.
        this.fitBox(this.flock3, w, h);
      }
    } else {
      if (!this.flock || this.flockGen !== this.gen) {
        const fresh = new Flock(setup.birds, setup.params, w, h);
        if (this.flock) fresh.inherit(this.flock);
        else if (this.flock3 && this.sx.length) {
          // Start each bird where it appeared in 3D.
          const f3 = this.flock3;
          for (let i = 0; i < fresh.n && i < f3.n; i++) {
            fresh.x[i] = Math.max(0, Math.min(w, this.sx[i]));
            fresh.y[i] = Math.max(0, Math.min(h, this.sy[i]));
            fresh.vx[i] = this.hx[i] * 1.4;
            fresh.vy[i] = this.hy[i] * 1.4;
          }
        }
        this.flock = fresh;
        this.flock3 = null;
        this.flockGen = this.gen;
        settle(fresh);
      } else if (this.shownSetup !== setup) {
        this.flock.regroup(
          setup.birds.map((b) => b.group),
          setup.params,
        );
        settle(this.flock);
      }
      this.flock.resize(w, h);
    }
    this.shownSetup = setup;
  }

  draw = (f: DrawFrame) => {
    const { ctx, w, h, colors, ink, quiet, reduced, now } = f;
    const setup = this.setup;
    if (!setup) return;
    const dt = this.lastNow ? Math.min(100, now - this.lastNow) : 16;
    this.lastNow = now;

    this.ensure(setup, w, h, reduced);
    const sim = this.sim();
    if (!sim) return;
    sim.wrap = this.wrap;
    const cam = this.camera;
    cam.w = w;
    cam.h = h;
    const tankCam = this.tank;
    const inTank = this.space === "tank" && sim instanceof Flock3D;
    if (inTank) {
      tankCam.w = w;
      tankCam.h = h;
      tankCam.sx = sim.sx;
      tankCam.sy = sim.sy;
      tankCam.sz = sim.sz;
      // A slow sway of the eye, so the back of the tank slides against the front.
      if (!reduced) {
        tankCam.offX = Math.sin(now / 5200) * sim.sx * 0.07;
        tankCam.offY = Math.sin(now / 7300 + 1) * sim.sy * 0.03;
      }
    }
    // One projection for either 3D camera.
    const proj = (x: number, y: number, z: number) => (inTank ? tankCam.project(x, y, z) : cam.project(x, y, z));

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
      sim.setTargets(this.targets);
      if (this.frames++ % 20 === 0) {
        const max = Math.max(1, ...Array.from(sim.count));
        sim.params = {
          ...sim.params,
          pace: setup.params.pace.map((_, g) => 0.6 + sim.count[g] / max),
        };
      }
    } else if (sim.target[0] !== 1 || sim.params !== setup.params) {
      sim.allAlive();
      sim.params = setup.params;
    }

    // The camera: ease into its tilt after a switch, then orbit on its own
    // unless someone turned it in the last few seconds.
    if (this.space === "3d" && !reduced) {
      if (this.pitchTo !== null) {
        cam.pitch += (this.pitchTo - cam.pitch) * 0.03;
        if (Math.abs(this.pitchTo - cam.pitch) < 0.002) this.pitchTo = null;
      }
      if (now - this.touched > IDLE_ORBIT_MS) cam.yaw += 0.00012 * dt;
    }

    const hk = this.hawk && this.hawk.until > now ? this.hawk : null;
    if (!reduced || yearOn) {
      if (sim instanceof Flock3D) {
        // The pointer is a hawk at mid-depth.
        const hawk = hk && !reduced ? (inTank ? tankCam.unproject(hk.x, hk.y, sim.sz / 2) : cam.unproject(hk.x, hk.y)) : null;
        sim.step(hawk);
      }
      else sim.step(hk && !reduced ? hk : null);
    }

    // Reduce either space to screen arrays.
    const n = sim.n;
    if (this.sx.length !== n) {
      this.sx = new Float32Array(n);
      this.sy = new Float32Array(n);
      this.hx = new Float32Array(n);
      this.hy = new Float32Array(n);
      this.sc = new Float32Array(n);
      this.fade = new Float32Array(n);
    }
    const G = setup.names.length;
    if (this.gsx.length !== G) {
      this.gsx = new Float32Array(G);
      this.gsy = new Float32Array(G);
    }
    if (sim instanceof Flock3D) {
      // Depth fog: the nearest birds full strength, the farthest at a third.
      const near = inTank ? tankCam.sz * tankCam.eye : cam.dist - SIDE * 0.87;
      const far = inTank ? tankCam.sz * (tankCam.eye + 1) : cam.dist + SIDE * 0.87;
      const ref = inTank ? proj(sim.sx / 2, sim.sy / 2, sim.sz * 0.35).scale : proj(SIDE / 2, SIDE / 2, SIDE / 2).scale;
      for (let i = 0; i < n; i++) {
        const p = proj(sim.x[i], sim.y[i], sim.z[i]);
        const q = proj(sim.x[i] + sim.vx[i] * 6, sim.y[i] + sim.vy[i] * 6, sim.z[i] + sim.vz[i] * 6);
        const dx = q.sx - p.sx;
        const dy = q.sy - p.sy;
        const len = Math.hypot(dx, dy) || 1;
        this.sx[i] = p.sx;
        this.sy[i] = p.sy;
        this.hx[i] = dx / len;
        this.hy[i] = dy / len;
        this.sc[i] = Math.max(0.35, Math.min(2.2, p.scale / ref));
        const fog = 1 - ((p.depth - near) / (far - near)) * 0.67;
        this.fade[i] = Math.max(0.2, Math.min(1, fog)) * sim.faceFade(i);
      }
      for (let g = 0; g < G; g++) {
        const p = proj(sim.cx[g], sim.cy[g], sim.cz[g]);
        this.gsx[g] = p.sx;
        this.gsy[g] = p.sy;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const sp = Math.hypot(sim.vx[i], sim.vy[i]) || 1;
        this.sx[i] = sim.x[i];
        this.sy[i] = sim.y[i];
        this.hx[i] = sim.vx[i] / sp;
        this.hy[i] = sim.vy[i] / sp;
        this.sc[i] = 1;
        this.fade[i] = 1;
      }
      for (let g = 0; g < G; g++) {
        this.gsx[g] = sim.cx[g];
        this.gsy[g] = sim.cy[g];
      }
    }

    // The cube's twelve edges, faint (dashed when the faces wrap). The tank
    // draws no box (owner, 2026-11-17): depth reads from size and fog alone.
    if (sim instanceof Flock3D && !inTank) {
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.12;
      ctx.lineWidth = 1;
      ctx.setLineDash(this.wrap ? [4, 6] : []);
      ctx.beginPath();
      {
        const c = [0, SIDE];
        const corners = c.flatMap((x) => c.flatMap((y) => c.map((z) => proj(x, y, z))));
        const edges = [
          [0, 1], [2, 3], [4, 5], [6, 7],
          [0, 2], [1, 3], [4, 6], [5, 7],
          [0, 4], [1, 5], [2, 6], [3, 7],
        ];
        for (const [a, b] of edges) {
          ctx.moveTo(corners[a].sx, corners[a].sy);
          ctx.lineTo(corners[b].sx, corners[b].sy);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const colorOf = (g: number) => (setup.names[g] === OTHER ? quiet : colors[g % colors.length]);
    const shadeOf = (i: number) => Math.round(((sim.shade[i] + 1) / 2) * (SHADES - 1));
    const alphaOf = (g: number) => (this.focus === null || this.focus === g ? 1 : 0.12);
    // One fill per group per opacity step: life × depth fog × face fade.
    const bucketOf = (i: number) => Math.min(BUCKETS - 1, Math.floor(sim.alpha[i] * this.fade[i] * BUCKETS));

    for (let g = 0; g < G; g++) {
      const col = colorOf(g);
      for (let b = 0; b < BUCKETS; b++) {
        const a = alphaOf(g) * ((b + 1) / BUCKETS);
        // Each bird in its own shade of the flock's colour, from its data.
        const shades = shadesOf(col);
        ctx.globalAlpha = 0.9 * a;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let sh = 0; sh < SHADES; sh++) {
          ctx.fillStyle = shades[sh];
          for (let i = 0; i < n; i++) {
            if (sim.group[i] !== g || !sim.live[i] || bucketOf(i) !== b || shadeOf(i) !== sh) continue;
            const k = this.sc[i] * sim.scale[i];
            const px = Math.max(6, (3 + sim.size[i] * 4) * k * 3);
            ctx.font = `${px.toFixed(1)}px "Noto Sans Egyptian Hieroglyphs", "Segoe UI Historic", serif`;
            ctx.fillText("\u{131E2}", this.sx[i], this.sy[i]);
          }
        }
      }
    }

    if (this.labels) {
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = ink;
      for (let g = 0; g < G; g++) {
        if (setup.names[g] === OTHER || sim.count[g] < 8) continue;
        ctx.globalAlpha = 0.6 * alphaOf(g);
        ctx.fillText(setup.names[g].slice(0, 24), this.gsx[g], this.gsy[g] - 10);
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
