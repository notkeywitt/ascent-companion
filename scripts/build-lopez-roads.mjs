#!/usr/bin/env node
/**
 * Rebuilds LOPEZ_ROADS_MAJOR / LOPEZ_ROADS_MINOR in src/lib/lopezMap.ts from
 * OpenStreetMap (© OpenStreetMap contributors, ODbL), through Overpass.
 *
 *   node scripts/build-lopez-roads.mjs
 *
 * Secondary + tertiary roads are MAJOR. Unclassified, residential, living
 * streets and named service roads are MINOR. Driveways, parking aisles, tracks
 * and trails stay out. A way with most of its points off the coastline
 * (Decatur, Shaw) is dropped. Points keep one decimal and are simplified to
 * 0.25 map units, so the roads still hold their shape with the map zoomed in
 * (the Jobs page zooms to a picked job).
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../src/lib/lopezMap.ts", import.meta.url);
const SERVERS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const TOLERANCE = 0.25;

const src = readFileSync(FILE, "utf8");
const num = (name) => Number(src.match(new RegExp(`const ${name} = (-?[\\d.]+);`))[1]);
const W = num("W_LNG"), E = num("E_LNG"), S = num("S_LAT"), N = num("N_LAT");
const MW = Number(src.match(/MAP_W = (\d+)/)[1]);
const MH = Number(src.match(/MAP_H = (\d+)/)[1]);
const project = ({ lat, lon }) => [((lon - W) / (E - W)) * MW, ((N - lat) / (N - S)) * MH];

// The coastline polygon, for the on-island test.
const coast = [...src.match(/LOPEZ_COAST = "([^"]+)"/)[1].matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(
  (m) => [Number(m[1]), Number(m[2])],
);
function inside([x, y]) {
  let hit = false;
  for (let i = 0, j = coast.length - 1; i < coast.length; j = i++) {
    const [xi, yi] = coast[i], [xj, yj] = coast[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Douglas–Peucker.
function simplify(pts) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, best = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > best) (best = d), (far = i);
    }
    if (best > TOLERANCE) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r = (n) => String(Math.round(n * 10) / 10);
const toPath = (ways) =>
  ways.map((pts) => "M" + pts.map(([x, y]) => `${r(x)} ${r(y)}`).join("L")).join("");

const query = `[out:json][timeout:90];
way["highway"~"^(secondary|tertiary|unclassified|residential|living_street|service)$"](${S},${W},${N},${E});
out tags geom;`;

let data;
for (const url of SERVERS) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ascent-companion map build" },
      body: "data=" + encodeURIComponent(query),
    });
    if (res.ok) {
      data = await res.json();
      break;
    }
    console.error(`${url}: HTTP ${res.status}`);
  } catch (e) {
    console.error(`${url}: ${e.message}`);
  }
}
if (!data) throw new Error("No Overpass server answered.");

const major = [], minor = [];
for (const w of data.elements) {
  const t = w.tags ?? {};
  if (t.highway === "service" && (t.service || !t.name)) continue; // driveways, aisles, unnamed
  const pts = (w.geometry ?? []).map(project);
  if (pts.length < 2 || pts.filter(inside).length * 2 < pts.length) continue;
  (/^(secondary|tertiary)$/.test(t.highway) ? major : minor).push(simplify(pts));
}

const swap = (text, name, path) =>
  text.replace(new RegExp(`(export const ${name} = )"[^"]*"`), `$1"${path}"`);
let out = swap(src, "LOPEZ_ROADS_MAJOR", toPath(major));
out = swap(out, "LOPEZ_ROADS_MINOR", toPath(minor));
writeFileSync(FILE, out);
console.log(`major ${major.length} ways, minor ${minor.length} ways → ${FILE.pathname}`);
