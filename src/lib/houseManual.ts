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
  /** The item's PDFs (a product manual, a warranty), each a Drive file link
   *  served by the page itself like a PDF link (owner, 2026-11-02). */
  pdfs?: ManualItemPdf[];
}

/** One of an item's PDFs. `text` names it on the page; blank prints "PDF". */
export interface ManualItemPdf {
  text: string;
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
  /** A Drive file the page serves as a PDF itself (`pdfPath`), so it opens with
   *  no Google login or sharing; `url` is then the pasted Drive link. */
  pdf?: boolean;
}

/** Where the live page serves a PDF link's file: under the manual's own token,
 *  so only a file the published manual names can be fetched (src/app/m/[token]/
 *  file/[fileId]/route.ts). */
export const pdfPath = (token: string, fileId: string) =>
  `/m/${encodeURIComponent(token)}/file/${encodeURIComponent(fileId)}`;

/**
 * The app's two production domains (Vercel). The office runs the Assistant as
 * an installed app from one of them, and an installed app claims every link
 * on its own domain — so a homeowner-facing PDF link on that domain opened in
 * the Assistant's window on the office's computer (owner, 2026-11-02). A PDF
 * link therefore points at the OTHER domain: same app, same route, but a site
 * the installed app does not own, so it opens in the browser.
 */
const PROD_ORIGINS = ["https://assistant.ascentbuildingco.com", "https://ascent-companion.vercel.app"];
export function pdfOrigin(origin: string): string {
  return PROD_ORIGINS.includes(origin) ? PROD_ORIGINS.find((o) => o !== origin)! : origin;
}

/** Where a published page lives, for its PDF links. Absent (the builder's
 *  preview before a first publish), a PDF link prints as text. */
