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
        // Tailwind's stock `neutral` is a PURE grey (R=G=B), which reads cold
        // and blue on this palette's warm grounds. This ramp keeps the brand's
        // warm axis (hue 48°, between ochre's 44° and olive's 52°) but carries
        // only a TRACE of it — saturation 0.035, down from the first pass's
        // 0.12. That pass was too warm on the dark ground: quiet text read
        // khaki against the off-black instead of grey. This is far enough off
        // pure grey to kill the blue cast, not far enough to have a colour.
        //
        // Lightness moves for TWO steps only. 300 and 400 are what dark mode
        // paints as quiet text (400 alone covers ~219 sites), and they sat too
        // bright to recede from the body copy — both drop 0.075 in HSL
        // lightness. 400 lands at 5.55:1 on the page and 300 at 9.70:1, both
        // still AA.
        //
        // Every OTHER step holds the stock step's relative luminance, and the
        // reasons are load-bearing:
        //   • 500 is written BARE (no `dark:` sibling) at ~390 sites, so it
        //     renders in dark mode too, where it is already only 3.64:1.
        //     Darkening it would push a lot of quiet text further down.
        //   • 600/700/800 are dark mode's borders and fills, not its text.
        //     They have to stay LIGHTER than the page (#1B1B17) or a card
        //     sinks below its own background and 70 borders stop being
        //     visible. Darkening them would invert the surface scale.
        //   • 50-200 are light-mode surfaces; the owner asked about dark.
        neutral: {
          50: "#FAFAFA",
          100: "#F5F5F4",
          200: "#E5E5E4",
          300: "#C3C2BF",
          400: "#94928C",
          500: "#75736D",
          600: "#53524E",
          700: "#41403D",
          800: "#272624",
          900: "#171716",
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
