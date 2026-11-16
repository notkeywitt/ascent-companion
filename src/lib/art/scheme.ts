/**
 * Colour schemes for the /art pieces. A scheme is eight colours, in the order
 * the pieces hand them out (biggest group first).
 *
 * The viewer either picks one of eight presets, or picks TWO colours and the
 * app fills in the other six by colour harmony: complements, the midpoint and
 * its complement, split complements and neighbours (see `schemeFromTwo`).
 *
 * Pure: no DOM. The page applies a scheme by setting `--viz-1..8` on its own
 * <main>, so it never touches the rest of the app's charts.
 */

export interface ArtScheme {
  id: string;
  name: string;
  /** null = the app's own chart colours (the theme's `--viz-*` tokens). */
  colors: string[] | null;
}

/** The app's own chart colours (light values), for the House swatch. */
const HOUSE = ["#4e79a7", "#f28e2b", "#76b7b2", "#59a14f", "#b07aa1", "#9c755f", "#edc948", "#e15759"];

export const ART_PRESETS: ArtScheme[] = [
  { id: "house", name: "House", colors: null },
  {
    id: "cedar",
    name: "Cedar & Moss",
    colors: ["#a0522d", "#6b8e23", "#d2a679", "#7a9a4a", "#cd853f", "#8fbc8f", "#b5653a", "#bdb76b"],
  },
  {
    id: "salish",
    name: "Salish Sea",
    colors: ["#1f6f8b", "#99c1b9", "#2a9d8f", "#457b9d", "#a8dadc", "#5e8c9a", "#6c91bf", "#4f7cac"],
  },
  {
    id: "kiln",
    name: "Kiln",
    colors: ["#c44536", "#e9a03b", "#a0522d", "#f2cc8f", "#e07a5f", "#9c6644", "#d4a373", "#bc4749"],
  },
  {
    id: "orchard",
    name: "Orchard",
    colors: ["#e63946", "#f4a261", "#2a9d8f", "#e9c46a", "#8ab17d", "#b56576", "#ff8fa3", "#8e7dbe"],
  },
  {
    id: "granite",
    name: "Granite",
    colors: ["#6c7a96", "#a3aab8", "#8a8fb0", "#c9ada7", "#7f8c8d", "#9a8c98", "#b0a089", "#5f7470"],
  },
  {
    id: "ember",
    name: "Ember",
    colors: ["#ff6b35", "#ffd23f", "#ee4266", "#3bceac", "#0ead69", "#9b5de5", "#f15bb5", "#00bbf9"],
  },
  {
    id: "blueprint",
    name: "Blueprint",
    colors: ["#1d4ed8", "#60a5fa", "#0ea5e9", "#38bdf8", "#93c5fd", "#2563eb", "#7dd3fc", "#3b82f6"],
  },
];

/** The colours a preset shows in its swatch. */
export const swatchOf = (s: ArtScheme) => s.colors ?? HOUSE;

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const m = hex.trim().replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const ss = s / 100;
  const ll = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)]
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const arc = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The midpoint of two hues, the short way round the wheel. */
function midHue(a: number, b: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d / 2 + 360) % 360;
}

/** Hues closer than this read as the same colour in a chart. */
const MIN_GAP = 24;

/**
 * Two picked colours → eight, by colour harmony. The picks stay exactly as
 * chosen, first and second. The other six come from this list, in order,
 * skipping any hue too close to one already in:
 *
 *   1. the complement of each pick (opposite on the wheel);
 *   2. the hue halfway between the picks, and its complement;
 *   3. each pick's split complements (150° away either side);
 *   4. each pick's neighbours (30° either side), for a related accent.
 *
 * If that leaves gaps, the widest open stretch of the wheel fills them.
 * Saturation is the picks' average; lightness steps by role (complements at
 * the picks' level, split complements a shade darker, neighbours a shade
 * lighter) so the eight sit together and still tell apart.
 */
export function schemeFromTwo(a: string, b: string): string[] {
  const pa = hexToHsl(a);
  const pb = hexToHsl(b);
  const s = clamp((pa.s + pb.s) / 2, 40, 75);
  const l = clamp((pa.l + pb.l) / 2, 46, 60);
  // Grey picks have no real hue: they give no say in where the others go,
  // and two greys build around a cool blue.
  const hued = [pa, pb].filter((p) => p.s > 8).map((p) => p.h);
  const anchors = hued.length ? hued : [210];
  const [h1, h2 = (anchors[0] + 120) % 360] = anchors;
  const mid = midHue(h1, h2);

  const candidates: { h: number; dl: number }[] = [
    { h: h1 + 180, dl: 0 },
    { h: h2 + 180, dl: 0 },
    { h: mid, dl: 4 },
    { h: mid + 180, dl: -4 },
    { h: h1 + 150, dl: -7 },
    { h: h1 + 210, dl: -7 },
    { h: h2 + 150, dl: -7 },
    { h: h2 + 210, dl: -7 },
    { h: h1 + 30, dl: 8 },
    { h: h1 - 30, dl: 8 },
    { h: h2 + 30, dl: 8 },
    { h: h2 - 30, dl: 8 },
  ].map((c) => ({ h: (c.h + 360) % 360, dl: c.dl }));

  const taken = [...hued];
  const out = [a.toLowerCase(), b.toLowerCase()];
  const add = (h: number, dl: number) => {
    taken.push(h);
    out.push(hslToHex({ h, s, l: clamp(l + dl, 38, 70) }));
  };
  for (const c of candidates) {
    if (out.length === 8) break;
    if (taken.every((t) => arc(t, c.h) >= MIN_GAP)) add(c.h, c.dl);
  }
  // Fill what is left from the widest open stretch of the wheel.
  while (out.length < 8) {
    let best = 0;
    let bestGap = -1;
    for (let h = 0; h < 360; h += 3) {
      const gap = taken.length ? Math.min(...taken.map((x) => arc(x, h))) : 180;
      if (gap > bestGap) {
        bestGap = gap;
        best = h;
      }
    }
    add(best, out.length % 2 ? -6 : 6);
  }
  return out;
}

/** What the viewer chose, as stored on this device. */
export type SchemeChoice = { preset: string } | { two: [string, string] };

const HEX = /^#[0-9a-f]{6}$/i;

/** The eight colours for a choice; null means the theme's own. Anything
 *  unreadable falls back to House. */
export function colorsFor(choice: SchemeChoice | null | undefined): string[] | null {
  if (!choice) return null;
  if ("two" in choice) {
    const [a, b] = choice.two ?? [];
    return HEX.test(a ?? "") && HEX.test(b ?? "") ? schemeFromTwo(a, b) : null;
  }
  return ART_PRESETS.find((p) => p.id === choice.preset)?.colors ?? null;
}

export function parseChoice(raw: string | null): SchemeChoice | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.preset === "string") return { preset: v.preset };
    if (v && Array.isArray(v.two) && v.two.length === 2) return { two: [String(v.two[0]), String(v.two[1])] };
  } catch {
    /* fall through */
  }
  return null;
}
