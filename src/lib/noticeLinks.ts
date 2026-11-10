/**
 * Links inside a notice's message.
 *
 * PURE module — no React — so the reader's banner and popup, and the authoring
 * panel's preview, split a message the same way.
 *
 * Three ways to write a link, all plain text in the stored body:
 *   - `[Try it](/employee-time?tab=compare&view=calendar)` — a label and a target.
 *   - a bare app path, `/tool-schedule?view=calendar` — shown as written.
 *   - a bare web address, `https://…` — shown as written.
 *
 * A target is either an app path (starts with one `/`) or an http(s) address.
 * An address on the app's own site is folded back to its path, so the office can
 * paste whatever the address bar shows and it opens in-app, in the same tab.
 * Anything else (`javascript:`, `mailto:`, a typo) stays plain text: a notice
 * reaches every phone, so it never carries a link the browser would run.
 */

export type NoticePart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string; internal: boolean };

/** `[label](target)`, a bare web address, or a bare `/path` at a word start. */
const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+)|(?<![\w/])(\/[A-Za-z][^\s<>()]*)/g;

/** Trailing punctuation that ends a sentence, not an address. */
const TRAILING = /[.,;:!?'"]+$/;

/**
 * The href a target opens, or null when it is not a safe link.
 * `origin` is the app's own origin (e.g. `window.location.origin`), or "".
 */
export function resolveNoticeHref(
  target: string,
  origin = "",
): { href: string; internal: boolean } | null {
  const t = target.trim();
  // One slash: an app path. Two slashes is a protocol-relative address — refuse it.
  if (/^\/(?!\/)/.test(t)) return { href: t, internal: true };
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (origin && url.origin === origin) {
    return { href: `${url.pathname}${url.search}${url.hash}` || "/", internal: true };
  }
  return { href: url.toString(), internal: false };
}

/** Split a notice message into text and link parts, in order. */
export function parseNoticeBody(body: string, origin = ""): NoticePart[] {
  const parts: NoticePart[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.text += text;
    else parts.push({ kind: "text", text });
  };

  let at = 0;
  for (const m of body.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    pushText(body.slice(at, start));
    const [whole, label, labelled, bareUrl, barePath] = m;
    let raw = labelled ?? bareUrl ?? barePath ?? "";
    let tail = "";
    if (!labelled) {
      tail = raw.match(TRAILING)?.[0] ?? "";
      raw = raw.slice(0, raw.length - tail.length);
    }
    const target = resolveNoticeHref(raw, origin);
    if (target) parts.push({ kind: "link", text: label ?? raw, ...target });
    else pushText(labelled ? whole : raw);
    pushText(tail);
    at = start + whole.length;
  }
  pushText(body.slice(at));
  return parts;
}

/** True when the message holds at least one link. */
export function hasNoticeLink(body: string, origin = ""): boolean {
  return parseNoticeBody(body, origin).some((p) => p.kind === "link");
}

/** The message as plain text — a labelled link reads as its label. For the desktop toast. */
export function noticePlainText(body: string, origin = ""): string {
  return parseNoticeBody(body, origin)
    .map((p) => p.text)
    .join("");
}

/** The first link in the message, or null. A desktop toast opens it when clicked. */
export function firstNoticeLink(body: string, origin = ""): { href: string; internal: boolean } | null {
  const link = parseNoticeBody(body, origin).find((p) => p.kind === "link");
  return link && link.kind === "link" ? { href: link.href, internal: link.internal } : null;
}
