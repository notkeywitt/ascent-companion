import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Ascent Building Co. brand palette (Brand Guidelines, May 2024).
      // The raw hues below are fixed brand values. The THEME roles — `accent`
      // and `brand` — are CSS variables defined in globals.css.
      //
      // OCHRE is the interactive accent in BOTH themes; the theme swaps the
      // GROUND under it (cream in light, off-black in dark), not the hue. The
      // guide's type-pairing page (p.15) passes ochre on off-black at 6.70:1,
      // so in dark it carries small text as well as fills. In light it can't
      // (ochre on cream is 2.41:1, p.16 lists it as a restriction), which is
      // why `text-accent` is redirected to black there — see globals.css.
      //
      // OLIVE is a supporting GRAPHIC band, never small text: 4.31:1 on
      // off-black passes for graphics and large text only. That matches the
      // website usage ratio on p.14, where olive is a narrow band beside the
      // cream and off-black fields, not the dominant interactive color.
      colors: {
        cream: "#FAF7EE",
        offblack: "#1B1B17",
        olive: "#878054",
        ochre: "#CF9803",
        webgrey: "#8D8D8B",
        // Tailwind's stock `neutral` is a PURE grey (R=G=B). On this palette's
        // warm cream and warm off-black grounds it reads cold and blue, and it
        // is the app's most-used color — ~370 text sites plus the surface and
        // border fills. These replacements are the same ramp rotated onto the
        // brand's warm axis (hue 48°, between ochre's 44° and olive's 52°),
        // with each step solved to hold the stock step's RELATIVE LUMINANCE.
        // Matching luminance is the point: every existing contrast ratio is
        // preserved to within 0.01, so nothing that passed AA stops passing —
        // the grey only loses its blue cast. Saturation tapers at the pale end
        // so white and near-white surfaces don't read as yellowed.
        neutral: {
          50: "#FAFAFA",
          100: "#F5F5F4",
          200: "#E6E5E2",
          300: "#D6D4CD",
          400: "#A8A390",
          500: "#78735F",
          600: "#565243",
          700: "#434035",
          800: "#282620",
          900: "#181714",
          950: "#0A0A09",
        },
        // Active-theme accent — ochre in both themes (see the note above).
        // `fg` is the text on a filled accent; `soft` is the dark-only lifted
        // step, kept because a chip's own `bg-accent/15` tint eats contrast.
        // In LIGHT, `text-accent` is redirected to black in globals.css, so
        // this drives fills there, not text.
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
        },
        // Pure brand hue for GRAPHICS only (hairlines, peak mark, logo square).
        // Never text: ochre is 2.4:1 on cream, olive 4.3:1 on off-black.
        brand: { DEFAULT: "rgb(var(--brand) / <alpha-value>)" },
        // Dark-mode surface scale: page (= offblack), raised cards, overlays
        // (menus/modals). Cards must sit LIGHTER than the page, not darker.
        ink: { DEFAULT: "#1B1B17", raised: "#23231E", overlay: "#2B2B25" },
        // Hairlines, as theme variables (see globals.css) so `border-line`
        // flips with the theme and no page has to spell out the
        // `border-neutral-200 dark:border-neutral-700/60` pair again.
        // `line` edges a card; `line-soft` divides rows INSIDE one.
        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          soft: "rgb(var(--line-soft) / <alpha-value>)",
          strong: "rgb(var(--line-strong) / <alpha-value>)",
        },
      },
      fontFamily: {
        // Brand web typeface (p.22). LL Medium is the print primary; Roboto is
        // the sanctioned web/Google-docs alternative and what the app renders in.
        sans: ["var(--font-roboto)", "ui-sans-serif", "system-ui", "sans-serif"],
        // `font-mono` otherwise falls through to the browser default (Courier),
        // which is a different typeface from everything around it. Roboto Mono
        // keeps column alignment where it's genuinely needed (log output, CSV
        // previews) without leaving the brand family.
        mono: ["var(--font-roboto-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
