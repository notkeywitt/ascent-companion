import { describe, expect, it } from "vitest";
import { ROLES, VIEWS, resolveAllowedViews, viewIdForPath } from "@/lib/views";
import {
  BARS,
  EXTRA_LINKS,
  OUTSIDE_WORKSPACES,
  WORKSPACES,
  activeBarKey,
  barFor,
  locate,
} from "@/lib/workspaces";

const tabs = WORKSPACES.flatMap((w) => w.tabs);

describe("the workspace list", () => {
  it("puts every page on a workspace, or names why it is not", () => {
    const placed = new Set(tabs.map((t) => t.view));
    const pages = VIEWS.filter((v) => v.paths[0] && !v.paths[0].startsWith("/api/"));
    for (const v of pages) {
      expect(placed.has(v.id) || v.id in OUTSIDE_WORKSPACES, `${v.id} is on no workspace`).toBe(true);
    }
  });

  it("gates every tab by the view it claims", () => {
    for (const t of [...tabs, ...EXTRA_LINKS]) {
      expect(viewIdForPath(t.href), t.href).toBe(t.view);
    }
  });

  it("lists each page once", () => {
    expect(new Set(tabs.map((t) => t.view)).size).toBe(tabs.length);
  });

  it("finds the workspace for a child route", () => {
    expect(locate("/admin/copy")?.tab.view).toBe("page-copy");
    expect(locate("/trackingsheet")?.workspace.id).toBe("close");
    expect(locate("/bill/123")).toBeNull();
  });
});

describe("the bottom bar", () => {
  const canFor = (role: (typeof ROLES)[number]) => {
    const views = resolveAllowedViews(role);
    return (v: string) => views.has(v);
  };

  it("gives every role a bar of at most five slots it can open", () => {
    for (const role of ROLES) {
      const items = barFor(role, canFor(role));
      expect(items.length, role).toBeGreaterThan(1);
      expect(items.length, role).toBeLessThanOrEqual(5);
      expect(items.length, role).toBe(BARS[role].length);
    }
  });

  it("gives leads a Today slot, and field staff their five pages", () => {
    expect(barFor("lead", canFor("lead"))[0].key).toBe("today");
    expect(barFor("field", canFor("field")).map((i) => i.label)).toEqual([
      "Employee Time",
      "Mileage",
      "Tools",
      "Requisitions",
      "Time Off",
    ]);
  });

  it("lights the single page over the workspace that also holds it", () => {
    const items = barFor("office", canFor("office"));
    expect(activeBarKey(items, "/mileage-tracker")).toBe("mileage");
    expect(activeBarKey(items, "/tools")).toBe("mywork");
    expect(activeBarKey(items, "/needs-review")).toBe("close");
    expect(activeBarKey(items, "/")).toBe("today");
  });
});

describe("a pinned bar slot", () => {
  const can = (role: (typeof ROLES)[number]) => {
    const views = resolveAllowedViews(role);
    return (v: string) => views.has(v);
  };
  it("takes the last slot of a full bar", () => {
    const items = barFor("office", can("office"), "bill-search");
    expect(items).toHaveLength(5);
    expect(items[4].key).toBe("bill-search");
    expect(items[0].key).toBe("today");
  });
  it("is ignored when it is already on the bar or cannot be opened", () => {
    expect(barFor("office", can("office"), "mileage").map((i) => i.key)).toEqual(
      barFor("office", can("office")).map((i) => i.key),
    );
    expect(barFor("field", can("field"), "journal").map((i) => i.key)).not.toContain("journal");
  });
});
