/**
 * A job's homeowner's manual — the page Ascent hands the client at close-out
 * (first one: ascentbuildingco.com/cherry-tree, built by hand in Squarespace).
 *
 * PURE module: the page, the route and the test all import it. The route
 * builds a first draft from what the app already knows (the job's vendors in
 * JobTread, its imported spec list), the office edits it on /house-manual, and
 * `manualHtml` turns it into ONE self-contained block for a Squarespace Code
 * Block. Squarespace has no API for page content, so copy and paste is the
 * hand-off. The block carries no script: `<details>` gives the accordion.
 *
 * `sources` are the job's Drive files and folders linked to the manual. They
 * stay in the editor: `manualHtml` never prints them.
 */

import type { SpecList } from "@/lib/specList";

export interface ManualContact {
  /** JobTread vendor account, when the contact came from one. */
  vendorId?: string;
  trade: string;
  name: string;
  phone: string;
  email: string;
  url: string;
}

export interface ManualItem {
  label: string;
  value: string;
  url: string;
}

/** A titled group of items inside a section (e.g. Appliances › Laundry). */
export interface ManualSubsection {
  title: string;
  items: ManualItem[];
}

export interface ManualSection {
  title: string;
  items: ManualItem[];
  subsections: ManualSubsection[];
}

export interface ManualLink {
  text: string;
  url: string;
}

/** One Drive file or folder, as the bridge lists it (appscript JobFiles.js). */
export interface DriveItem {
  id: string;
  name: string;
  url: string;
  isFolder: boolean;
  mimeType: string;
  modified: string;
  /** Anyone can view it — itself, or through a folder above it. */
  shared?: boolean;
}

export const isImage = (mimeType: string) => /^image\//.test(mimeType);

/** A Drive photo as an image URL. Loads for the public only when the photo is shared. */
export const photoUrl = (id: string, width: number) => `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w${width}`;

export interface ManualPhoto {
  id: string;
  name: string;
  shared: boolean;
}

/** A Drive folder of photos, shown on the page as a grid. A snapshot: Refresh re-reads the folder. */
export interface ManualGallery {
  title: string;
  folderId: string;
  folderUrl: string;
  photos: ManualPhoto[];
}

/** A folder listing as a gallery: its images, in the folder's order. */
export function galleryFrom(folder: { id: string; name: string; url: string }, children: DriveItem[], title = folder.name): ManualGallery {
  return {
    title,
    folderId: folder.id,
    folderUrl: folder.url,
    photos: children.filter((c) => !c.isFolder && isImage(c.mimeType)).map((c) => ({ id: c.id, name: c.name, shared: !!c.shared })),
  };
}

/** What the spec reader takes: a PDF, or a Google file Drive exports to PDF. */
export const isReadable = (mimeType: string) =>
  mimeType === "application/pdf" || /^application\/vnd\.google-apps\.(document|spreadsheet|presentation)$/.test(mimeType);

/** A Drive file or folder linked to the manual — the office's working files, never printed. */
export interface ManualSource {
  id: string;
  name: string;
  url: string;
  isFolder: boolean;
}

/**
 * How the manual's title is set. Zero or blank means "the site's own value",
 * so a title left alone follows the Squarespace theme. The defaults are the
 * look the first manuals shipped with: uppercase, spaced, centred.
 */
export interface TitleStyle {
  /** A CSS font-family the Squarespace site loads; blank = the site's heading font. */
  font: string;
  /** px; 0 = the site's h2 size. */
  size: number;
  /** "" = the site's weight. */
  weight: string;
  italic: boolean;
  upper: boolean;
  /** Letter spacing in em. */
  spacing: number;
  /** Unitless; 0 = the site's. */
  lineHeight: number;
  align: "left" | "center" | "right";
  /** normal = the browser's; balance = even line lengths; nowrap = one line (until a typed break). */
  wrap: "normal" | "balance" | "nowrap";
}

