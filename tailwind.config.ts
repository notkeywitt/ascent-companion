import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "blueprint steel" petrol-teal accent, matching the prototype
        accent: { DEFAULT: "#10606b", hover: "#0b4a53" },
      },
    },
  },
  plugins: [],
} satisfies Config;
