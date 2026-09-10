/**
 * "All Pages" — the one menu that lists EVERY page in the app, grouped by
 * function, and the admin-editable order and grouping over it.
 *
 * PURE module (no DB, Node, or React) so the server loader, the client menu and
 * the editor can all import it — same rule as views.ts, nav.ts and navLayout.ts.
 *
 * WHY IT IS NOT JUST ANOTHER AREAS LIST. The home launcher (AREAS in nav.ts) is
 * curated: an area shows three rows and hides the rest, and a role's tile
 * launcher shows four buttons. This menu is the opposite promise — everything,
 * in one place, always complete. So the CATALOG is derived rather than typed
 * out:
 *
 *   1. every AREAS destination, in its area, keeps the wording already written
 *      for it, and
 *   2. every remaining VIEW that has a real PAGE is appended to the group its
 *      `ViewGroup` maps to.
 *
 * Rule 2 is what makes "every page" stay true as the app grows: a new view with
 * a page appears here the day it is added, with no second list to remember.
 *
 * WHAT AN ADMIN EDITS is the ORDER and the GROUPING — group titles, the order
 * of the groups, which group a page sits in, and the order inside it. Not what
 * the menu contains: hiding a page is what `views.ts` is for, and a menu that
 * promises everything cannot also be a place things go missing. So a saved
 * layout stores VIEW IDS only (`resolvePagesMenu` reads the label, address and
 * description back out of the catalog), and any page the saved layout does not
 * mention — a page added after it was saved — is appended to its default group
 * rather than dropped.
 */
import { AREAS } from "@/lib/nav";
import { VIEWS, type ViewGroup } from "@/lib/views";

/** One page in the menu: the catalog row, resolved from code, never stored. */
export interface PageEntry {
  /** The views.ts gate id. This is the identity a saved layout stores. */
  view: string;
  label: string;
  href: string;
  desc: string;
}

/** The shipped groups, in shipped order. Titles are the admin's to change. */
export const PAGE_GROUPS: { id: string; title: string }[] = [
  { id: "mywork", title: "My Work" },
  { id: "financials", title: "Financials" },
  { id: "hr", title: "HR" },
  { id: "utilities", title: "Utilities" },
  { id: "admin", title: "Admin" },
];

/**
 * Where a view that AREAS never listed lands. Keyed by the view's own
 * `ViewGroup`, so a page added to views.ts is filed by the group it declares.
 */
const GROUP_FOR_VIEW_GROUP: Record<ViewGroup, string> = {
  Financials: "financials",
  Field: "mywork",
  Assistant: "utilities",
  Office: "hr",
  System: "utilities",
};

/**
 * Views deliberately left out. Both pages are RETIRED — nothing links to them
 * and their work moved into Tracking Sheets — so listing them in the menu that
 * says "every page" would send the office to a dead end.
 */
const RETIRED = new Set(["coding", "stage"]);

/**
 * A second line for a page AREAS never listed, where its name alone is not
 * enough. `Tracking Sheet` and `Tracking Sheets` are one letter apart and are
 * different things, which is the whole reason this map exists.
 */
const EXTRA_DESC: Record<string, string> = {
  jobs: "Every job's budget against what it has spent",
  "tracking-sheet": "Push a job's month into its own Google tracking sheet",
};

/** A view with no page of its own (an API-only gate) has nothing to link to. */
function pageHref(paths: string[]): string {
  const first = paths[0] ?? "";
  return first && !first.startsWith("/api/") ? first : "";
}

/**
 * The complete catalog: every page, in its default group, in default order.
 * Built once at module load — pure data over two constant arrays.
 */
