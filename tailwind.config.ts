import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: "#878054", hover: "#6f6944" },
      },
    },
  },
  plugins: [],
} satisfies Config;
