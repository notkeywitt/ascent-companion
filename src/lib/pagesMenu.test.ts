import { describe, expect, it } from "vitest";

import {
  PAGE_CATALOG,
  defaultPagesMenu,
  resolvePagesMenu,
  sanitizePagesMenu,
  type PagesMenuLayout,
} from "@/lib/pagesMenu";
import { VIEWS } from "@/lib/views";

/**
 * The All Pages menu's promise is COMPLETENESS — every page, always. Every test
 * here is a way that promise could fail silently: a page missing from the
 * catalog, a page dropped by a saved layout, a page added after a save.
 */

const catalogViews = () => PAGE_CATALOG.flatMap((g) => g.pages.map((p) => p.view));

describe("the catalog", () => {
  it("carries every view that has a page of its own", () => {
    const expected = VIEWS.filter(
      (v) => (v.paths[0] ?? "").startsWith("/") && !(v.paths[0] ?? "").startsWith("/api/"),
    )
      .map((v) => v.id)
      // The two retired pages are deliberately left out.
      .filter((id) => id !== "coding" && id !== "stage");
    expect(new Set(catalogViews())).toEqual(new Set(expected));
  });

  it("lists each page exactly once", () => {
    const views = catalogViews();
    expect(views.length).toBe(new Set(views).size);
  });

  it("gives every page an address", () => {
    for (const p of PAGE_CATALOG.flatMap((g) => g.pages)) {
      expect(p.href.startsWith("/")).toBe(true);
      expect(p.label).not.toBe("");
    }
  });
});

describe("sanitizePagesMenu", () => {
  it("keeps a valid document", () => {
    const layout = defaultPagesMenu();
    expect(sanitizePagesMenu(layout)).toEqual(layout);
  });

  it("treats junk and an empty document as absent", () => {
    expect(sanitizePagesMenu(null)).toBeNull();
    expect(sanitizePagesMenu("nope")).toBeNull();
    expect(sanitizePagesMenu({ groups: [] })).toBeNull();
    expect(sanitizePagesMenu({ groups: "no" })).toBeNull();
  });

  it("drops a view id the app no longer has", () => {
    const out = sanitizePagesMenu({
      groups: [{ id: "g", title: "G", views: ["help", "a-page-that-left"] }],
    });
    expect(out?.groups[0].views).toEqual(["help"]);
  });

  it("keeps a page listed twice exactly once", () => {
    const out = sanitizePagesMenu({
      groups: [
        { id: "a", title: "A", views: ["help", "chat"] },
        { id: "b", title: "B", views: ["help"] },
      ],
    });
    expect(out?.groups[0].views).toEqual(["help", "chat"]);
    expect(out?.groups[1].views).toEqual([]);
  });

  it("falls back to the id when a group has no name", () => {
    expect(sanitizePagesMenu({ groups: [{ id: "utilities", views: [] }] })?.groups[0].title).toBe(
      "utilities",
    );
  });
});

describe("resolvePagesMenu", () => {
  it("renders the shipped grouping when nothing is saved", () => {
    expect(resolvePagesMenu(null)).toEqual(PAGE_CATALOG);
  });

  it("honours the saved order and grouping", () => {
    const saved: PagesMenuLayout = {
      version: 1,
      groups: [{ id: "mine", title: "Mine", views: catalogViews() }],
    };
    const out = resolvePagesMenu(saved);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Mine");
    expect(out[0].pages.map((p) => p.view)).toEqual(catalogViews());
  });

  it("folds a page the saved layout never named back into its default group", () => {
    // A layout saved before /help existed: everything else, help left out.
    const saved: PagesMenuLayout = {
      version: 1,
      groups: PAGE_CATALOG.map((g) => ({
        id: g.id,
        title: g.title,
        views: g.pages.map((p) => p.view).filter((v) => v !== "help"),
      })),
    };
    const out = resolvePagesMenu(saved);
    expect(out.flatMap((g) => g.pages.map((p) => p.view))).toContain("help");
    const home = PAGE_CATALOG.find((g) => g.pages.some((p) => p.view === "help"))!;
    expect(out.find((g) => g.id === home.id)!.pages.map((p) => p.view)).toContain("help");
  });

  it("never loses a page, whatever the saved layout says", () => {
    const saved: PagesMenuLayout = {
      version: 1,
      groups: [{ id: "one", title: "One", views: ["help"] }],
    };
    const out = resolvePagesMenu(saved);
    expect(new Set(out.flatMap((g) => g.pages.map((p) => p.view)))).toEqual(
      new Set(catalogViews()),
    );
  });

  it("drops a group with nothing in it", () => {
    const saved: PagesMenuLayout = {
      version: 1,
      groups: [
        { id: "empty", title: "Empty", views: [] },
        ...PAGE_CATALOG.map((g) => ({
          id: g.id,
          title: g.title,
          views: g.pages.map((p) => p.view),
        })),
      ],
    };
    expect(resolvePagesMenu(saved).some((g) => g.id === "empty")).toBe(false);
  });
});
