/**
 * The theme editor's data layer — /theme.
 *
 * The whole trick is that every palette value is already a CSS variable on
 * `<html>`, so writing one as an INLINE style repaints the entire app on the
 * next frame. Inline style beats any stylesheet rule, `[data-palette].dark`
 * included, so a draft overrides whatever palette is on without touching
 * globals.css. The preview is the real app, not a mock of it.
 *
 * A draft is per device (localStorage), never committed and never sent to the
 * server. Shipping a change still means editing the token blocks in
 * `src/app/globals.css` — the editor's Copy CSS button emits exactly those
 * blocks. See THEME.md.
 *
 * One asymmetry to know: the variables are declared PER THEME (`:root` vs
 * `.dark`), but an inline style is not theme-aware. So a draft holds both
 * halves and only the live theme's half is applied; flipping the theme
 * re-applies the other half.
 */

import { ROOT_PALETTE, type Palette } from "./palette";

/** localStorage key. Must match the inline script in src/app/layout.tsx. */
export const DRAFT_KEY = "paletteDraft";

export type ThemeName = "light" | "dark";

export interface TokenDef {
  /** CSS custom property name, without the leading `--`. */
  name: string;
  label: string;
  /** What it paints, in one line — shown under the control. */
  hint: string;
  /**
   * `theme` tokens are declared once per theme and differ between them.
   * `palette` tokens are declared once for the whole palette; the dark surface
   * scale is the only group like that, because every call site reaches it
   * through a `dark:` prefix already.
   */
  scope: "theme" | "palette";
}

/**
 * Every editable token, in the order they matter. This list IS the editor's
 * UI, so adding a token to globals.css means adding a row here.
 */
export const TOKENS: TokenDef[] = [
  { name: "page", label: "Page", hint: "The ground the whole app sits on.", scope: "theme" },
  { name: "page-fg", label: "Body text", hint: "Ordinary copy on that ground.", scope: "theme" },
  {
    name: "accent",
    label: "Accent — fills",
    hint: "Filled buttons, active chips, meters, rings, borders.",
    scope: "theme",
  },
  {
    name: "accent-text",
    label: "Accent — text",
    hint: "Links and interactive words. Separate because a fill colour need not carry a word.",
    scope: "theme",
  },
  {
    name: "accent-fg",
    label: "Accent label",
    hint: "The text ON a filled accent, and the logo's knocked-out peak.",
    scope: "theme",
  },
  {
    name: "accent-hover",
    label: "Accent hover",
    hint: "A filled accent under the cursor.",
    scope: "theme",
  },
  {
    name: "accent-soft",
    label: "Accent on a tint",
    hint: "A chip's label, where its own bg-accent/15 wash has eaten contrast.",
    scope: "theme",
  },
  {
    name: "brand",
    label: "Mark",
    hint: "Graphics only: the logo square, the peak, heading rules, text selection.",
    scope: "theme",
  },
  { name: "line", label: "Card edge", hint: "The hairline around a card.", scope: "theme" },
  {
    name: "line-soft",
    label: "Row divider",
    hint: "Between rows inside one card. Must be lighter than the card edge.",
    scope: "theme",
  },
  {
    name: "line-strong",
    label: "Control edge",
    hint: "Inputs and selects — heavier, so a field reads as one.",
    scope: "theme",
  },
  {
    name: "ink",
    label: "Dark page",
    hint: "The dark theme's ground. Declared per palette, not per theme.",
    scope: "palette",
  },
  {
    name: "ink-raised",
    label: "Dark card",
    hint: "Raised cards in dark. Must sit LIGHTER than the dark page.",
    scope: "palette",
  },
  {
    name: "ink-overlay",
    label: "Dark overlay",
    hint: "Menus and bottom sheets in dark.",
    scope: "palette",
  },
];

