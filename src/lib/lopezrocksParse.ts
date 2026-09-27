/**
 * LopezRocks (lopezrocks.org) pages, read as data — the pure half of the
 * /lopezrocks page.
 *
 * LopezRocks is Lopez Island's community board. Every font size in its
 * stylesheet is a share of the screen width, so a phone draws its text about
 * four pixels tall. /lopezrocks draws the same content in this app's layout.
 *
 * PURE ⟂ — no fetch, no DB, no React — so the unit suite can feed it HTML. The
 * fetch and the cache are `src/lib/lopezrocks.ts`.
 *
 * NOTHING THIS RETURNS IS HTML. Text stays text, and every link is classified
 * once — a section, a post, another LopezRocks page, or an outside site — so
 * the page decides where each one goes. A post's own markup never reaches the
 * app, which is what makes it safe to show strangers' posts inside it.
 *
 * The HTML reader below is small on purpose, not a library: the whole site is
 * one PHP template, so a tolerant tag reader plus the handful of page shapes
 * here covers every page. When LopezRocks changes its template, a page falls
 * through to `generic` (headings, text, links, tables) instead of failing.
 */

export const LR_ORIGIN = "https://lopezrocks.org";

/* ----------------------------------------------------------------- types */

/** Where a LopezRocks link points. */
export type LrLink =
  | { kind: "home" }
  /** A section (Offered, Calendar…), optionally a later page of it. */
  | { kind: "section"; handle: string; type?: string; offset?: string; shuffle?: string }
  /** One post, event, business, story or discussion. */
  | {
      kind: "item";
      item: string;
      type?: string;
      ret?: string;
      menuHandle?: string;
      offset?: string;
      comment?: string;
    }
  /** Any other LopezRocks page (sign in, post, donate…) — opened on the site. */
  | { kind: "site"; href: string }
  /** Another website, an email address or a phone number. */
  | { kind: "external"; href: string };

/** A stretch of text, with its link if it had one. "\n" marks a line break. */
export interface LrRun {
  text: string;
  link?: LrLink;
}

export interface LrAction {
  label: string;
  link: LrLink;
}

export interface LrSection {
  handle: string;
  title: string;
}

export interface LrRow {
  title: string;
  link: LrLink;
  /** A second line: a directory entry's summary, a web address. */
  sub?: string;
  /** Quiet facts: the date, "Photo", "By …", "2 comments". */
  meta: string[];
}

export interface LrGroup {
  /** The site's keyword ("Take It", "Automotive"). Blank for an unlabelled run. */
  title: string;
  rows: LrRow[];
}

export interface LrDay {
  /** "Sun, Sep 27", as the site prints it. */
  label: string;
  /** "Sep 27" — what the page compares with today. */
  monthDay: string;
  events: { time: string; title: string; link: LrLink }[];
}

/** The grey box beside a post: who posted it and how to reach them. */
export interface LrPerson {
  lines: string[];
  phone?: string;
  email?: string;
  /** Lines that carry their own link, such as a website. */
  extras: LrRun[][];
  /** How many people pressed Agree, on a discussion. */
  agree?: string;
}

export interface LrImage {
  src: string;
  caption?: string;
}

export interface LrComment {
  by: LrPerson;
  body: LrRun[][];
}

export interface LrItem {
  title: string;
  /** Date first; an event adds time, place and price; a story adds "By …". */
  details: string[];
  /** A news story's standfirst — the line after "By …". */
  lead?: string;
  body: LrRun[][];
  images: LrImage[];
  /** "Read the article", a business's website. */
  links: LrAction[];
  person?: LrPerson;
  /** Send a Message, Share, Comment, Agree — all of them open on the site. */
  actions: LrAction[];
  comments: LrComment[];
  back?: LrAction;
  /** The News column's list of older stories. */
  otherNews: LrRow[];
  /** Anything else under the story, kept as plain blocks. */
  extra: LrBlock[];
}

export type LrBlock =
  | { kind: "heading"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "text"; runs: LrRun[] }
  | { kind: "links"; items: LrAction[] }
  | { kind: "table"; rows: string[][]; head: boolean }
  | { kind: "image"; src: string };

/** A section page's heading: its name, its one-line blurb, its buttons. */
export interface LrHead {
  title: string;
  desc: string;
  actions: LrAction[];
}

export interface LrSponsor {
  name: string;
  link: LrLink | null;
  logo?: string;
}

export type LrPage =
  | { kind: "home"; tagline: string; supporters: LrRun[]; sponsors: LrSponsor[] }
  | { kind: "list"; head: LrHead; groups: LrGroup[]; pager: LrAction[] }
  | { kind: "calendar"; head: LrHead; days: LrDay[]; pager: LrAction[] }
  | { kind: "item"; head: LrHead; item: LrItem }
  | { kind: "missing" }
  | { kind: "generic"; head: LrHead; blocks: LrBlock[] };

export interface LrParsed {
  /** The page's own title, less the "LopezRocks - " prefix. */
  title: string;
  /** The section menu down the left of every page — the site's own list. */
  sections: LrSection[];
  page: LrPage;
}

