/**
 * The app's two colour palettes, and the per-device choice between them.
 *
 * A PALETTE is which set of colours the app paints. A THEME is light or dark
 * WITHIN that palette. They are independent: every palette defines both themes,
 * so the existing light/dark switch keeps working whichever palette is on.
 *
 *   guidelines — from ASCENT Brand Guidelines (2024). Ochre is what you click.
 *   website    — from www.ascentbuildingco.com. Off-black is what you click,
 *                and ochre falls back to being the mark.
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

export const DEFAULT_PALETTE: Palette = "guidelines";

/** localStorage key. Must match the inline script in src/app/layout.tsx. */
export const PALETTE_KEY = "palette";

export const PALETTE_LABEL: Record<Palette, string> = {
  guidelines: "Guidelines",
  website: "Website",
};

export const PALETTE_DESC: Record<Palette, string> = {
  guidelines: "Ochre accents on cream — the 2024 brand deck.",
  website: "Black accents on cream — ascentbuildingco.com.",
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
 * The default palette carries NO attribute — its tokens are the `:root` block —
 * so switching back to it removes the attribute rather than writing a second
 * name that globals.css would have to match.
 */
export function applyPalette(p: Palette): void {
  const el = document.documentElement;
  if (p === DEFAULT_PALETTE) el.removeAttribute("data-palette");
  else el.setAttribute("data-palette", p);
  try {
    localStorage.setItem(PALETTE_KEY, p);
  } catch {}
}