/** hex → the space-separated RGB triple the tokens are stored as. */
export function hexToRgb(hex: string): string {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return "0 0 0";
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** "207 152 3" → "#cf9803". Tolerates commas and extra whitespace. */
export function rgbToHex(rgb: string): string {
  const parts = rgb
    .trim()
    .split(/[\s,]+/)
    .map((p) => Math.max(0, Math.min(255, Math.round(Number(p) || 0))));
  const [r, g, b] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------- hsl helpers */

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = hexToRgb(hex)
    .split(" ")
    .map((v) => Number(v) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = ln - c / 2;
  const t: [number, number, number] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  return (
    "#" +
    t
      .map((v) =>
        Math.round((v + m) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/* ------------------------------------------------------------ contrast (WCAG) */

function channelLuminance(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).split(" ").map(Number);
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** WCAG contrast ratio between two hex colours, 1–21. */
export function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Flatten a translucent colour over a ground, so a chip's label can be measured
 * against the tint it actually sits on rather than the card under it.
 */
export function blend(fg: string, ground: string, alpha: number): string {
  const f = hexToRgb(fg).split(" ").map(Number);
  const g = hexToRgb(ground).split(" ").map(Number);
  const mix = f.map((v, i) => Math.round(v * alpha + g[i] * (1 - alpha)));
  return rgbToHex(mix.join(" "));
}

/** "AAA" ≥ 7, "AA" ≥ 4.5, "AA large" ≥ 3, else "fails". */
export function grade(ratio: number): { label: string; ok: boolean } {
  if (ratio >= 7) return { label: "AAA", ok: true };
  if (ratio >= 4.5) return { label: "AA", ok: true };
  if (ratio >= 3) return { label: "AA large only", ok: false };
  return { label: "fails", ok: false };
}

/* ------------------------------------------------------------------- drafts */

/** One palette's draft: hex per token, split by theme. `palette`-scope tokens live under `shared`. */
export interface PaletteDraft {
  light: Record<string, string>;
  dark: Record<string, string>;
  shared: Record<string, string>;
}

export type DraftStore = Partial<Record<Palette, PaletteDraft>>;

export function emptyDraft(): PaletteDraft {
  return { light: {}, dark: {}, shared: {} };
}

export function readDraftStore(): DraftStore {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as DraftStore) : {};
  } catch {
    return {};
  }
}

export function writeDraftStore(store: DraftStore): void {
  try {
    const empty = Object.values(store).every(
      (d) =>
        !d ||
        (Object.keys(d.light).length === 0 &&
          Object.keys(d.dark).length === 0 &&
          Object.keys(d.shared).length === 0),
    );
    if (empty) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(store));
  } catch {}
}

/**
 * Paint one palette's draft onto `<html>`, for the theme currently showing.
 *
 * Clears first, so a token dropped from the draft goes back to its stylesheet
 * value instead of sticking. Call this again whenever the theme flips.
 */
export function applyDraft(draft: PaletteDraft | undefined, theme: ThemeName): void {
  const el = document.documentElement;
  for (const t of TOKENS) el.style.removeProperty("--" + t.name);
  if (!draft) return;
  const values = { ...draft.shared, ...draft[theme] };
  for (const [name, hex] of Object.entries(values)) {
    if (TOKENS.some((t) => t.name === name)) el.style.setProperty("--" + name, hexToRgb(hex));
  }
}

/**
 * The palette's own values, as the stylesheet declares them — the numbers the
 * editor starts from and the "Reset" target.
 *
 * It has to read them with the draft's inline styles temporarily removed,
 * because `getComputedStyle` would otherwise hand back the draft it is meant to
 * be compared against. Removing and restoring inline props is synchronous, so
 * nothing paints in between.
 */
export function readBaseTokens(theme: ThemeName): Record<string, string> {
  const el = document.documentElement;
  const saved = new Map<string, string>();
  for (const t of TOKENS) {
    const v = el.style.getPropertyValue("--" + t.name);
    if (v) saved.set("--" + t.name, v);
    el.style.removeProperty("--" + t.name);
  }
  const wasDark = el.classList.contains("dark");
  const needsFlip = (theme === "dark") !== wasDark;
  if (needsFlip) el.classList.toggle("dark", theme === "dark");

  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const t of TOKENS) out[t.name] = rgbToHex(cs.getPropertyValue("--" + t.name));

  if (needsFlip) el.classList.toggle("dark", wasDark);
  for (const [k, v] of saved) el.style.setProperty(k, v);
  return out;
}

/**
 * The draft as the CSS to paste into `src/app/globals.css` — the editor's one
 * output. Only tokens that actually differ from the palette's own values are
 * printed, so the block names the change rather than restating the palette.
 */
export function draftToCss(
  palette: Palette,
  draft: PaletteDraft,
  base: { light: Record<string, string>; dark: Record<string, string> },
): string {
  // ROOT_PALETTE, not DEFAULT_PALETTE: this picks the SELECTOR the tokens are
  // declared under in globals.css, which is a fact about the stylesheet and not
  // about what a new device gets. The two were the same constant until the
  // default moved to website (2026-09-06).
  const sel =
    palette === ROOT_PALETTE
      ? { light: ":root", dark: ".dark" }
      : {
          light: `[data-palette="${palette}"]`,
          dark: `[data-palette="${palette}"].dark`,
        };

  const lines: string[] = [];
  const block = (selector: string, names: string[], theme: ThemeName) => {
    const rows = names
      .filter((n) => draft[theme][n] && draft[theme][n] !== base[theme][n])
      .map((n) => `  --${n}: ${hexToRgb(draft[theme][n])}; /* ${draft[theme][n]} */`);
    if (rows.length) lines.push(`${selector} {`, ...rows, "}");
  };

  const themeNames = TOKENS.filter((t) => t.scope === "theme").map((t) => t.name);
  const sharedNames = TOKENS.filter((t) => t.scope === "palette").map((t) => t.name);

  // Palette-scope tokens ride the light selector, which is where the palette
  // block declares them.
  const sharedRows = sharedNames
    .filter((n) => draft.shared[n] && draft.shared[n] !== base.light[n])
    .map((n) => `  --${n}: ${hexToRgb(draft.shared[n])}; /* ${draft.shared[n]} */`);

  const lightRows = themeNames
    .filter((n) => draft.light[n] && draft.light[n] !== base.light[n])
    .map((n) => `  --${n}: ${hexToRgb(draft.light[n])}; /* ${draft.light[n]} */`);

  if (lightRows.length || sharedRows.length) {
    lines.push(`${sel.light} {`, ...lightRows, ...sharedRows, "}");
  }
  block(sel.dark, themeNames, "dark");

  return lines.length
    ? lines.join("\n")
    : "/* No changes yet — every token still matches the palette. */";
}
