/**
 * The EDITABLE shape of the admin home launcher — menus, the page links inside
 * them, and buttons — as a plain, override-able document.
 *
 * PURE module (no DB, Node, or React) so it is safe to import from the server
 * loader, the client provider, and the editor alike — same rule as copy.ts and
 * views.ts.
 *
 * THE MODEL (mirrors page_copy → the copy registry): the shipped launcher lives
 * in AREAS (src/lib/nav.ts) and is the DEFAULT, in code. A row in `nav_layout`
 * only ever REPLACES it wholesale. So:
 *   - an empty/unreachable DB renders AREAS — the launcher can never go blank
 *     because a query failed,
 *   - deleting the row reverts to the shipped launcher, and
 *   - a saved layout that fails validation is ignored, not rendered broken.
 *
 * Only ADMIN sees the AREAS launcher (field/lead/office get the tile launcher),
 * so this document customizes the admin's own home page. Each item still carries
 * a `view` gate id, so a link a role can't reach stays filtered out the same way
 * it is today (`access.can`). An empty `view` means "always show".
 */
import { AREAS, PREVIEW_ROWS } from "@/lib/nav";

/** A link renders as a hairline list row; a button renders as a large tile. */
export type NavItemKind = "link" | "button";

export interface NavItem {
  /** Stable handle for React keys and reordering. Generated when created. */
  id: string;
  kind: NavItemKind;
  label: string;
  href: string;
  desc: string;
  /** A views.ts gate id, or "" for a link everyone (with the launcher) can see. */
  view: string;
}

export interface NavMenu {
  id: string;
  title: string;
  blurb: string;
  /** Rows shown before "show more"; defaults to PREVIEW_ROWS when absent. */
  preview?: number;
  items: NavItem[];
}

export interface NavLayout {
  version: 1;
  menus: NavMenu[];
}

/**
 * The shipped launcher as a NavLayout — derived from AREAS so there is ONE
 * source of truth. Every default item is a "link"; ids are stable across loads
 * so a non-customized launcher keeps its React keys and expand state.
 */
export function defaultLayout(): NavLayout {
  return {
    version: 1,
    menus: AREAS.map((a) => ({
      id: a.id,
      title: a.title,
      blurb: a.blurb,
      preview: a.preview,
      items: a.dests.map((d, i) => ({
        id: `${a.id}:${d.view || d.href}:${i}`,
        kind: "link" as const,
        label: d.label,
        href: d.href,
        desc: d.desc,
        view: d.view,
      })),
    })),
  };
}

/** PREVIEW_ROWS re-exported so the launcher and editor share the one default. */
export { PREVIEW_ROWS };

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Coerce an untrusted value (a stored JSON blob, a request body) into a valid
 * NavLayout, or null when it can't be salvaged. A null result is the signal to
 * fall back to the shipped launcher, so validation is deliberately strict: a
 * layout with no menus, or menus with no id, is treated as absent rather than
 * rendered as an empty page.
 */
export function sanitizeLayout(raw: unknown): NavLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const menusRaw = (raw as { menus?: unknown }).menus;
  if (!Array.isArray(menusRaw)) return null;

  const menus: NavMenu[] = [];
  for (const m of menusRaw) {
    if (!m || typeof m !== "object") continue;
    const id = asString((m as { id?: unknown }).id).trim();
    if (!id) continue;
    const itemsRaw = (m as { items?: unknown }).items;
    const items: NavItem[] = [];
    if (Array.isArray(itemsRaw)) {
      for (const it of itemsRaw) {
        if (!it || typeof it !== "object") continue;
        const itemId = asString((it as { id?: unknown }).id).trim();
        const label = asString((it as { label?: unknown }).label).trim();
        const href = asString((it as { href?: unknown }).href).trim();
        // A link must go somewhere and be named; skip a half-built row rather
        // than render a blank, dead entry.
        if (!itemId || !label || !href) continue;
        const kind: NavItemKind =
          (it as { kind?: unknown }).kind === "button" ? "button" : "link";
        items.push({
          id: itemId,
          kind,
          label,
          href,
          desc: asString((it as { desc?: unknown }).desc),
          view: asString((it as { view?: unknown }).view).trim(),
        });
      }
    }
    const previewRaw = (m as { preview?: unknown }).preview;
    const preview =
      typeof previewRaw === "number" && Number.isFinite(previewRaw) && previewRaw > 0
        ? Math.floor(previewRaw)
        : undefined;
    menus.push({
      id,
      title: asString((m as { title?: unknown }).title).trim() || id,
      blurb: asString((m as { blurb?: unknown }).blurb),
      preview,
      items,
    });
  }

  if (menus.length === 0) return null;
  return { version: 1, menus };
}
