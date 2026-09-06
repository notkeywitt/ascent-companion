/**
 * The app's two colour palettes, and the per-device choice between them.
 *
 * A PALETTE is which set of colours the app paints. A THEME is light or dark
 * WITHIN that palette. They are independent: every palette defines both themes,
 * so the existing light/dark switch keeps working whichever palette is on.
 *
 *   guidelines — from ASCENT Brand Guidelines (2024). Ochre is what you click.
 *   website    — from www.ascentbuildingco.com. Black and white, no chroma at
 *                all: the accent and the mark alike.
 *
 * The values themselves live in `src/app/globals.css` as token blocks, and
 * THEME.md records both palettes with their reasoning. Nothing here knows a
 * colour: this module owns the KEY, the attribute and the storage, so the
 * pre-paint script in layout.tsx and the control in AppearanceCard agree.
 *
 * Storage is localStorage — the choice is per device on purpose (owner's call,
 * 2026-09-05), so the office desktop and a phone in the field can differ.
 */

export const PALETTES = ["guidelines", "website"] as const;
export type Palette = (typeof PALETTES)[number];

/**
 * What a device with no stored choice gets. Changed to "website" 2026-09-06
 * (owner's call) — the app now paints the site's black and white by default,
 * and Guidelines is the opt-in. Anyone who has ever picked a palette has it in
 * localStorage and keeps it; this only moves people who never chose.
 */
export const DEFAULT_PALETTE: Palette = "website";

/**
 * The palette whose tokens are the bare `:root` block in globals.css, so it is
 * the one a `data-palette` value does not have to name.
 *
 * NOT the same thing as DEFAULT_PALETTE, and it used to be — the default was
 * guidelines, so "the default" and "the one in :root" were one idea and one
 * constant. Changing the default split them: the CSS still declares guidelines
 * at `:root` and website under `[data-palette="website"]`. Anything reasoning
 * about SELECTORS (the /theme editor's Copy CSS output) wants this one;
 * anything reasoning about what a new device gets wants DEFAULT_PALETTE.
 */
export const ROOT_PALETTE: Palette = "guidelines";

/** localStorage key. Must match the inline script in src/app/layout.tsx. */
export const PALETTE_KEY = "palette";

export const PALETTE_LABEL: Record<Palette, string> = {
  guidelines: "Guidelines",
  website: "Website",
};

export const PALETTE_DESC: Record<Palette, string> = {
  guidelines: "Ochre accents on cream — the 2024 brand deck.",
  website: "Black and white, no colour — ascentbuildingco.com.",
};

function isPalette(v: string | null): v is Palette {
  return v !== null && (PALETTES as readonly string[]).includes(v);
}

/** The palette currently painted. Reads <html>, which the pre-paint script set. */
export function readPalette(): Palette {
  if (typeof document === "undefined") return DEFAULT_PALETTE;
  const v = document.documentElement.getAttribute("data-palette");
  return isPalette(v) ? v : DEFAULT_PALETTE;
}

/**
 * Paint a palette and remember it on this device.
 *
 * ALWAYS writes the attribute, including for the palette that has no CSS block
 * of its own. `[data-palette="guidelines"]` matches no rule, so the `:root`
 * tokens keep applying and the result is identical — but the attribute is then
 * the single answer to "which palette is on", for readPalette() and for anyone
 * reading the DOM. The old code removed it for the default, which now that the
 * default is website would have removed the attribute the website tokens are
 * selected BY, and painted guidelines instead.
 */
export function applyPalette(p: Palette): void {
  document.documentElement.setAttribute("data-palette", p);
  try {
    localStorage.setItem(PALETTE_KEY, p);
  } catch {}
}
