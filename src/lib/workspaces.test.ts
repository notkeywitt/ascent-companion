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
  railFor,
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

  it("gives leads a Home slot, and field staff their five pages", () => {
    expect(barFor("lead", canFor("lead"))[0].key).toBe("today");
    expect(barFor("field", canFor("field")).map((i) => i.label)).toEqual([
      "Time",
      "Miles",
      "Tools",
      "Requisitions",
      "Time Off",
    ]);
  });

  it("gives office and admin the same bar: Home, Invoicing, Jobs, Miles, Time", () => {
    for (const role of ["office", "admin"] as const) {
      expect(barFor(role, canFor(role)).map((i) => i.label), role).toEqual([
        "Home",
        "Invoicing",
        "Jobs",
        "Miles",
        "Time",
      ]);
    }
  });

  it("gives office and admin a Jobs slot in place of Incoming Bills", () => {
    for (const role of ["office", "admin"] as const) {
      const keys = barFor(role, canFor(role)).map((i) => i.key);
      expect(keys, role).toContain("clients");
      expect(keys, role).not.toContain("incoming");
    }
  });

  it("lights the single page over the workspace that also holds it", () => {
    const items = barFor("office", canFor("office"));
    expect(activeBarKey(items, "/mileage-tracker")).toBe("mileage");
    expect(activeBarKey(items, "/employee-time")).toBe("employee-time");
    expect(activeBarKey(items, "/invoice-review")).toBe("close");
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

describe("the iPad rail", () => {
  const can = (role: (typeof ROLES)[number]) => {
    const views = resolveAllowedViews(role);
    return (v: string) => views.has(v);
  };
  it("starts the office's rail with the owner's five, then a space, then every other workspace once", () => {
    const items = railFor("office", can("office"));
    const rail = items.map((i) => i.key);
    expect(rail.slice(0, 5)).toEqual(["today", "close", "employees", "clients", "time"]);
    expect(items[5].gap).toBe(true);
    expect(items.filter((i) => i.gap)).toHaveLength(1);
    expect(rail).toEqual(expect.arrayContaining(["incoming", "people", "search", "help", "office", "mywork"]));
    expect(rail).not.toContain("admin");
    expect(new Set(rail).size).toBe(rail.length);
  });
  it("keeps field staff's rail on their bar, with no second Time", () => {
    const rail = railFor("field", can("field"));
    expect(rail.slice(0, 5).map((i) => i.key)).toEqual(barFor("field", can("field")).map((i) => i.key));
    expect(rail.map((i) => i.key)).not.toContain("time");
  });
  it("does not repeat a pinned page that is already a top item", () => {
    const keys = railFor("admin", can("admin"), "employees").map((i) => i.key);
    expect(keys.filter((k) => k === "employees")).toHaveLength(1);
  });
  it("still lights one slot per page", () => {
    const rail = railFor("admin", can("admin"));
    expect(activeBarKey(rail, "/employees")).toBe("employees");
    expect(activeBarKey(rail, "/labor-rates")).toBe("people");
    expect(activeBarKey(rail, "/mileage-tracker")).toBe("mywork");
    expect(activeBarKey(rail, "/employee-time")).toBe("time");
  });
});