/**
 * Thrown for anything without the site's page frame — above all the
 * firewall's "checking your browser" step, which answers some requests from a
 * server instead of the page. A throw is what keeps that page out of the cache.
 */
export class LrNotAPage extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LrNotAPage";
  }
}

/* ------------------------------------------------------------ HTML reader */

/** One element of the parsed page. */
export interface El {
  tag: string;
  attrs: Record<string, string>;
  kids: (El | string)[];
  parent: El | null;
}

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

// An opening tag that first closes an open element of these kinds — the end
// tags HTML lets a page leave out, and the only ones this site leaves out.
const IMPLIED_END: Record<string, string[]> = {
  tr: ["td", "th", "tr"],
  td: ["td", "th"],
  th: ["td", "th"],
  li: ["li"],
  option: ["option"],
};

// A comment | a script or style with its body | a closing tag | an opening tag
// (attributes may hold ">" inside quotes) | a doctype | text | a stray "<".
const TOKEN =
  /<!--[\s\S]*?-->|<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<![^>]*>|[^<]+|</g;

// Attributes need no space between them: the site writes id="a"style="b".
const ATTR = /([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•",
  middot: "·", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", times: "×", cent: "¢", pound: "£",
  euro: "€", laquo: "«", raquo: "»", eacute: "é", egrave: "è", aacute: "á", agrave: "à", iacute: "í",
  oacute: "ó", uacute: "ú", ntilde: "ñ", ccedil: "ç", uuml: "ü", ouml: "ö", auml: "ä",
};

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,15});/g, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return NAMED[e] ?? all;
  });
}

/** Read a page into a tree, the way a browser would for this site's markup. */
export function parseHtml(html: string): El {
  const root: El = { tag: "#root", attrs: {}, kids: [], parent: null };
  let cur = root;
  for (const m of html.matchAll(TOKEN)) {
    const tok = m[0];
    if (m[1] || tok.startsWith("<!")) continue; // comment, script, style, doctype
    if (m[2]) {
      const tag = m[2].toLowerCase();
      let n: El | null = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent; // a closing tag with no open match is ignored
      continue;
    }
    if (m[3]) {
      const tag = m[3].toLowerCase();
      const closes = IMPLIED_END[tag];
      while (closes && closes.includes(cur.tag) && cur.parent) cur = cur.parent;
      // A cell straight inside a table body gets the row the page left out.
      if ((tag === "td" || tag === "th") && ["tbody", "thead", "tfoot", "table"].includes(cur.tag)) {
        const row: El = { tag: "tr", attrs: {}, kids: [], parent: cur };
        cur.kids.push(row);
        cur = row;
      }
      const attrs: Record<string, string> = {};
      const raw = m[4] ?? "";
      for (const a of raw.matchAll(ATTR)) {
        const name = a[1].toLowerCase();
        if (!(name in attrs)) attrs[name] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
      }
      const el: El = { tag, attrs, kids: [], parent: cur };
      cur.kids.push(el);
      if (!VOID.has(tag) && !/\/\s*$/.test(raw)) cur = el;
      continue;
    }
    cur.kids.push(decodeEntities(tok)); // text, or a stray "<" read as text
  }
  return root;
}

/* ---------------------------------------------------------- tree helpers */

function isEl(n: El | string): n is El {
  return typeof n !== "string";
}

function kids(el: El): El[] {
  return el.kids.filter(isEl);
}

function hasClass(el: El, c: string): boolean {
  return (el.attrs.class ?? "").split(/\s+/).includes(c);
}

function style(el: El): string {
  return el.attrs.style ?? "";
}

function findAll(el: El, pred: (e: El) => boolean, out: El[] = []): El[] {
  for (const k of el.kids) {
    if (!isEl(k)) continue;
    if (pred(k)) out.push(k);
    findAll(k, pred, out);
  }
  return out;
}

function find(el: El, pred: (e: El) => boolean): El | null {
  for (const k of el.kids) {
    if (!isEl(k)) continue;
    if (pred(k)) return k;
    const hit = find(k, pred);
    if (hit) return hit;
  }
  return null;
}

function byId(el: El, id: string): El | null {
  return find(el, (e) => e.attrs.id === id);
}

function nextEl(el: El): El | null {
  const sibs = el.parent ? el.parent.kids : [];
  for (let i = sibs.indexOf(el) + 1; i < sibs.length; i++) {
    const s = sibs[i];
    if (isEl(s)) return s;
  }
  return null;
}

function within(el: El, pred: (e: El) => boolean, stop: El): boolean {
  for (let n = el.parent; n && n !== stop; n = n.parent) if (pred(n)) return true;
  return false;
}

function rawText(n: El | string): string {
  if (typeof n === "string") return n;
  if (n.tag === "br") return " ";
  return n.kids.map(rawText).join("");
}

/** An element's words, with the page source's line breaks and tabs folded away. */
function text(n: El | string | null): string {
  return n ? rawText(n).replace(/\s+/g, " ").trim() : "";
}

