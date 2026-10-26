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

export interface HouseManual {
  title: string;
  intro: string;
  contacts: ManualContact[];
  sections: ManualSection[];
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
  return { title: jobName, intro: "", contacts: [], sections, links: [], sources: [] };
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
  return {
    title: s(o.title),
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
.am h2{text-transform:uppercase;letter-spacing:.08em;text-align:center;margin:0 0 1.5em}
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
  const links = m.links.filter((l) => l.text.trim() && safeUrl(l.url)).map((l) => link(l.text, l.url));
  return [
    `<style>${CSS}</style>`,
    `<div class="am">`,
    m.title.trim() && `<h2>${esc(m.title)}</h2>`,
    m.intro.trim() && `<p class="am-intro">${esc(m.intro)}</p>`,
    details("Contacts", dl(contacts)),
    ...sections,
    links.length > 0 && `<p class="am-links">${links.join("")}</p>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}
