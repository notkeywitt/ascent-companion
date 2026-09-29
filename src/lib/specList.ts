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
  /** Set once the row is saved onto a JobTread budget line. */
  jt?: { costItemId: string; line: string; savedAt: string };
}

export interface SpecList {
  title: string;
  revision: string;
  rows: SpecRow[];
  /** Links in the PDF that no row claimed — shown, never dropped. */
  unplaced: SpecLink[];
}

/** What the model returns: link ids in place of links. */
export interface RawSpecRow extends Omit<SpecRow, "specLinks" | "alternates" | "jt"> {
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

/* ------------------------------------------------------------ to JobTread */

/**
 * A JobTread Specification IS a budget line with `isSpecification` on, and its
 * details are that line's description (owner's call, 2026-09-29). So a row is
 * saved by adding it to the matching line's description, under one heading,
 * BELOW whatever the estimator wrote there. Several rows can land on one line
 * (the Floor of three rooms on Wood Flooring). Each row is keyed by
 * "<room> · <item>", so saving a row again replaces its own entry.
 */
export const SPEC_HEADING = "— Architect spec —";
/** JobTread's limit on a cost item's description. */
export const DESCRIPTION_MAX = 4096;

export function specKey(row: Pick<SpecRow, "room" | "item">): string {
  return [row.room, row.item].filter(Boolean).join(" · ");
}

/** The lines one row adds to the description. */
export function specEntry(row: SpecRow): string {
  const out = [`${specKey(row)}: ${row.spec || "(no spec yet)"}${row.qty ? ` (qty ${row.qty})` : ""}`];
  for (const l of row.specLinks) out.push(l.url);
  for (const a of row.alternates) {
    out.push(`Alternate: ${a.text}`);
    for (const l of a.links) out.push(l.url);
  }
  if (row.question) out.push(`Question: ${row.question}`);
  if (row.answer) out.push(`Answer: ${row.answer}`);
  return out.join("\n");
}

/**
 * The description with `row`'s entry added, or replacing the entry it had.
 * Everything above the heading is left exactly as it was.
 */
export function mergeSpecEntry(description: string | null | undefined, row: SpecRow): string {
  const desc = (description ?? "").replace(/\s+$/, "");
  const at = desc.indexOf(SPEC_HEADING);
  const head = (at === -1 ? desc : desc.slice(0, at)).replace(/\s+$/, "");
  const block = at === -1 ? "" : desc.slice(at + SPEC_HEADING.length);

  // Entries start with "<key>: "; every other line belongs to the entry above it.
  const entries: { key: string; text: string }[] = [];
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const m = /^(.+?): /.exec(line);
    const opener = m && !/^(https?|Alternate|Question|Answer)$/.test(m[1]);
    if (opener || entries.length === 0) entries.push({ key: m?.[1] ?? "", text: line });
    else entries[entries.length - 1].text += `\n${line}`;
  }
  const key = specKey(row);
  const entry = { key, text: specEntry(row) };
  const i = entries.findIndex((e) => e.key === key);
  if (i === -1) entries.push(entry);
  else entries[i] = entry;

  return [head, [SPEC_HEADING, ...entries.map((e) => e.text)].join("\n")].filter(Boolean).join("\n\n");
}

/** One budget line, as the picker lists it. */
export interface BudgetLine {
  id: string;
  name: string;
  group: string;
  isSpecification: boolean;
}

// Words that name a budget line's KIND, not what it is for.
const FILLER = new Set(["materials", "material", "labor", "allowance", "sub", "vendor", "install", "and", "the"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !FILLER.has(w));
// A shared stem is a match: "floor" finds "Flooring", "cabinet" finds "Cabinetry".
const stem = (w: string) => w.slice(0, 5);

/**
 * The budget line a row most likely belongs to, or "" when nothing is close.
 * A row already saved keeps its line. Otherwise the line sharing the most word
 * stems with the row's item and spec wins, a Specification line breaking a tie.
 * Only a suggestion: the office confirms every row before it is saved.
 */
export function suggestBudgetLine(row: SpecRow, lines: BudgetLine[]): string {
  if (row.jt && lines.some((l) => l.id === row.jt!.costItemId)) return row.jt.costItemId;
  const want = new Set(words(`${row.item} ${row.spec}`).map(stem));
  let best = { id: "", score: 0 };
  for (const l of lines) {
    const have = new Set(words(l.name).map(stem));
    let score = [...have].filter((w) => want.has(w)).length;
    if (score && l.isSpecification) score += 0.5;
    if (score > best.score) best = { id: l.id, score };
  }
  return best.id;
}