export interface ManualHost {
  origin: string;
  token: string;
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

/** A subfolder's photos, under their own heading in the gallery (owner,
 *  2026-11-02). `title` starts as the folder's path below the gallery's
 *  folder, e.g. "Kitchen › Before". */
export interface ManualPhotoGroup {
  title: string;
  folderId: string;
  photos: ManualPhoto[];
}

/** A Drive folder of photos, shown on the page as a grid. A snapshot: Refresh re-reads the folder. */
export interface ManualGallery {
  title: string;
  folderId: string;
  folderUrl: string;
  /** The photos directly in the folder. */
  photos: ManualPhoto[];
  /** Its subfolders, at any depth, in folder order; only those holding photos. */
  groups?: ManualPhotoGroup[];
}

/** A folder listing's images, in the folder's order. */
export const photosFrom = (children: DriveItem[]): ManualPhoto[] =>
  children.filter((c) => !c.isFolder && isImage(c.mimeType)).map((c) => ({ id: c.id, name: c.name, shared: !!c.shared }));

/** A folder listing as a gallery: its images, in the folder's order. */
export function galleryFrom(
  folder: { id: string; name: string; url: string },
  children: DriveItem[],
  title = folder.name,
  groups: ManualPhotoGroup[] = [],
): ManualGallery {
  return { title, folderId: folder.id, folderUrl: folder.url, photos: photosFrom(children), ...(groups.length ? { groups } : {}) };
}

/** Every photo in a gallery, its subfolders' included. */
export const galleryPhotos = (g: ManualGallery): ManualPhoto[] => [...g.photos, ...(g.groups ?? []).flatMap((x) => x.photos)];

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
  // An item saved before it could hold several PDFs carries one `pdf` link.
  const pdfs = (i: Record<string, unknown>) =>
    [...(s(i.pdf) ? [{ text: "", url: s(i.pdf) }] : []), ...arr(i.pdfs).map((p) => ({ text: s(p.text), url: s(p.url) }))];
  const items = (x: unknown) =>
    arr(x).map((i) => {
      const p = pdfs(i);
      return { label: s(i.label), value: s(i.value), url: s(i.url), ...(p.length ? { pdfs: p } : {}) };
    });
  const photos = (x: unknown) =>
    arr(x)
      .filter((p) => /^[\w-]{10,}$/.test(s(p.id)))
      .map((p) => ({ id: s(p.id), name: s(p.name), shared: p.shared === true }));
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
        photos: photos(g.photos),
        ...(arr(g.groups).length
          ? { groups: arr(g.groups).map((x) => ({ title: s(x.title), folderId: s(x.folderId), photos: photos(x.photos) })) }
          : {}),
      })),
    links: arr(o.links).map((l) => ({ text: s(l.text), url: s(l.url), ...(l.pdf === true ? { pdf: true } : {}) })),
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
.am .am-pdf{margin-left:.5em;font-size:.85em;white-space:nowrap}
.am .am-links a{margin:0 .75em}
@media (max-width:600px){.am dl{grid-template-columns:1fr;gap:.2em}.am dd{margin-bottom:.9em}}
`.trim();

const dl = (rows: string[]) => (rows.length ? `<dl>${rows.join("")}</dl>` : "");

function details(title: string, body: string, attr = ""): string {
  return body ? `<details><summary${attr}>${esc(title)}</summary>${body}</details>` : "";
}

/**
 * The builder's preview marks each part with the editor field it came from
 * (`data-at`), so a click in the preview jumps to that field. `null` for the
 * published block and the copied HTML, which carry no marks.
 */
type Mark = ((key: string) => string) | null;
const marker = (on?: boolean): Mark => (on ? (key) => ` data-at="${esc(key)}"` : null);

/** An item's PDFs, beside its selection — only once the page has a token. */
function itemPdfs(i: ManualItem, host?: ManualHost): string {
  if (!host) return "";
  return (i.pdfs ?? [])
    .map((p) => ({ p, id: driveIdFromLink(p.url) }))
    .filter(({ id }) => id)
    .map(
      ({ p, id }) =>
        ` <a class="am-pdf" href="${esc(pdfOrigin(host.origin) + pdfPath(host.token, id))}" target="_blank" rel="noopener">${esc(p.text.trim() || "PDF")}</a>`,
    )
    .join("");
}

/** `at` is the items' editor key prefix, e.g. "s0" or "s0.u1". */
const itemRows = (items: ManualItem[], host: ManualHost | undefined, mark: Mark, at: string) =>
  items
    .map((i, j) => ({ i, k: `${at}.i${j}` }))
    .filter(({ i }) => i.label.trim() || i.value.trim())
    .map(
      ({ i, k }) =>
        `<dt${mark?.(k) ?? ""}>${esc(i.label)}</dt><dd${mark?.(`${k}~value`) ?? ""}>${link(i.value, i.url)}${itemPdfs(i, host)}</dd>`,
    );

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

/** The manual as one paste-ready HTML block (scoped styles + content).
 *  `opts.marks` is for the builder's preview only — see `Mark`. */
export function manualHtml(m: HouseManual, host?: ManualHost, opts: { marks?: boolean } = {}): string {
  const mark = marker(opts.marks);
  const at = (key: string) => mark?.(key) ?? "";
  const contacts = m.contacts
    .map((c, i) => ({ c, k: `c${i}` }))
    .filter(({ c }) => c.name.trim())
    .map(({ c, k }) => {
      const lines = [link(c.name, c.url)];
      if (c.phone.trim()) lines.push(`<a href="${esc(telHref(c.phone))}">${esc(c.phone)}</a>`);
      if (c.email.trim()) lines.push(`<a href="mailto:${esc(c.email.trim())}">${esc(c.email)}</a>`);
      return `<dt${at(k)}>${esc(c.trade)}</dt><dd${at(k)}>${lines.map((l) => `<span>${l}</span>`).join("")}</dd>`;
    });
  const sections = m.sections.map((s, i) =>
    details(
      s.title,
      dl(itemRows(s.items, host, mark, `s${i}`)) +
        s.subsections
          .map((sub, k) => {
            const rows = itemRows(sub.items, host, mark, `s${i}.u${k}`);
            return rows.length ? `<h4 class="am-sub"${at(`s${i}.u${k}`)}>${esc(sub.title)}</h4>${dl(rows)}` : "";
          })
          .join(""),
      at(`s${i}`),
    ),
  );
  // Only shared photos: an unshared one is a broken image to every visitor.
  const grid = (photos: ManualPhoto[]) => {
    const imgs = photos
      .filter((p) => p.shared)
      .map(
        (p) =>
          `<a href="${esc(photoUrl(p.id, 2400))}" target="_blank" rel="noopener"><img src="${esc(photoUrl(p.id, 800))}" alt="${esc(p.name.replace(/\.\w+$/, ""))}" loading="lazy"></a>`,
      );
    return imgs.length ? `<div class="am-photos">${imgs.join("")}</div>` : "";
  };
  // A subfolder prints under its own heading, like a sub-section; one with no shared photo is left out.
  const galleries = m.galleries.map((g, i) => {
    const groups = (g.groups ?? []).map((x, k) => {
      const body = grid(x.photos);
      return body ? `<h4 class="am-sub"${at(`g${i}.u${k}`)}>${esc(x.title)}</h4>${body}` : "";
    });
    return details(g.title || "Photos", grid(g.photos) + groups.join(""), at(`g${i}`));
  });
  const links = m.links
    .map((l, i) => {
      const html = (() => {
        if (!l.pdf) return l.text.trim() && safeUrl(l.url) ? link(l.text, l.url) : "";
        const id = driveIdFromLink(l.url);
        if (!l.text.trim() || !id) return "";
        return host ? link(l.text, pdfOrigin(host.origin) + pdfPath(host.token, id)) : escLines(l.text);
      })();
      return html && mark ? `<span${at(`l${i}`)}>${html}</span>` : html;
    })
    .filter(Boolean);
  return [
    `<style>${CSS}</style>`,
    `<div class="am">`,
    m.title.trim() && `<h2 style="${esc(titleCss(m.titleStyle))}"${at("title")}>${escLines(m.title)}</h2>`,
    m.intro.trim() && `<p class="am-intro"${at("intro")}>${esc(m.intro)}</p>`,
    details("Contacts", dl(contacts), at("contacts")),
    ...sections,
    ...galleries,
    links.length > 0 && `<p class="am-links">${links.join("")}</p>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* --------------------------------------------------------- the live page */

/**
 * A published manual is served at `/m/<token>` (src/app/m/[token]/route.ts),
 * and the Squarespace page loads it from there. The token is the only key:
 * random, unguessable, made once per job and kept, so the snippet pasted into
 * Squarespace never goes stale. Publishing again changes what it shows.
 */
export const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * The one-time Squarespace Code Block. It fetches the published block and drops
 * it into the page, where it takes the site's own fonts and colours. The block
 * carries no script, and `innerHTML` would not run one if it did.
 * JavaScript in a Code Block needs a Squarespace plan that allows it.
 */
export function embedSnippet(origin: string, token: string): string {
  const id = `am-${token.slice(0, 8)}`;
  const src = `${origin.replace(/\/+$/, "")}/m/${token}`;
  return [
    `<div id="${id}"></div>`,
    `<script>fetch(${JSON.stringify(src)}).then(function(r){return r.ok?r.text():""}).then(function(h){document.getElementById(${JSON.stringify(id)}).innerHTML=h})</script>`,
  ].join("\n");
}
