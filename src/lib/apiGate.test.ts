import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { isPublicPath, isSignedInApi, ROLE_VIEWS, SIGNED_IN_API, viewIdForPath } from "./views";

/**
 * Security item M-1 (closed 2026-11-24): middleware refuses an API route that
 * no view lists, unless SIGNED_IN_API names it. These tests make sure every
 * route file has exactly one of the three gates, so a new route can neither be
 * open by accident nor break with a surprise 403.
 */

const API_DIR = join(__dirname, "..", "app", "api");

/** Every route file as its URL, with each dynamic folder kept as `[param]`. */
function apiRoutes(dir = API_DIR, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) apiRoutes(p, out);
    else if (e.name === "route.ts") {
      const rel = relative(API_DIR, dir).split(sep).join("/");
      out.push(rel ? `/api/${rel}` : "/api");
    }
  }
  return out.sort();
}

const ROUTES = apiRoutes();

describe("every API route has a gate", () => {
  it("finds the route files", () => {
    expect(ROUTES.length).toBeGreaterThan(200);
  });

  it("is public, on a view, or on the signed-in list", () => {
    const open = ROUTES.filter((r) => !isPublicPath(r) && !viewIdForPath(r) && !isSignedInApi(r));
    expect(
      open,
      "These routes are on no gate, so middleware refuses them. Add each to the view whose page calls it " +
        "(src/lib/views.ts), or to SIGNED_IN_API with the reason every role may call it.",
    ).toEqual([]);
  });

  it("lists only real routes on the signed-in list, each once and on no view", () => {
    const stale = SIGNED_IN_API.filter((r) => !ROUTES.includes(r.path)).map((r) => r.path);
    expect(stale, "SIGNED_IN_API names a route that does not exist").toEqual([]);
    const both = SIGNED_IN_API.filter((r) => viewIdForPath(r.path) || isPublicPath(r.path)).map((r) => r.path);
    expect(both, "a view or PUBLIC_PATHS already gates these; drop them from SIGNED_IN_API").toEqual([]);
    const paths = SIGNED_IN_API.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("the signed-in list matches exact routes, never a folder", () => {
  it("matches the route and its [param] segment", () => {
    expect(isSignedInApi("/api/jobs")).toBe(true);
    expect(isSignedInApi("/api/feature-requests/42")).toBe(true);
  });

  it("does not open a new route beside or under a listed one", () => {
    expect(isSignedInApi("/api/jobs/anything-new")).toBe(false);
    expect(isSignedInApi("/api/admin/new-console")).toBe(false);
    expect(isSignedInApi("/api/feature-requests/42/extra")).toBe(false);
    expect(isSignedInApi("/api/feature-requests/")).toBe(false);
  });
});

describe("routes closed on 2026-11-24", () => {
  const fieldCan = (path: string) => {
    const id = viewIdForPath(path);
    return id ? ROLE_VIEWS.field.includes(id) : isSignedInApi(path);
  };

  it("keeps bill and job money from a field account", () => {
    for (const p of [
      "/api/jobs/cost-detail",
      "/api/bill",
      "/api/bill/files",
      "/api/bill/drive",
      "/api/bill/create-file",
      "/api/bill-reviewed",
      "/api/stage",
      "/api/stage/invoices",
      "/api/shop-job",
      "/api/job-budget",
      "/api/vendor-bill-count",
    ]) {
      expect(fieldCan(p), p).toBe(false);
    }
  });

  it("still lets a lead read a job's cost and a bill", () => {
    expect(ROLE_VIEWS.lead).toContain(viewIdForPath("/api/jobs/cost-detail"));
    expect(ROLE_VIEWS.lead).toContain(viewIdForPath("/api/bill"));
  });

  it("leaves a field account its own time, miles and tools", () => {
    for (const p of ["/api/employee-time/clock", "/api/mileage/active", "/api/tools", "/api/ocr-serial", "/api/jobs"]) {
      expect(fieldCan(p), p).toBe(true);
    }
  });

  it("keeps the bill page's look-alikes on their own gates", () => {
    expect(viewIdForPath("/api/bill-status")).toBe("bill-approve");
    expect(viewIdForPath("/api/bill-search")).not.toBe("recode");
  });
});
