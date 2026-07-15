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
        accent: { DEFAULT: "#878054", hover: "#6F6944" },
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
