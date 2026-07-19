import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Ascent Building Co. brand palette (Brand Guidelines, May 2024).
      // AA note: ochre is a GRAPHIC / large-element accent only — it fails AA as
      // small text on cream or white, so interactive text stays on `accent` (olive).
      colors: {
        cream: "#FAF7EE",
        offblack: "#1B1B17",
        olive: "#878054",
        ochre: "#CF9803",
        webgrey: "#8D8D8B",
        // `soft` is the olive lightened for small text on dark surfaces (olive
        // itself only passes AA on off-black as graphics / large type).
        accent: { DEFAULT: "#878054", hover: "#6F6944", soft: "#CFC8A6" },
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