export const PAGE_CATALOG: { id: string; title: string; pages: PageEntry[] }[] = (() => {
  const groups = PAGE_GROUPS.map((g) => ({ id: g.id, title: g.title, pages: [] as PageEntry[] }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const placed = new Set<string>();

  // 1. Everything the launcher already names, with the wording it already has.
  for (const area of AREAS) {
    const group = byId.get(area.id) ?? byId.get("utilities")!;
    for (const d of area.dests) {
      if (!d.view || placed.has(d.view) || RETIRED.has(d.view)) continue;
      placed.add(d.view);
      group.pages.push({ view: d.view, label: d.label, href: d.href, desc: d.desc });
    }
  }

  // 2. Every other view that has a page — the ones no launcher list names.
  for (const v of VIEWS) {
    if (placed.has(v.id) || RETIRED.has(v.id)) continue;
    const href = pageHref(v.paths);
    if (!href) continue;
    placed.add(v.id);
    (byId.get(GROUP_FOR_VIEW_GROUP[v.group]) ?? byId.get("utilities")!).pages.push({
      view: v.id,
      label: v.label,
      href,
      desc: EXTRA_DESC[v.id] ?? "",
    });
  }

  return groups.filter((g) => g.pages.length > 0);
})();

/** Every page in the catalog, keyed by view id. */
const CATALOG_BY_VIEW = new Map<string, PageEntry>(
  PAGE_CATALOG.flatMap((g) => g.pages.map((p) => [p.view, p] as const)),
);

/** The group a view belongs to when nothing says otherwise. */
const DEFAULT_GROUP_OF = new Map<string, string>(
  PAGE_CATALOG.flatMap((g) => g.pages.map((p) => [p.view, g.id] as const)),
);

/** One group of a SAVED layout: a title, and the view ids in it, in order. */
export interface PagesMenuGroup {
  id: string;
  title: string;
  views: string[];
}

export interface PagesMenuLayout {
  version: 1;
  groups: PagesMenuGroup[];
}

/** The shipped grouping as a saveable document — what the editor opens on. */
export function defaultPagesMenu(): PagesMenuLayout {
  return {
    version: 1,
    groups: PAGE_CATALOG.map((g) => ({
      id: g.id,
      title: g.title,
      views: g.pages.map((p) => p.view),
    })),
  };
}

/**
 * Coerce an untrusted value (a stored blob, a request body) into a layout, or
 * null when there is nothing usable in it. Null is the signal to fall back to
 * the shipped grouping, so a layout with no groups is treated as absent rather
 * than rendered as an empty menu.
 */
export function sanitizePagesMenu(raw: unknown): PagesMenuLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const groupsRaw = (raw as { groups?: unknown }).groups;
  if (!Array.isArray(groupsRaw)) return null;

  const groups: PagesMenuGroup[] = [];
  const seenGroup = new Set<string>();
  const seenView = new Set<string>();
  for (const g of groupsRaw) {
    if (!g || typeof g !== "object") continue;
    const id = typeof (g as { id?: unknown }).id === "string" ? (g as { id: string }).id.trim() : "";
    if (!id || seenGroup.has(id)) continue;
    seenGroup.add(id);
    const title =
      typeof (g as { title?: unknown }).title === "string"
        ? (g as { title: string }).title.trim()
        : "";
    const viewsRaw = (g as { views?: unknown }).views;
    const views: string[] = [];
    for (const v of Array.isArray(viewsRaw) ? viewsRaw : []) {
      // A view id nobody can link to (renamed, retired, API-only) is dropped
      // here rather than rendered as a dead row; one listed twice is kept once.
      if (typeof v !== "string" || !CATALOG_BY_VIEW.has(v) || seenView.has(v)) continue;
      seenView.add(v);
      views.push(v);
    }
    groups.push({ id, title: title || id, views });
  }

  if (groups.length === 0) return null;
  return { version: 1, groups };
}

/**
 * The menu as it renders: the saved order and grouping, with every catalog page
 * the layout does not mention appended to its default group. An empty group is
 * dropped — nothing to show under a heading is a heading nobody needs.
 */
export function resolvePagesMenu(
  saved: PagesMenuLayout | null,
): { id: string; title: string; pages: PageEntry[] }[] {
  if (!saved) return PAGE_CATALOG;

  const groups = saved.groups.map((g) => ({
    id: g.id,
    title: g.title,
    pages: g.views.map((v) => CATALOG_BY_VIEW.get(v)!).filter(Boolean),
  }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const listed = new Set(saved.groups.flatMap((g) => g.views));

  // Pages the saved layout never named — added to the app since it was saved.
  // They go to their default group, or to a new group at the end when the admin
  // has deleted that one, so a new page is never unreachable from here.
  for (const page of CATALOG_BY_VIEW.values()) {
    if (listed.has(page.view)) continue;
    const wantId = DEFAULT_GROUP_OF.get(page.view) ?? "utilities";
    let group = byId.get(wantId);
    if (!group) {
      const title = PAGE_GROUPS.find((g) => g.id === wantId)?.title ?? "More";
      group = { id: wantId, title, pages: [] };
      byId.set(wantId, group);
      groups.push(group);
    }
    group.pages.push(page);
  }

  return groups.filter((g) => g.pages.length > 0);
}