export const DEFAULT_TITLE_STYLE: TitleStyle = {
  font: "",
  size: 0,
  weight: "",
  italic: false,
  upper: true,
  spacing: 0.08,
  lineHeight: 0,
  align: "center",
  wrap: "balance",
};

export interface HouseManual {
  title: string;
  titleStyle: TitleStyle;
  intro: string;
  contacts: ManualContact[];
  sections: ManualSection[];
  galleries: ManualGallery[];
  links: ManualLink[];
  sources: ManualSource[];
}

/** A job's vendor in JobTread, offered for the contact list. */
export interface JobVendor {
  id: string;
  name: string;
  /** The cost code the vendor billed the most to, e.g. "Plumbing". */
  trade: string;
  cost: number;
}

/** A budget line flagged as a JobTread Specification. */
export interface JtSpec {
  group: string;
  name: string;
  description: string;
}

/**
 * The first draft. Sections come from the newest spec list import, one per
 * room, and only the rows with a spec; without an import, from the job's
 * JobTread Specification lines, one section per budget group. Contacts start
 * empty: the office picks which of the job's vendors the homeowner should call.
 */
export function draftManual(jobName: string, specs: SpecList | null, jtSpecs: JtSpec[]): HouseManual {
  const sections = specs?.rows.length
    ? specSections(specs)
    : mergeSections(
        [],
        jtSpecs.map((s) => ({
          title: s.group || "Selections",
          items: [{ label: s.name, value: s.description.trim(), url: "" }],
        })),
      );
  return { title: jobName, titleStyle: DEFAULT_TITLE_STYLE, intro: "", contacts: [], sections, galleries: [], links: [], sources: [] };
}

/** A spec list as manual sections: one per room, only the rows with a spec. */
export function specSections(specs: SpecList): ManualSection[] {
  return mergeSections(
    [],
    specs.rows
      .map((r) => ({ room: r.room, label: r.item, value: r.spec || r.specLinks[0]?.text || "", url: r.specLinks[0]?.url ?? "" }))
      .filter((r) => r.value)
      .map(({ room, ...item }) => ({ title: room || "Other", items: [item] })),
  );
}

/**
 * Add `incoming` to `sections`: a section with the same title (any case) takes
 * the new items, a new title is added at the end, and an item already there
 * (same item and product) is not repeated. Nothing in `sections` is changed or
 * removed, so an import never undoes the office's edits.
 */
export function mergeSections(
  sections: ManualSection[],
  incoming: { title: string; items: ManualItem[] }[],
): ManualSection[] {
  const out = sections.map((s) => ({ ...s, items: [...s.items] }));
  const key = (t: string) => t.trim().toLowerCase();
  for (const s of incoming) {
    let target = out.find((x) => key(x.title) === key(s.title));
    if (!target) out.push((target = { title: s.title, items: [], subsections: [] }));
    for (const it of s.items) {
      if (!target.items.some((x) => key(x.label) === key(it.label) && key(x.value) === key(it.value))) target.items.push(it);
    }
  }
  return out;
}

