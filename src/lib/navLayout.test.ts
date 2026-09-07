import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, clampColumns, sanitizeLayout } from "./navLayout";

const menu = {
  id: "m1",
  title: "Money",
  items: [{ id: "i1", kind: "link", label: "Bills", href: "/bills", view: "bills" }],
};

describe("clampColumns", () => {
  it("keeps 1…4 and defaults anything else", () => {
    expect(clampColumns(1)).toBe(1);
    expect(clampColumns(4)).toBe(4);
    expect(clampColumns(9)).toBe(4);
    expect(clampColumns(0)).toBe(1);
    expect(clampColumns("3")).toBe(DEFAULT_COLUMNS);
    expect(clampColumns(undefined)).toBe(DEFAULT_COLUMNS);
  });
});

describe("sanitizeLayout", () => {
  it("carries the column count and the top buttons", () => {
    const out = sanitizeLayout({
      menus: [menu],
      columns: 2,
      items: [{ id: "t1", kind: "link", label: "Add bill", href: "/add-bill", view: "" }],
    });
    expect(out?.columns).toBe(2);
    // Outside a menu, an item is always a button — nothing labels a bare row.
    expect(out?.items).toEqual([
      { id: "t1", kind: "button", label: "Add bill", href: "/add-bill", desc: "", view: "" },
    ]);
  });

  it("accepts a launcher of top buttons with no menus at all", () => {
    const out = sanitizeLayout({
      menus: [],
      items: [{ id: "t1", label: "Add bill", href: "/add-bill" }],
    });
    expect(out?.menus).toEqual([]);
    expect(out?.items).toHaveLength(1);
  });

  it("drops a half-built button and falls back when nothing is left", () => {
    expect(sanitizeLayout({ menus: [], items: [{ id: "t1", label: "", href: "" }] })).toBeNull();
    expect(sanitizeLayout({})).toBeNull();
    expect(sanitizeLayout(null)).toBeNull();
  });

  it("defaults the column count when the stored layout predates it", () => {
    expect(sanitizeLayout({ menus: [menu] })?.columns).toBe(DEFAULT_COLUMNS);
  });
});
