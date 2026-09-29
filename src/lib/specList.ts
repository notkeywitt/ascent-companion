/**
 * A job's spec selection list — what an architect's finish schedule becomes
 * once it is read into the app.
 *
 * PURE module (no DB, no Node), so the page, the route and the test all import
 * it. The route reads the PDF (lib/pdfLinks + lib/claudeExtract) and hands the
 * raw answer to `resolveSpecList`, which is the one place a link id becomes a
 * URL: the model names ids from the list it was given, and anything else is
 * dropped, so no URL on the page was ever written by the model.
 */
import type { PdfLink } from "@/lib/pdfLinks";

export interface SpecLink {
  url: string;
  text: string;
}

/**
 * `open` = a choice is still to be made (an unanswered question, a TBD, an
 * alternate not ruled out). It maps to a JobTread Selection. `decided` maps to
 * a JobTread Specification.
 */
export type SpecStatus = "open" | "decided";

export interface SpecOption {
  text: string;
  links: SpecLink[];
}

export interface SpecRow {
  room: string;
  item: string;
  qty: string;
  spec: string;
  specLinks: SpecLink[];
  alternates: SpecOption[];
  notes: string;
  question: string;
  /** What the question changes, when the schedule says ("Repercussions"). */
  impact: string;
  answer: string;
  addedBy: string;
  /** The drawing's elevation or finish tag (F1, CT1, X001 …). */
  tag: string;
  /** The row's own "date added / revised", as printed. */
  revised: string;
  /** Any other column the schedule carries, so nothing on it is lost. */
  other: { label: string; value: string }[];
  status: SpecStatus;
}

export interface SpecList {
  title: string;
  revision: string;
  rows: SpecRow[];
  /** Links in the PDF that no row claimed — shown, never dropped. */
  unplaced: SpecLink[];
}

/** What the model returns: link ids in place of links. */
export interface RawSpecRow extends Omit<SpecRow, "specLinks" | "alternates"> {
  specLinks: string[];
  alternates: { text: string; links: string[] }[];
}

export interface RawSpecList {
  title: string;
  revision: string;
  rows: RawSpecRow[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Swap link ids for links, drop ids the PDF never had, list the links no row used. */
export function resolveSpecList(raw: RawSpecList, links: PdfLink[]): SpecList {
  const byId = new Map(links.map((l) => [l.id, l]));
  const used = new Set<string>();
  const take = (ids: unknown): SpecLink[] => {
    const out: SpecLink[] = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      const l = byId.get(String(id));
      if (!l || out.some((o) => o.url === l.url)) continue;
      used.add(l.id);
      out.push({ url: l.url, text: l.text });
    }
    return out;
  };
  const rows: SpecRow[] = (Array.isArray(raw?.rows) ? raw.rows : []).map((r) => ({
    room: str(r.room),
    item: str(r.item),
    qty: str(r.qty),
    spec: str(r.spec),
    specLinks: take(r.specLinks),
    alternates: (Array.isArray(r.alternates) ? r.alternates : [])
      .map((a) => ({ text: str(a?.text), links: take(a?.links) }))
      .filter((a) => a.text || a.links.length),
    notes: str(r.notes),
    question: str(r.question),
    impact: str(r.impact),
    answer: str(r.answer),
    addedBy: str(r.addedBy),
    tag: str(r.tag),
    revised: str(r.revised),
    other: (Array.isArray(r.other) ? r.other : [])
      .map((o) => ({ label: str(o?.label), value: str(o?.value) }))
      .filter((o) => o.label && o.value),
    status: r.status === "decided" ? "decided" : "open",
  }));
  return {
    title: str(raw?.title),
    revision: str(raw?.revision),
    rows: rows.filter((r) => r.item || r.spec),
    unplaced: links.filter((l) => !used.has(l.id)).map((l) => ({ url: l.url, text: l.text })),
  };
}

/** Rows grouped by room, in schedule order. */
export function groupByRoom(rows: SpecRow[]): { room: string; rows: { row: SpecRow; index: number }[] }[] {
  const groups: { room: string; rows: { row: SpecRow; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const room = row.room || "Other";
    const last = groups[groups.length - 1];
    if (last && last.room === room) last.rows.push({ row, index });
    else groups.push({ room, rows: [{ row, index }] });
  });
  return groups;
}