/** Coerce a stored or posted value into a manual, dropping anything malformed. */
export function asManual(v: unknown): HouseManual | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]).filter((y) => y && typeof y === "object") : []);
  const items = (x: unknown) => arr(x).map((i) => ({ label: s(i.label), value: s(i.value), url: s(i.url) }));
  const t = (o.titleStyle && typeof o.titleStyle === "object" ? o.titleStyle : {}) as Record<string, unknown>;
  const d = DEFAULT_TITLE_STYLE;
  const num = (x: unknown, fallback: number, min: number, max: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
  const pick = <T extends string>(x: unknown, ok: readonly T[], fallback: T) => (ok.includes(x as T) ? (x as T) : fallback);
  return {
    title: s(o.title),
    titleStyle: {
      font: s(t.font).replace(/[^\w\s,'"-]/g, "").slice(0, 120),
      size: num(t.size, d.size, 0, 200),
      weight: pick(String(t.weight ?? ""), ["", "300", "400", "500", "600", "700", "800"], d.weight),
      italic: typeof t.italic === "boolean" ? t.italic : d.italic,
      upper: typeof t.upper === "boolean" ? t.upper : d.upper,
      spacing: num(t.spacing, d.spacing, -0.1, 1),
      lineHeight: num(t.lineHeight, d.lineHeight, 0, 3),
      align: pick(t.align, ["left", "center", "right"] as const, d.align),
      wrap: pick(t.wrap, ["normal", "balance", "nowrap"] as const, d.wrap),
    },
    intro: s(o.intro),
    contacts: arr(o.contacts).map((c) => ({
      ...(s(c.vendorId) ? { vendorId: s(c.vendorId) } : {}),
      trade: s(c.trade),
      name: s(c.name),
      phone: s(c.phone),
      email: s(c.email),
      url: s(c.url),
    })),
    sections: arr(o.sections).map((x) => ({
      title: s(x.title),
      items: items(x.items),
      subsections: arr(x.subsections).map((y) => ({ title: s(y.title), items: items(y.items) })),
    })),
    galleries: arr(o.galleries)
      .filter((g) => s(g.folderId))
      .map((g) => ({
        title: s(g.title),
        folderId: s(g.folderId),
        folderUrl: s(g.folderUrl),
        photos: arr(g.photos)
          .filter((p) => /^[\w-]{10,}$/.test(s(p.id)))
          .map((p) => ({ id: s(p.id), name: s(p.name), shared: p.shared === true })),
      })),
    links: arr(o.links).map((l) => ({ text: s(l.text), url: s(l.url) })),
    sources: arr(o.sources)
      .filter((x) => s(x.id))
      .map((x) => ({ id: s(x.id), name: s(x.name), url: s(x.url), isFolder: x.isFolder === true })),
  };
}

/** A Drive file or folder id out of a pasted link (or a bare id). */
export function driveIdFromLink(link: string): string {
  const t = link.trim();
  const m = t.match(/\/(?:folders|d)\/([\w-]{10,})/) ?? t.match(/[?&]id=([\w-]{10,})/) ?? t.match(/^([\w-]{20,})$/);
  return m?.[1] ?? "";
}

/* ------------------------------------------------------------- the block */

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Only web, mail and phone links reach the page; anything else prints as text. */
function safeUrl(u: string): string {
  const t = u.trim();
  if (/^(https?:|mailto:|tel:)/i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(t)) return `https://${t}`;
  return "";
}

/** Text with its line breaks kept — a selection can run to a paragraph. */
const escLines = (t: string) => esc(t.trim()).replace(/\r?\n/g, "<br>");

function link(text: string, url: string): string {
  const href = safeUrl(url);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${escLines(text)}</a>` : escLines(text);
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** Inherits the site's fonts and colours, so it sits in any Squarespace theme. */
const CSS = `
.am{max-width:760px;margin:0 auto;color:inherit;font:inherit}
.am h2{margin:0 0 1.5em}
.am .am-intro{text-align:center;margin:0 0 2em}
.am details{border-top:1px solid currentColor}
.am details:last-of-type{border-bottom:1px solid currentColor}
.am summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;padding:1.1em 0;text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.am summary::-webkit-details-marker{display:none}
.am summary::after{content:"+";font-weight:400;font-size:1.4em;line-height:1}
.am details[open] summary::after{content:"\\2212"}
.am dl{margin:0 0 1.5em;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:.9em 1.5em}
.am dt{opacity:.7}
.am dd{margin:0}
.am dd span{display:block}
.am h4.am-sub{margin:.4em 0 .8em;font-size:.9em;font-weight:600;text-transform:uppercase;letter-spacing:.06em;opacity:.85}
.am a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.am .am-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin:0 0 1.5em}
.am .am-photos a{display:block;text-decoration:none}
.am .am-photos img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}
.am .am-links{text-align:center;margin:2em 0 0}
.am .am-links a{margin:0 .75em}
@media (max-width:600px){.am dl{grid-template-columns:1fr;gap:.2em}.am dd{margin-bottom:.9em}}
`.trim();

const dl = (rows: string[]) => (rows.length ? `<dl>${rows.join("")}</dl>` : "");

function details(title: string, body: string): string {
  return body ? `<details><summary>${esc(title)}</summary>${body}</details>` : "";
}

const itemRows = (items: ManualItem[]) =>
  items
    .filter((i) => i.label.trim() || i.value.trim())
    .map((i) => `<dt>${esc(i.label)}</dt><dd>${link(i.value, i.url)}</dd>`);

/**
 * The title's inline style. Every value has already been through `asManual`,
 * so a font name carries no character that could close the attribute.
 * A large size is capped by the screen width so a one-line title still fits
 * on a phone.
 */
export function titleCss(t: TitleStyle): string {
  const css = [
    t.font.trim() && `font-family:${t.font.trim()}`,
    t.size > 0 && `font-size:min(${t.size}px,${Math.round(t.size / 4)}vw)`,
    t.weight && `font-weight:${t.weight}`,
    t.italic && "font-style:italic",
    `text-transform:${t.upper ? "uppercase" : "none"}`,
    `letter-spacing:${t.spacing}em`,
    t.lineHeight > 0 && `line-height:${t.lineHeight}`,
    `text-align:${t.align}`,
    t.wrap === "nowrap" ? "white-space:nowrap" : t.wrap === "balance" ? "text-wrap:balance" : "",
  ];
  return css.filter(Boolean).join(";");
}

/** The manual as one paste-ready HTML block (scoped styles + content). */
export function manualHtml(m: HouseManual): string {
  const contacts = m.contacts
    .filter((c) => c.name.trim())
    .map((c) => {
      const lines = [link(c.name, c.url)];
      if (c.phone.trim()) lines.push(`<a href="${esc(telHref(c.phone))}">${esc(c.phone)}</a>`);
      if (c.email.trim()) lines.push(`<a href="mailto:${esc(c.email.trim())}">${esc(c.email)}</a>`);
      return `<dt>${esc(c.trade)}</dt><dd>${lines.map((l) => `<span>${l}</span>`).join("")}</dd>`;
    });
  const sections = m.sections.map((s) =>
    details(
      s.title,
      dl(itemRows(s.items)) +
        s.subsections
          .map((sub) => {
            const rows = itemRows(sub.items);
            return rows.length ? `<h4 class="am-sub">${esc(sub.title)}</h4>${dl(rows)}` : "";
          })
          .join(""),
    ),
  );
  // Only shared photos: an unshared one is a broken image to every visitor.
  const galleries = m.galleries.map((g) => {
    const imgs = g.photos
      .filter((p) => p.shared)
      .map(
        (p) =>
          `<a href="${esc(photoUrl(p.id, 2400))}" target="_blank" rel="noopener"><img src="${esc(photoUrl(p.id, 800))}" alt="${esc(p.name.replace(/\.\w+$/, ""))}" loading="lazy"></a>`,
      );
    return details(g.title || "Photos", imgs.length ? `<div class="am-photos">${imgs.join("")}</div>` : "");
  });
  const links = m.links.filter((l) => l.text.trim() && safeUrl(l.url)).map((l) => link(l.text, l.url));
  return [
    `<style>${CSS}</style>`,
    `<div class="am">`,
    m.title.trim() && `<h2 style="${esc(titleCss(m.titleStyle))}">${escLines(m.title)}</h2>`,
    m.intro.trim() && `<p class="am-intro">${esc(m.intro)}</p>`,
    details("Contacts", dl(contacts)),
    ...sections,
    ...galleries,
    links.length > 0 && `<p class="am-links">${links.join("")}</p>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}
