import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Ascent Building Co. brand palette (Brand Guidelines, May 2024).
      // The raw hues below are fixed brand values. The THEME roles — `accent`
      // and `brand` — are CSS variables defined in globals.css, so each theme
      // uses one pairing: light = cream + ochre, dark = off-black + olive.
      colors: {
        cream: "#FAF7EE",
        offblack: "#1B1B17",
        olive: "#878054",
        ochre: "#CF9803",
        webgrey: "#8D8D8B",
        // Interactive color for the active theme (deep ochre / lifted olive).
        // `fg` is the text that sits on a filled accent; `soft` is the lifted
        // variant for small text on dark surfaces.
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
        },
        // Pure brand hue for GRAPHICS only (hairlines, peak mark, logo square).
        // Never text — pure ochre is 2.4:1 on cream.
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          fg: "rgb(var(--brand-fg) / <alpha-value>)",
        },
        // Dark-mode surface scale: page (= offblack), raised cards, overlays
        // (menus/modals). Cards must sit LIGHTER than the page, not darker.
        ink: { DEFAULT: "#1B1B17", raised: "#23231E", overlay: "#2B2B25" },
      },
      fontFamily: {
        // Brand web typeface (p.22). LL Medium is the print primary; Roboto is
        // the sanctioned web/Google-docs alternative and what the app renders in.
        sans: ["var(--font-roboto)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