/** "Posted by Ann<br>Lopez Island<br>Sep 25" → ["Posted by Ann", "Lopez Island", "Sep 25"] */
function brLines(el: El): string[] {
  const out: string[] = [];
  let line = "";
  for (const k of el.kids) {
    if (isEl(k) && k.tag === "br") {
      out.push(line);
      line = "";
    } else line += rawText(k);
  }
  out.push(line);
  return out.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function hrefOf(el: El): string {
  return el.tag === "a" ? (el.attrs.href ?? "").trim() : "";
}

function linksIn(el: El): El[] {
  return findAll(el, (e) => hrefOf(e) !== "");
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ----------------------------------------------------------------- links */

const DIGITS = /^\d{1,12}$/;
const WORD = /^[a-z]{1,16}$/;
const RET = /^[a-z0-9]{0,16}$/;
const OFFSET = /^[0-9-]{1,20}$/;
const SHUFFLE = /^[01]?$/;
// The section types whose pages the app draws itself. Anything else with a
// `type` (login, about, search…) is a page for the site.
const SECTION_TYPES = new Set(["postit", "forum", "classes", "directory", "calendar", "links", "news"]);

/** Decide where one of the site's links points. Null for one that goes nowhere. */
export function classifyHref(href: string): LrLink | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return null;
  if (/^mailto:/i.test(raw)) {
    const addr = raw.replace(/^mailto:\s*/i, "").trim();
    return addr ? { kind: "external", href: `mailto:${addr}` } : null;
  }
  if (/^tel:/i.test(raw)) return { kind: "external", href: raw.replace(/\s+/g, "") };
  let u: URL;
  try {
    u = new URL(raw, `${LR_ORIGIN}/`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.hostname.replace(/^www\./, "") !== "lopezrocks.org") return { kind: "external", href: u.href };

  const path = u.pathname.replace(/^\/+/, "");
  const q = u.searchParams;
  if (path === "" || path === "index.php") return { kind: "home" };
  if (path === "page.php") {
    const type = q.get("type") ?? "";
    const item = q.get("item_handle") ?? "";
    const handle = q.get("handle") ?? "";
    if (type === "item" && DIGITS.test(item)) {
      const link: LrLink = { kind: "item", item };
      const menuType = q.get("menu_type") ?? "";
      const ret = q.get("return") ?? "";
      const menuHandle = q.get("menu_handle") ?? "";
      const offset = q.get("offset") ?? "";
      const comment = q.get("comment_handle") ?? "";
      if (WORD.test(menuType)) link.type = menuType;
      if (ret && RET.test(ret)) link.ret = ret;
      if (DIGITS.test(menuHandle)) link.menuHandle = menuHandle;
      if (offset && offset !== "0" && OFFSET.test(offset)) link.offset = offset;
      if (DIGITS.test(comment)) link.comment = comment;
      return link;
    }
    if (DIGITS.test(handle) && (type === "" || SECTION_TYPES.has(type))) {
      const link: LrLink = { kind: "section", handle };
      const offset = q.get("offset") ?? "";
      const shuffle = q.get("shuffle");
      if (type) link.type = type;
      if (offset && offset !== "0" && OFFSET.test(offset)) link.offset = offset;
      if (shuffle && SHUFFLE.test(shuffle)) link.shuffle = shuffle;
      return link;
    }
  }
  return { kind: "site", href: `${LR_ORIGIN}/${path}${u.search}` };
}

/** The request the server makes for a page this app draws. Null for any other link. */
export function upstreamPath(link: LrLink): string | null {
  if (link.kind === "home") return "index.php";
  if (link.kind === "section") {
    const q = new URLSearchParams();
    if (link.type) q.set("type", link.type);
    q.set("handle", link.handle);
    // The site's own "postit" pager always sends shuffle, empty or not.
    if (link.shuffle !== undefined || link.type === "postit") q.set("shuffle", link.shuffle ?? "");
    if (link.offset) q.set("offset", link.offset);
    return `page.php?${q.toString()}`;
  }
  if (link.kind === "item") {
    const q = new URLSearchParams({ type: "item", item_handle: link.item });
    if (link.type) q.set("menu_type", link.type);
    if (link.ret) q.set("return", link.ret);
    if (link.menuHandle) q.set("menu_handle", link.menuHandle);
    if (link.offset) q.set("offset", link.offset);
    if (link.comment) q.set("comment_handle", link.comment);
    return `page.php?${q.toString()}`;
  }
  return null;
}

/** The same page on lopezrocks.org itself — "Open on LopezRocks". */
export function siteHref(link: LrLink): string {
  if (link.kind === "site" || link.kind === "external") return link.href;
  return `${LR_ORIGIN}/${upstreamPath(link) ?? ""}`;
}

/** The app's own address for a page it draws; the site's address for the rest. */
export function readerHref(link: LrLink): string {
  if (link.kind === "home") return "/lopezrocks";
  if (link.kind === "section") {
    const q = new URLSearchParams({ s: link.handle });
    if (link.type) q.set("t", link.type);
    if (link.offset) q.set("o", link.offset);
    if (link.shuffle) q.set("d", link.shuffle);
    return `/lopezrocks?${q.toString()}`;
  }
  if (link.kind === "item") {
    const q = new URLSearchParams({ i: link.item });
    if (link.type) q.set("t", link.type);
    if (link.ret) q.set("r", link.ret);
    if (link.menuHandle) q.set("m", link.menuHandle);
    if (link.offset) q.set("o", link.offset);
    if (link.comment) q.set("c", link.comment);
    return `/lopezrocks?${q.toString()}`;
  }
  return link.href;
}

/** True when a link opens inside the app rather than on another site. */
export function isReaderLink(link: LrLink): link is Extract<LrLink, { kind: "home" | "section" | "item" }> {
  return link.kind === "home" || link.kind === "section" || link.kind === "item";
}

type Query = Record<string, string | string[] | undefined>;

/**
 * Read /lopezrocks?… back into a link. Every value is checked against the
 * shape the site uses, and anything malformed is the home page — so the
 * address bar can never make the server fetch a page this file did not build.
 */
export function linkFromQuery(query: Query): LrLink {
  const one = (k: string): string => {
    const v = query[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const type = one("t");
  const offset = one("o");
  if (DIGITS.test(one("i"))) {
    const link: LrLink = { kind: "item", item: one("i") };
    if (WORD.test(type)) link.type = type;
    if (one("r") && RET.test(one("r"))) link.ret = one("r");
    if (DIGITS.test(one("m"))) link.menuHandle = one("m");
    if (OFFSET.test(offset)) link.offset = offset;
    if (DIGITS.test(one("c"))) link.comment = one("c");
    return link;
  }
  if (DIGITS.test(one("s"))) {
    const link: LrLink = { kind: "section", handle: one("s") };
    if (SECTION_TYPES.has(type)) link.type = type;
    if (OFFSET.test(offset)) link.offset = offset;
    if (one("d") && SHUFFLE.test(one("d"))) link.shuffle = one("d");
    return link;
  }
  return { kind: "home" };
}

/* ---------------------------------------------------------------- pieces */

/** A picture worth showing: not one of the site's own icons, and served over https. */
function contentImage(src: string | undefined): string | undefined {
  const s = (src ?? "").trim();
  if (!s || /^\/?images\//i.test(s)) return undefined;
  try {
    const u = new URL(s, `${LR_ORIGIN}/`);
    if (u.hostname.replace(/^www\./, "") === "lopezrocks.org") return `${LR_ORIGIN}${u.pathname}${u.search}`;
    return u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** An element's content as text runs — links kept, line breaks as "\n". */
function runsOf(el: El): LrRun[] {
  const out: LrRun[] = [];
  const push = (t: string, link?: LrLink) => {
    const last = out[out.length - 1];
    if (!link && last && !last.link) last.text += t;
    else out.push(link ? { text: t, link } : { text: t });
  };
  const walk = (n: El | string) => {
    if (typeof n === "string") return push(n.replace(/[ \t\r\n\f]+/g, " "));
    if (n.tag === "br") return push("\n");
    if (n.tag === "img" || n.tag === "script" || n.tag === "style" || n.tag === "input") return;
    const link = hrefOf(n) ? classifyHref(hrefOf(n)) : null;
    if (link) {
      const t = text(n);
      if (t) push(t, link);
      return;
    }
    n.kids.forEach(walk);
  };
  el.kids.forEach(walk);
  // Tidy: no spaces hugging a line break, no blank edges.
  for (const r of out) r.text = r.text.replace(/ *\n */g, "\n");
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    const last = out[out.length - 1];
    last.text = last.text.replace(/\s+$/, "");
  }
  return out.filter((r) => r.text !== "");
}

// A number, optionally labelled: "360.555.0100", "360.555.0100 (cell)".
const PHONE = /^\+?[\d().\-\s]{7,20}(\s*\((cell|mobile|home|work|office|text)\))?$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NEWS_DATE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;

/** "Sep 25, 2026: <story>" — one entry of the News column. */
function isNewsEntry(p: El): boolean {
  const as = linksIn(p);
  return as.length >= 2 && NEWS_DATE.test(text(as[0]));
}

function actionLabel(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (/send a message/i.test(t)) return "Send a Message";
  if (/share this|email the link/i.test(t)) return "Share";
  if (/comment/i.test(t)) return "Comment";
  if (/agree/i.test(t)) return "Agree";
  return t;
}

/** The grey box: lines, phone, email, linked lines, the Agree count, the buttons. */
function personOf(side: El): { person: LrPerson; actions: LrAction[] } {
  const box = find(side, (e) => /dcdcdc/i.test(style(e))) ?? side;
  const person: LrPerson = { lines: [], extras: [] };
  for (const c of kids(box)) {
    if (!hasClass(c, "p") || isNewsEntry(c)) continue;
    const as = linksIn(c);
    if (as.length) {
      const first = classifyHref(hrefOf(as[0]));
      if (as.length === 1 && first?.kind === "external" && first.href.startsWith("mailto:") && !person.email) {
        person.email = first.href.slice("mailto:".length);
      } else {
        const runs = runsOf(c);
        if (runs.length) person.extras.push(runs);
      }
      continue;
    }
    for (const l of brLines(c)) {
      const digits = l.replace(/\D/g, "");
      // The site can print the same number twice ("360…" and "360… (cell)").
      if (person.phone && PHONE.test(l) && digits === person.phone.replace(/\D/g, "")) continue;
      if (!person.phone && PHONE.test(l) && digits.length >= 7) person.phone = l;
      else if (!person.email && EMAIL.test(l)) person.email = l;
      else person.lines.push(l);
    }
  }
  const agree = find(box, (e) => hasClass(e, "small") && /^\d+$/.test(text(e)));
  if (agree && text(agree) !== "0") person.agree = text(agree);

  // Every other link in the box is a button — by its words, or by its tooltip
  // when the site drew it as a picture. Listed once each.
  const actions: LrAction[] = [];
  const seen = new Set<string>();
  for (const a of linksIn(box)) {
    if (within(a, (e) => hasClass(e, "p"), box)) continue;
    const link = classifyHref(hrefOf(a));
    const label = actionLabel(text(a) || a.attrs.title || "");
    if (!link || !label || seen.has(label)) continue;
    seen.add(label);
    actions.push({ label, link });
  }
  return { person, actions };
}

function emptyPerson(p: LrPerson): boolean {
  return !p.lines.length && !p.extras.length && !p.phone && !p.email && !p.agree;
}

/** A section page's heading blocks — everything floated before the content. */
function headOf(main: El): { head: LrHead; blocks: El[] } {
  const blocks = kids(main).filter(
    (c) => c.tag === "div" && c.attrs.id !== "div-center" && /float:\s*left/i.test(style(c)),
  );
  let title = "";
  let desc = "";
  for (const b of blocks) {
    const t = find(b, (e) => hasClass(e, "h2"));
    if (!t) continue;
    title = text(t);
    const d = t.parent ? kids(t.parent).find((e) => hasClass(e, "p")) : undefined;
    desc = d ? text(d) : "";
    break;
  }
  const actions: LrAction[] = [];
  for (const b of blocks) {
    for (const a of linksIn(b)) {
      let label = text(a);
      const link = classifyHref(hrefOf(a));
      if (!label || !link) continue;
      // "Change Display" says little; its tooltip says what it does.
      if (link.kind === "section" && link.shuffle !== undefined) {
        const tip = (a.attrs.title ?? "").replace(/^click here to\s+/i, "").trim();
        if (tip) label = capitalise(tip);
      }
      actions.push({ label, link });
    }
  }
  return { head: { title, desc, actions }, blocks };
}

function hiddenInputs(form: El): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of findAll(form, (e) => e.tag === "input" && (e.attrs.type ?? "").toLowerCase() === "hidden")) {
    if (i.attrs.name && !(i.attrs.name in out)) out[i.attrs.name] = i.attrs.value ?? "";
  }
  return out;
}

function submitLabel(form: El): { label: string; tip: string } {
  const b = find(form, (e) => e.tag === "button" || (e.tag === "input" && (e.attrs.type ?? "") === "submit"));
  if (!b) return { label: "", tip: "" };
  return { label: b.tag === "button" ? text(b) : (b.attrs.value ?? "").trim(), tip: b.attrs.title ?? "" };
}

/**
 * The site's Next and Back buttons are small POST forms. The same fields work
 * as an ordinary GET, which is what lets them become plain links here.
 */
function formLink(form: El): LrLink | null {
  const h = hiddenInputs(form);
  if (!DIGITS.test(h.handle ?? "")) return null;
  const link: LrLink = { kind: "section", handle: h.handle };
  const offset = h.offset ?? "";
  if (offset && offset !== "0" && OFFSET.test(offset)) link.offset = offset;
  if (h.type && SECTION_TYPES.has(h.type)) link.type = h.type;
  // A post's Back button names its list as menu_type; a later page of a
  // "postit" list is only reachable with type=postit.
  else if (link.offset && h.menu_type === "postit") link.type = "postit";
  if (h.shuffle && SHUFFLE.test(h.shuffle)) link.shuffle = h.shuffle;
  return link;
}

const PAGER = /^(next|previous|prev|more|earlier|later)\b/i;

function pagerOf(root: El): LrAction[] {
  const out: LrAction[] = [];
  for (const f of findAll(root, (e) => e.tag === "form")) {
    const { label } = submitLabel(f);
    const link = PAGER.test(label) ? formLink(f) : null;
    if (link) out.push({ label: /^next$/i.test(label) ? "Next page" : label, link });
  }
  return out;
}

function backOf(root: El): LrAction | undefined {
  for (const f of findAll(root, (e) => e.tag === "form")) {
    const { label, tip } = submitLabel(f);
    if (!/^back\b/i.test(label)) continue;
    const link = formLink(f);
    if (!link) continue;
    const to = tip.replace(/^go back to\s+/i, "").trim();
    return { label: to && to !== tip ? `Back to ${to}` : "Back", link };
  }
  return undefined;
}

function isBackOrPager(el: El): boolean {
  if (el.tag !== "form") return false;
  const { label } = submitLabel(el);
  return PAGER.test(label) || /^back\b/i.test(label);
}

/* ------------------------------------------------------------- the shapes */

const LIST_CELL = /(^|\s)(pi|fm|cl|di|li)-/;

/** Offered, Wanted, Message Board, Housing, Employment, Organizations, Businesses,
 *  Classes, Let's Talk, Useful Links: one table, a keyword wherever a group starts. */
function listOf(scope: El): LrGroup[] | null {
  const table = findAll(scope, (e) => e.tag === "table").find(
    (t) => find(t, (e) => (e.tag === "td" || e.tag === "th") && LIST_CELL.test(e.attrs.class ?? "")) !== null,
  );
  if (!table) return null;
  const groups: LrGroup[] = [];
  let cur: LrGroup | null = null;
  for (const tr of findAll(table, (e) => e.tag === "tr")) {
    const cells = kids(tr).filter((c) => c.tag === "td" || c.tag === "th");
    const kwCell = cells.find((c) => /-keyword\b/.test(c.attrs.class ?? ""));
    // A keyword cell that holds the row's own link is its title, not a group
    // name — Farm to Market puts each farm's name there.
    const kw = kwCell && !linksIn(kwCell).length ? text(kwCell).replace(/^\*+|\*+$/g, "").trim() : "";
    if (kw || !cur) {
      cur = { title: kw, rows: [] };
      groups.push(cur);
    }
    const row = rowOf(tr, cells);
    if (row) cur.rows.push(row);
  }
  return groups.filter((g) => g.rows.length > 0);
}

/** "(Sep 26)" → ["Sep 26"]; "(By Ann on Sep 9, 2026) - 1 comment" → ["By Ann on Sep 9, 2026", "1 comment"] */
export function tailMeta(tail: string): string[] {
  const t = tail.replace(/\s+/g, " ").trim();
  if (!t) return [];
  return t
    .split(/\s+-\s+/)
    .map((p) => p.trim().replace(/^\((.*)\)$/, "$1").trim())
    .filter(Boolean);
}

function rowOf(tr: El, cells: El[]): LrRow | null {
  const a = linksIn(tr)[0];
  if (!a) return null; // "Continues on next page..."
  const link = classifyHref(hrefOf(a));
  if (!link) return null;
  const cell = (re: RegExp) => cells.find((c) => re.test(c.attrs.class ?? ""));
  const titleCell = cell(/-title\b/);
  const dateCell = cell(/-date\b/);
  const sumCell = cell(/-summary\b/);
  const title = titleCell ? text(titleCell) : text(a);
  if (!title) return null;

  const meta: string[] = [];
  const date = text(dateCell ?? null);
  if (date) meta.push(date);
  // Whatever the cell says after the link: "(Sep 26)", "(By Ann) - 2 comments".
  const linkCell = a.parent;
  if (linkCell && !titleCell) {
    const i = linkCell.kids.indexOf(a);
    meta.push(...tailMeta(linkCell.kids.slice(i + 1).map((k) => (isEl(k) ? text(k) : k)).join(" ")));
  }
  if (find(tr, (e) => e.tag === "img" && /images\/image\./i.test(e.attrs.src ?? ""))) meta.push("Photo");
  if (find(tr, (e) => e.tag === "img" && /sponsored/i.test(e.attrs.src ?? ""))) meta.push("Sponsor");

  const sub = sumCell ? text(sumCell) : titleCell ? text(a) : "";
  return sub ? { title, link, sub, meta } : { title, link, meta };
}

const DAY = /^[A-Z][a-z]{2}, ([A-Z][a-z]{2} \d{1,2})$/;

/** The Calendar: a heading per day, then "10:30am:" + the event, per line. */
function calendarOf(scope: El): LrDay[] | null {
  const tabs = findAll(scope, (e) => hasClass(e, "tabs") && DAY.test(text(e)));
  if (!tabs.length) return null;
  return tabs.map((tab) => {
    const label = text(tab);
    const box = nextEl(tab);
    const events: LrDay["events"] = [];
    for (const p of box ? findAll(box, (e) => hasClass(e, "p")) : []) {
      const as = linksIn(p);
      const last = as[as.length - 1];
      const link = last ? classifyHref(hrefOf(last)) : null;
      if (!last || !link) continue;
      events.push({ time: as.length > 1 ? text(as[0]).replace(/:$/, "") : "", title: text(last), link });
    }
    return { label, monthDay: DAY.exec(label)![1], events };
  });
}

function isStoryCol(c: El): boolean {
  return c.tag === "div" && /width:\s*7\d%/.test(style(c));
}

function isSideCol(c: El): boolean {
  return c.tag === "div" && /width:\s*25%/.test(style(c));
}

/**
 * One post, event, business, story or discussion. The page is pairs of
 * columns — a grey box, then the story — and on a discussion every comment
 * after the first pair is another pair.
 */
function itemOf(center: El): LrItem | null {
  const cols = kids(center);
  const first = cols.findIndex((c) => isStoryCol(c) && kids(c).some((k) => hasClass(k, "h3")));
  if (first < 0) return null;
  const main = cols[first];
  const side = first > 0 && isSideCol(cols[first - 1]) ? cols[first - 1] : null;
  const titleEl = kids(main).find((k) => hasClass(k, "h3"))!;

  const item: LrItem = {
    title: text(titleEl),
    details: [],
    body: [],
    images: [],
    links: [],
    actions: [],
    comments: [],
    otherNews: [],
    extra: [],
  };

  const rest = kids(main).filter((k) => k !== titleEl);
  const textCol = rest.find((c) => c.tag === "div" && kids(c).some((k) => hasClass(k, "h5") || hasClass(k, "p")));
  const imgCol = rest.find((c) => c !== textCol && c.tag === "div" && kids(c).some((k) => kids(k).some((i) => i.tag === "img")));

  if (textCol) {
    let afterBy = false;
    for (const c of kids(textCol)) {
      if (hasClass(c, "h5")) {
        const t = text(c);
        if (!t) continue;
        if (afterBy && !item.lead) item.lead = t;
        else item.details.push(t);
        afterBy = /^by\s/i.test(t);
        continue;
      }
      const runs = runsOf(c);
      if (runs.length) item.body.push(runs);
      for (const img of findAll(c, (e) => e.tag === "img")) {
        const src = contentImage(img.attrs.src);
        if (src) item.images.push({ src });
      }
    }
  }
  if (imgCol) {
    for (const b of kids(imgCol)) {
      const img = find(b, (e) => e.tag === "img");
      const src = contentImage(img?.attrs.src);
      if (!src) continue;
      const cap = text(find(b, (e) => hasClass(e, "p")));
      item.images.push(cap ? { src, caption: cap } : { src });
    }
  }
  // Anything else in the story column: "Read the article", a website.
  for (const c of rest) {
    if (c === textCol || c === imgCol) continue;
    for (const a of linksIn(c)) {
      const link = classifyHref(hrefOf(a));
      const label = text(a);
      if (link && label) item.links.push({ label, link });
    }
    if (!linksIn(c).length && text(c)) item.extra.push({ kind: "text", runs: runsOf(c) });
  }

  if (side) {
    const { person, actions } = personOf(side);
    if (!emptyPerson(person)) item.person = person;
    item.actions = actions;
    for (const p of findAll(side, (e) => hasClass(e, "p") && isNewsEntry(e))) {
      const as = linksIn(p);
      const last = as[as.length - 1];
      const link = classifyHref(hrefOf(last));
      if (link) item.otherNews.push({ title: text(last), link, meta: [text(as[0])] });
    }
  }

  // Comments: every later story column, with the grey box before it.
  const used = new Set<El>([main]);
  if (side) used.add(side);
  for (let i = first + 1; i < cols.length; i++) {
    const c = cols[i];
    if (!isStoryCol(c)) continue;
    const box = isSideCol(cols[i - 1]) && !used.has(cols[i - 1]) ? cols[i - 1] : null;
    used.add(c);
    if (box) used.add(box);
    const body = findAll(c, (e) => hasClass(e, "p"))
      .map(runsOf)
      .filter((r) => r.length > 0);
    if (body.length) item.comments.push({ by: box ? personOf(box).person : { lines: [], extras: [] }, body });
  }

  item.back = backOf(center);
  // Anything left under the story keeps its place as plain blocks.
  for (const c of cols) {
    if (used.has(c) || isBackOrPager(c) || isSideCol(c) || isStoryCol(c)) continue;
    blocksOf(c, item.extra);
  }
  return item;
}

function tableOf(t: El): LrBlock {
  const rows = findAll(t, (e) => e.tag === "tr")
    .map((tr) => kids(tr).filter((c) => c.tag === "td" || c.tag === "th").map((c) => text(c)))
    .filter((r) => r.some(Boolean));
  const firstRow = find(t, (e) => e.tag === "tr");
  const head =
    !!firstRow &&
    kids(firstRow).every((c) => c.tag === "th" || (text(c) !== "" && kids(c).some((k) => k.tag === "b" || k.tag === "strong")));
  return { kind: "table", rows, head };
}

function pushLinks(out: LrBlock[], items: LrAction[]) {
  if (!items.length) return;
  const last = out[out.length - 1];
  if (last && last.kind === "links") last.items.push(...items);
  else out.push({ kind: "links", items });
}

function linkActions(el: El): LrAction[] {
  const out: LrAction[] = [];
  for (const a of linksIn(el)) {
    const link = classifyHref(hrefOf(a));
    const label = text(a);
    if (link && label) out.push({ label, link });
  }
  return out;
}

/** Any page not named above, as headings, paragraphs, link lists and tables. */
function blocksOf(el: El, out: LrBlock[] = []): LrBlock[] {
  for (const k of el.kids) {
    if (!isEl(k)) {
      const t = k.replace(/\s+/g, " ").trim();
      if (t) out.push({ kind: "text", runs: [{ text: t }] });
      continue;
    }
    if (["form", "script", "style", "input", "button", "select", "textarea", "br", "hr"].includes(k.tag)) continue;
    if (k.tag === "table") {
      const t = tableOf(k);
      if (t.kind === "table" && t.rows.length) out.push(t);
      continue;
    }
    if (k.tag === "img") {
      const src = contentImage(k.attrs.src);
      if (src) out.push({ kind: "image", src });
      continue;
    }
    const heading = hasClass(k, "tabs") || /^h[1-4]$/.test(k.tag) || ["h1", "h2", "h3", "h4"].some((c) => hasClass(k, c));
    const sub = k.tag === "h5" || k.tag === "h6" || hasClass(k, "h5");
    if (heading || sub) {
      if (linksIn(k).length) pushLinks(out, linkActions(k));
      else if (text(k)) out.push({ kind: heading ? "heading" : "subheading", text: text(k) });
      continue;
    }
    if (hasClass(k, "p") || hasClass(k, "small") || k.tag === "p" || k.tag === "li") {
      const runs = runsOf(k);
      if (runs.length && runs.every((r) => r.link || !r.text.trim())) {
        pushLinks(out, runs.filter((r) => r.link).map((r) => ({ label: r.text, link: r.link! })));
      } else if (runs.length) out.push({ kind: "text", runs });
      continue;
    }
    if (hrefOf(k)) {
      const link = classifyHref(hrefOf(k));
      if (link && text(k)) pushLinks(out, [{ label: text(k), link }]);
      continue;
    }
    blocksOf(k, out);
  }
  return out;
}

/** The front page: the sponsors who pay for the site, and a supporter's name. */
function homeOf(root: El, main: El): LrPage {
  const sponsors: LrSponsor[] = [];
  const seen = new Set<string>();
  for (const a of findAll(main, (e) => e.tag === "a" && hasClass(e, "sponsor"))) {
    const img = find(a, (e) => e.tag === "img");
    if (!img) continue;
    const box = a.parent;
    const name =
      (box ? findAll(box, (e) => e.tag === "a" && hasClass(e, "sponsor")).map((x) => text(x)).find(Boolean) : "") ||
      (a.attrs.title ?? "").replace(/^Visit\s+/, "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const logo = contentImage(img.attrs.src);
    sponsors.push({ name, link: classifyHref(hrefOf(a)), ...(logo ? { logo } : {}) });
  }
  const note = find(main, (e) => e.tag === "h5");
  return {
    kind: "home",
    tagline: text(find(root, (e) => hasClass(e, "subbanner"))),
    supporters: note ? runsOf(note) : [],
    sponsors,
  };
}

/* ------------------------------------------------------------------- read */

/** Read one LopezRocks page. Throws `LrNotAPage` for anything without the site's frame. */
export function parseLopezRocks(html: string): LrParsed {
  const root = parseHtml(html);
  if (!byId(root, "screen") || !byId(root, "left-menu")) {
    throw new LrNotAPage("The response was not a LopezRocks page");
  }
  const title = text(find(root, (e) => e.tag === "title")).replace(/^LopezRocks\s*-?\s*/i, "").trim();
  const sections: LrSection[] = [];
  for (const a of linksIn(byId(root, "left-menu")!)) {
    const link = classifyHref(hrefOf(a));
    if (link?.kind === "section" && text(a)) sections.push({ handle: link.handle, title: text(a) });
  }
  const main = byId(root, "main");
  if (!main) return { title, sections, page: { kind: "missing" } };

  // The front page reuses the id "div-center" for its rows of sponsors, so it
  // is recognised first, by the sponsors themselves.
  if (findAll(main, (e) => e.tag === "a" && hasClass(e, "sponsor")).length >= 3) {
    return { title, sections, page: homeOf(root, main) };
  }
  const { head, blocks } = headOf(main);
  const center = byId(main, "div-center");
  if (!center) {
    if (/cannot be found/i.test(text(main))) return { title, sections, page: { kind: "missing" } };
    const loose: LrBlock[] = [];
    for (const c of kids(main)) if (!blocks.includes(c)) blocksOf(c, loose);
    return { title, sections, page: { kind: "generic", head, blocks: loose } };
  }

  const item = itemOf(center);
  if (item) return { title, sections, page: { kind: "item", head, item } };
  const days = calendarOf(center);
  if (days) return { title, sections, page: { kind: "calendar", head, days, pager: pagerOf(center) } };
  const groups = listOf(center);
  if (groups && groups.length) return { title, sections, page: { kind: "list", head, groups, pager: pagerOf(center) } };
  return { title, sections, page: { kind: "generic", head, blocks: blocksOf(center) } };
}
