import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests only — pure modules, no DB, no network, no React.
 *
 * The targets are deliberately the things that would cost real money if they
 * broke: the write gate that stands between the browser and arbitrary JobTread
 * mutations, the retry logic that must never re-send a mutation, and the billing
 * date rules that have caused production bugs before.
 */
export default defineConfig({
  resolve: {
    // Mirror the "@/*" -> "./src/*" alias from tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Route handlers, pages and components are out of scope here: they need a
    // running Next request context. Keep this suite fast and dependency-free.
    exclude: ["node_modules/**", ".next/**"],
  },
});
