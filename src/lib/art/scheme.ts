/**
 * Colour schemes for the /art pieces. A scheme is eight colours, in the order
 * the pieces hand them out (biggest group first).
 *
 * The viewer either picks one of eight presets, or picks TWO colours and the
 * app fills in the other six: hues spread as far as possible from the two
 * picks and from each other, at the picks' average saturation and lightness,
 * alternating a little lighter and darker so neighbours stay apart.
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

/** Two picked colours → eight. The picks stay exactly as chosen, first and second. */
export function schemeFromTwo(a: string, b: string): string[] {
  const pa = hexToHsl(a);
  const pb = hexToHsl(b);
  const s = clamp((pa.s + pb.s) / 2, 35, 80);
  const l = clamp((pa.l + pb.l) / 2, 45, 62);
  // Grey picks have no real hue; give them no say in where the others go.
  const hues = [pa, pb].filter((p) => p.s > 8).map((p) => p.h);
  const out = [a.toLowerCase(), b.toLowerCase()];
  for (let i = 0; i < 6; i++) {
    let best = (hues[hues.length - 1] ?? 0) + 137.5;
    let bestGap = -1;
    for (let h = 0; h < 360; h += 3) {
      const gap = hues.length ? Math.min(...hues.map((x) => arc(x, h))) : 180;
      if (gap > bestGap) {
        bestGap = gap;
        best = h;
      }
    }
    hues.push(best);
    out.push(hslToHex({ h: best, s, l: clamp(l + (i % 2 ? -9 : 7), 38, 70) }));
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
