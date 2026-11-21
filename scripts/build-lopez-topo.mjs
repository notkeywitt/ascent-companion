#!/usr/bin/env node
/**
 * Rebuilds src/lib/lopezTopo.ts: Lopez Island's elevation contours as SVG paths,
 * in the same map units as LOPEZ_COAST.
 *
 *   node scripts/build-lopez-topo.mjs
 *
 * Elevation comes from the open Terrain Tiles on AWS ("terrarium" PNGs; in the
 * US they are USGS 3DEP data, public domain). Zoom 13 is ~19 m a pixel. The
 * grid is sampled at 2 map units (~33 m), masked to the coastline, traced by
 * marching squares every 50 ft and simplified to 0.6 map units. Every 200 ft
 * is an index line (drawn a little heavier).
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const MAP = new URL("../src/lib/lopezMap.ts", import.meta.url);
const OUT = new URL("../src/lib/lopezTopo.ts", import.meta.url);
const Z = 13;
const CELL = 2; // map units per grid cell
const STEP_FT = 50;
const INDEX_FT = 200;
const TOLERANCE = 0.6;

const src = readFileSync(MAP, "utf8");
const num = (name) => Number(src.match(new RegExp(`const ${name} = (-?[\\d.]+);`))[1]);
const W = num("W_LNG"), E = num("E_LNG"), S = num("S_LAT"), N = num("N_LAT");
const MW = Number(src.match(/MAP_W = (\d+)/)[1]);
const MH = Number(src.match(/MAP_H = (\d+)/)[1]);
const unproject = (x, y) => ({ lng: W + (x / MW) * (E - W), lat: N - (y / MH) * (N - S) });

const coast = [...src.match(/LOPEZ_COAST = "([^"]+)"/)[1].matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(
  (m) => [Number(m[1]), Number(m[2])],
);
function inside(x, y) {
  let hit = false;
  for (let i = 0, j = coast.length - 1; i < coast.length; j = i++) {
    const [xi, yi] = coast[i], [xj, yj] = coast[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Web Mercator tile pixel for a lat/lng at zoom Z.
const n = 2 ** Z;
const tileXY = (lat, lng) => {
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n * 256,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256,
  };
};

const tiles = new Map();
async function tile(tx, ty) {
  const key = `${tx}/${ty}`;
  if (!tiles.has(key)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const { data } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    tiles.set(key, data);
  }
  return tiles.get(key);
}
async function elevationM(lat, lng) {
  const p = tileXY(lat, lng);
  // Bilinear over the four nearest pixels.
  const x0 = Math.floor(p.x - 0.5), y0 = Math.floor(p.y - 0.5);
  const fx = p.x - 0.5 - x0, fy = p.y - 0.5 - y0;
  const px = async (x, y) => {
    const d = await tile(Math.floor(x / 256), Math.floor(y / 256));
    const i = ((y % 256) * 256 + (x % 256)) * 3;
    return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
  };
  const a = await px(x0, y0), b = await px(x0 + 1, y0), c = await px(x0, y0 + 1), d = await px(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

const cols = Math.ceil(MW / CELL) + 1;
const rows = Math.ceil(MH / CELL) + 1;
const grid = new Float64Array(cols * rows);
let top = 0;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const x = c * CELL, y = r * CELL;
    const { lat, lng } = unproject(x, y);
    const ft = inside(x, y) ? Math.max(0, (await elevationM(lat, lng)) * 3.28084) : -1;
    grid[r * cols + c] = ft;
    top = Math.max(top, ft);
  }
}
console.log(`grid ${cols}×${rows}, ${tiles.size} tiles, top ${Math.round(top)} ft`);

// Marching squares: segments for one level, joined into polylines.
function trace(level) {
  const segs = [];
  const v = (c, r) => grid[r * cols + c];
  const lerp = (c0, r0, c1, r1) => {
    const a = v(c0, r0), b = v(c1, r1);
    const t = (level - a) / (b - a);
    return [(c0 + (c1 - c0) * t) * CELL, (r0 + (r1 - r0) * t) * CELL];
  };
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = v(c, r) >= level, tr = v(c + 1, r) >= level, br = v(c + 1, r + 1) >= level, bl = v(c, r + 1) >= level;
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = () => lerp(c, r, c + 1, r), R = () => lerp(c + 1, r, c + 1, r + 1);
      const B = () => lerp(c, r + 1, c + 1, r + 1), L = () => lerp(c, r, c, r + 1);
      const table = {
        1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[L, T], [B, R]], 6: [[T, B]], 7: [[L, T]],
        8: [[L, T]], 9: [[T, B]], 10: [[T, R], [L, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
      };
      for (const [f, g] of table[code]) segs.push([f(), g()]);
    }
  }
  // Join segments that share an end.
  const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const ends = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [...segs[i]];
    for (const dir of [1, -1]) {
      for (;;) {
        const tip = dir === 1 ? line[line.length - 1] : line[0];
        const next = (ends.get(key(tip)) ?? []).find((j) => !used[j]);
        if (next == null) break;
        used[next] = 1;
        const [a, b] = segs[next];
        const add = key(a) === key(tip) ? b : a;
        if (dir === 1) line.push(add);
        else line.unshift(add);
      }
    }
    if (line.length >= 4) lines.push(line);
  }
  return lines;
}

// A closed ring splits at its far point first: Douglas–Peucker needs two
// distinct ends.
function simplify(pts) {
  const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
  if (pts.length > 3 && Math.hypot(lx - fx, ly - fy) < 1e-6) {
    let far = 0, idx = 1;
    pts.forEach(([x, y], i) => {
      const d = Math.hypot(x - fx, y - fy);
      if (d > far) (far = d), (idx = i);
    });
    return [...simplifyOpen(pts.slice(0, idx + 1)).slice(0, -1), ...simplifyOpen(pts.slice(idx))];
  }
  return simplifyOpen(pts);
}

function simplifyOpen(pts) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > far) (far = d), (idx = i);
    }
    if (far > TOLERANCE) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const fmt = (n) => String(Math.round(n * 10) / 10);
const minor = [], index = [];
for (let ft = STEP_FT; ft < top; ft += STEP_FT) {
  const d = trace(ft)
    .map(simplify)
    // Specks under ~10 map units long are noise at this scale.
    .filter((l) => l.reduce((sum, p, i) => sum + (i ? Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0) >= 10)
    .map((l) => "M" + l.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join("L"))
    .join("");
  (ft % INDEX_FT === 0 ? index : minor).push(d);
}

writeFileSync(
  OUT,
  `/**
 * Lopez Island's elevation contours, in the map units of LOPEZ_COAST
 * (src/lib/lopezMap.ts). Generated by scripts/build-lopez-topo.mjs from the
 * open Terrain Tiles on AWS (USGS 3DEP elevation, public domain). Do not edit
 * by hand: rerun the script.
 *
 * One line every ${STEP_FT} ft. INDEX holds every ${INDEX_FT} ft, drawn heavier.
 * Highest point sampled: ${Math.round(top)} ft.
 */
export const LOPEZ_TOPO_MINOR = ${JSON.stringify(minor.join(""))};
export const LOPEZ_TOPO_INDEX = ${JSON.stringify(index.join(""))};
`,
);
console.log(`wrote ${minor.length} minor + ${index.length} index levels`);
