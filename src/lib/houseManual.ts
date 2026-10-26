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

export interface ManualSection {
  title: string;
  items: ManualItem[];
}

export interface ManualLink {
  text: string;
  url: string;
}

export interface HouseManual {
  title: string;
  intro: string;
  contacts: ManualContact[];
  sections: ManualSection[];
  links: ManualLink[];
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
  const sections: ManualSection[] = [];
  const section = (title: string) => {
    let s = sections.find((x) => x.title === title);
    if (!s) sections.push((s = { title, items: [] }));
    return s;
  };
  if (specs?.rows.length) {
    for (const r of specs.rows) {
      const value = r.spec || r.specLinks[0]?.text || "";
      if (!value) continue;
      section(r.room || "Other").items.push({ label: r.item, value, url: r.specLinks[0]?.url ?? "" });
    }
  } else {
    for (const s of jtSpecs) {
      section(s.group || "Selections").items.push({ label: s.name, value: s.description.trim(), url: "" });
    }
  }
  return { title: jobName, intro: "", contacts: [], sections, links: [] };
}

/** Coerce a stored or posted value into a manual, dropping anything malformed. */
export function asManual(v: unknown): HouseManual | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]).filter((y) => y && typeof y === "object") : []);
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
      items: arr(x.items).map((i) => ({ label: s(i.label), value: s(i.value), url: s(i.url) })),
    })),
    links: arr(o.links).map((l) => ({ text: s(l.text), url: s(l.url) })),
  };
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

function link(text: string, url: string): string {
  const href = safeUrl(url);
  return href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);
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
.am a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.am .am-links{text-align:center;margin:2em 0 0}
.am .am-links a{margin:0 .75em}
@media (max-width:600px){.am dl{grid-template-columns:1fr;gap:.2em}.am dd{margin-bottom:.9em}}
`.trim();

function details(title: string, rows: string[]): string {
  return rows.length ? `<details><summary>${esc(title)}</summary><dl>${rows.join("")}</dl></details>` : "";
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
      s.items
        .filter((i) => i.label.trim() || i.value.trim())
        .map((i) => `<dt>${esc(i.label)}</dt><dd>${link(i.value, i.url)}</dd>`),
    ),
  );
  const links = m.links.filter((l) => l.text.trim() && safeUrl(l.url)).map((l) => link(l.text, l.url));
  return [
    `<style>${CSS}</style>`,
    `<div class="am">`,
    m.title.trim() && `<h2>${esc(m.title)}</h2>`,
    m.intro.trim() && `<p class="am-intro">${esc(m.intro)}</p>`,
    details("Contacts", contacts),
    ...sections,
    links.length > 0 && `<p class="am-links">${links.join("")}</p>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}
