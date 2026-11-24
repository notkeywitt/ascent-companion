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
 * The Job Flock's engine: the simulation, the year clock and the
 * drawing, in one object that lives across frames. The Job Flock page and the
 * desktop screen saver (src/components/FlockSaver.tsx) both drive one.
 * Not React: a page keeps it in a ref and calls `draw` from ArtCanvas.
 *
 * The 2-D flock (src/lib/art/flock.ts) in canvas pixels. 3D and Tank were
 * removed (owner, 2026-11-24): too slow on a laptop. Each bird is a glyph
 * drawn once per colour into a small sprite canvas, then stamped with
 * drawImage: text drawn per bird at a new angle each frame was the lag.
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
/** A bird sprite's size in CSS px; each bird scales from it. */
const SPRITE_PX = 32;
const GLYPH = "\u{131E2}";
const GLYPH_FONT = '"Noto Sans Egyptian Hieroglyphs", "Segoe UI Historic", serif';
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

const spriteCache = new Map<string, HTMLCanvasElement>();
/** The bird glyph in one colour, drawn once at `scale` device px per CSS px. */
function spriteOf(color: string, scale: number): HTMLCanvasElement {
  const key = `${color}|${scale}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil(SPRITE_PX * scale);
  const x = c.getContext("2d");
  if (x) {
    x.scale(scale, scale);
    x.font = `${SPRITE_PX * 0.8}px ${GLYPH_FONT}`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillStyle = color;
    x.fillText(GLYPH, SPRITE_PX / 2, SPRITE_PX / 2);
  }
  // A colour fade makes new colours every frame; keep the cache small.
  if (spriteCache.size > 256) spriteCache.clear();
  spriteCache.set(key, c);
  return c;
}

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
  // Screen arrays, refilled each frame.
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private hx = new Float32Array(0);
  private hy = new Float32Array(0);
  private fade = new Float32Array(0);
  private order = new Int32Array(0);
  private cellOf = new Int32Array(0);
  private cellStart = new Int32Array(0);
  /** Per bird: wingbeat phase, last screen heading, and bank (lean into a turn). */
  private flap = new Float32Array(0);
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private bank = new Float32Array(0);
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

  /** The flock nearest (x, y) on screen within 60px, or -1. */
  groupAt(x: number, y: number): number {
    if (!this.setup || !this.gsx.length) return -1;
    const count = this.flock?.count;
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

  /** Make sure the flock exists for the rows and the grouping. */
  private ensure(setup: FlockSetup, w: number, h: number, reduced: boolean) {
    const settle = (f: Flock) => {
      if (reduced) for (let s = 0; s < SETTLE_STEPS; s++) f.step();
    };
    if (!this.flock || this.flockGen !== this.gen) {
      const fresh = new Flock(setup.birds, setup.params, w, h);
      if (this.flock) fresh.inherit(this.flock);
      this.flock = fresh;
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
    this.shownSetup = setup;
  }

  draw = (f: DrawFrame) => {
    const { ctx, w, h, colors, ink, quiet, reduced, now } = f;
    const setup = this.setup;
    if (!setup) return;
    const dt = this.lastNow ? Math.min(100, now - this.lastNow) : 16;
    this.lastNow = now;

    this.ensure(setup, w, h, reduced);
    const sim = this.flock;
    if (!sim) return;
    sim.wrap = this.wrap;

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

    const hk = this.hawk && this.hawk.until > now ? this.hawk : null;
    if (!reduced || yearOn) sim.step(hk && !reduced ? hk : null);

    // Screen arrays.
    const n = sim.n;
    if (this.sx.length !== n) {
      this.sx = new Float32Array(n);
      this.sy = new Float32Array(n);
      this.hx = new Float32Array(n);
      this.hy = new Float32Array(n);
      this.fade = new Float32Array(n);
    }
    const G = setup.names.length;
    if (this.gsx.length !== G) {
      this.gsx = new Float32Array(G);
      this.gsy = new Float32Array(G);
    }
    for (let i = 0; i < n; i++) {
      const sp = Math.hypot(sim.vx[i], sim.vy[i]) || 1;
      this.sx[i] = sim.x[i];
      this.sy[i] = sim.y[i];
      this.hx[i] = sim.vx[i] / sp;
      this.hy[i] = sim.vy[i] / sp;
      this.fade[i] = 1;
    }
    for (let g = 0; g < G; g++) {
      this.gsx[g] = sim.cx[g];
      this.gsy[g] = sim.cy[g];
    }

    // Wingbeats and banking. A bird flaps faster the faster it flies, glides
    // through a hard turn, and leans into the turn.
    if (this.flap.length !== n) {
      this.flap = new Float32Array(n);
      for (let i = 0; i < n; i++) this.flap[i] = i * 2.399;
      this.px = Float32Array.from(this.hx);
      this.py = Float32Array.from(this.hy);
      this.bank = new Float32Array(n);
    }
    {
      const base = 1.6;
      for (let i = 0; i < n; i++) {
        const turn = this.px[i] * this.hy[i] - this.py[i] * this.hx[i];
        this.px[i] = this.hx[i];
        this.py[i] = this.hy[i];
        const want = Math.max(-0.9, Math.min(0.9, turn * 12));
        this.bank[i] += (want - this.bank[i]) * 0.12;
        if (!reduced) {
          const sp = Math.hypot(sim.vx[i], sim.vy[i]) / base;
          this.flap[i] = (this.flap[i] + dt * (0.006 + 0.018 * sp)) % (Math.PI * 2);
        }
      }
    }

    const colorOf = (g: number) => (setup.names[g] === OTHER ? quiet : colors[g % colors.length]);
    const shadeOf = (i: number) => Math.round(((sim.shade[i] + 1) / 2) * (SHADES - 1));
    const alphaOf = (g: number) => (this.focus === null || this.focus === g ? 1 : 0.12);
    // One fill per group per opacity step: life × depth fog × face fade.
    const bucketOf = (i: number) => Math.min(BUCKETS - 1, Math.floor(sim.alpha[i] * this.fade[i] * BUCKETS));

    // Sort the live birds once by (group, opacity step, shade), so each pass
    // below walks only its own birds, not all of them.
    const cells = G * BUCKETS * SHADES;
    if (this.cellStart.length !== cells + 1) this.cellStart = new Int32Array(cells + 1);
    if (this.order.length !== n) {
      this.order = new Int32Array(n);
      this.cellOf = new Int32Array(n);
    }
    const start = this.cellStart.fill(0);
    for (let i = 0; i < n; i++) {
      const c = sim.live[i] ? (sim.group[i] * BUCKETS + bucketOf(i)) * SHADES + shadeOf(i) : -1;
      this.cellOf[i] = c;
      if (c >= 0) start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const at = start.slice(0, cells);
    for (let i = 0; i < n; i++) if (this.cellOf[i] >= 0) this.order[at[this.cellOf[i]]++] = i;
    const order = this.order;

    // Each bird stamps its colour's sprite through its own matrix.
    const base = ctx.getTransform();
    const d = base.a;
    const half = SPRITE_PX / 2;
    for (let g = 0; g < G; g++) {
      const shades = shadesOf(colorOf(g));
      for (let b = 0; b < BUCKETS; b++) {
        ctx.globalAlpha = 0.9 * alphaOf(g) * ((b + 1) / BUCKETS);
        for (let sh = 0; sh < SHADES; sh++) {
          const c = (g * BUCKETS + b) * SHADES + sh;
          if (start[c] === start[c + 1]) continue;
          const sprite = spriteOf(shades[sh], d);
          for (let o = start[c]; o < start[c + 1]; o++) {
            const i = order[o];
            const px = Math.max(7, (3 + sim.size[i] * 4) * sim.scale[i] * 3.45);
            // Turn toward the heading; a bird heading left mirrors, so it never flies upside down.
            const ux = this.hx[i];
            const uy = this.hy[i];
            const flip = ux < 0 ? -1 : 1;
            // Lean into the turn, and fold the wings: a hard turn glides.
            const bk = this.bank[i];
            const th = Math.atan2(uy, ux * flip) * flip + bk * 0.35;
            const beat = reduced ? 1 : 0.7 + 0.3 * Math.sin(this.flap[i]) * (1 - Math.abs(bk));
            // The glyph faces left at rest, so mirror it to face the heading.
            const m = px / (SPRITE_PX * 0.8);
            const sx = -flip * m;
            const sy = beat * Math.cos(bk * 0.8) * m;
            const cs = Math.cos(th);
            const sn = Math.sin(th);
            ctx.setTransform(d * cs * sx, d * sn * sx, -d * sn * sy, d * cs * sy, d * this.sx[i], d * this.sy[i]);
            ctx.drawImage(sprite, -half, -half, SPRITE_PX, SPRITE_PX);
          }
        }
      }
    }
    ctx.setTransform(base);

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
