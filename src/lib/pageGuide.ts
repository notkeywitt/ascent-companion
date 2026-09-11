/**
 * THE PAGE GUIDE — per-element help, written by an admin from inside the app.
 *
 * `help.ts` answers a QUESTION ("How do I clock in?"). This answers "what is
 * that thing on the screen?": one topic per element on one page, anchored to
 * the element by a CSS selector so the guide can point an arrow at it.
 *
 * PURE module (no DB, no React) so the route, the overlay and the tests all
 * read the same rules. The topics are data in the companion DB, not code —
 * an admin writes them in the overlay itself, the same override-only model as
 * `nav_layout`: no row for a page simply means that page has no guide yet.
 */

export interface GuideTopic {
  /** Stable id inside the page's guide. Generated when the topic is added. */
  id: string;
  /** The element's name, as the reader would point at it. */
  label: string;
  /** CSS selector for the element the arrow points at. Empty = no arrow. */
  selector: string;
  /** The full description, shown in the bottom pane. */
  body: string;
}

/**
 * The key one guide is stored under.
 *
 * A guide belongs to a PAGE, not to one record, so `/bill/22ab9x` and
 * `/bill/70cd1z` must share it. There is no route pattern on the client, so a
 * segment that does not read as a word (it carries a digit, or is long) is
 * treated as a record id and folded to `*`: `/bill/22ab9x` → `/bill/*`.
 */
export function guidePathKey(pathname: string): string {
  const segs = pathname.split("?")[0].split("/").filter(Boolean);
  if (segs.length === 0) return "/";
  return "/" + segs.map((s) => (/^[a-z][a-z-]{0,23}$/.test(s) ? s : "*")).join("/");
}

/** Drop anything malformed. A bad row must never break the overlay. */
export function normalizeTopics(input: unknown): GuideTopic[] {
  if (!Array.isArray(input)) return [];
  const out: GuideTopic[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const id = typeof t.id === "string" ? t.id.trim() : "";
    const label = typeof t.label === "string" ? t.label.trim() : "";
    if (!id || !label) continue;
    if (out.some((o) => o.id === id)) continue;
    out.push({
      id,
      label: label.slice(0, 80),
      selector: typeof t.selector === "string" ? t.selector.trim().slice(0, 400) : "",
      body: typeof t.body === "string" ? t.body.slice(0, 2000) : "",
    });
  }
  return out.slice(0, 40);
}

/** Parse a stored guide row. Any failure reads as "no guide". */
export function parseGuide(json: string): GuideTopic[] {
  try {
    return normalizeTopics(JSON.parse(json));
  } catch {
    return [];
  }
}

/**
 * A selector for the element an admin clicked, walking up to the first id.
 *
 * `nth-of-type` rather than `nth-child` so a sibling appearing above the
 * element (a banner, an error) does not move the anchor. Browser-only — it
 * touches `document` — but it lives here so the rule is next to the type it
 * fills in.
 */
export function selectorFor(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && parts.length < 8) {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    const tag = node.tagName.toLowerCase();
    const twins = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    parts.unshift(twins.length > 1 ? `${tag}:nth-of-type(${twins.indexOf(node) + 1})` : tag);
    node = parent;
  }
  return parts.join(" > ");
}
