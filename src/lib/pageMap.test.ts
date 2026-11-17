import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPageMap } from "../../scripts/gen-page-map.mjs";
import committed from "./pageMap.generated.json";

describe("the page map scan", () => {
  const map = buildPageMap();
  it("finds Home, a dynamic page and a link between pages", () => {
    const routes = map.pages.map((p: { route: string }) => p.route);
    expect(routes).toContain("/");
    expect(routes).toContain("/bill/[docId]");
    expect(map.links.some((l: { from: string; to: string }) => l.from === "/admin" && l.to === "/logs")).toBe(true);
  });
  it("reads the redirects in next.config.mjs", () => {
    expect(map.redirects).toContainEqual({ from: "/needs-project", to: "/email?section=stuck" });
  });
  it("matches the committed file's page list (run npm run gen:pagemap if not)", () => {
    expect(committed.pages.map((p) => p.route)).toEqual(map.pages.map((p: { route: string }) => p.route));
    expect(readFileSync(new URL("./pageMap.generated.json", import.meta.url), "utf8").length).toBeGreaterThan(100);
  });
});
