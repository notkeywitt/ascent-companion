/**
 * Weekly Summary — reading the office's weekly email, saved as Markdown.
 *
 * The /weekly-summary skill (`.claude/skills/weekly-summary/`) writes one file
 * per week to `drafts/<week-end>-claude.md`, and `<week-end>-final.md` once the
 * office manager's edits are saved. Both are committed, so git is the store and
 * every deploy carries every week. This module is the pure half: it turns one
 * file's text into blocks the page draws. The file reading is in
 * `weeklySummaryFiles.ts`.
 *
 * The Markdown is the small set `render.mjs` reads: `# title`, `### section`,
 * `- bullet`, `> callout`, `| table |` (first row is the header, `|---|` rows
 * are dropped), `**bold**`, and `<!-- ... -->` comments (one holds the Doc URL).
 */

export type SummaryBlock =
  | { t: "h"; s: string }
  | { t: "p"; s: string }
  | { t: "ul"; items: string[] }
  | { t: "callout"; s: string }
  | { t: "table"; head: string[]; rows: string[][] };

export interface ParsedSummary {
  title: string;
  /** The printable Google Doc, from the `<!-- doc: URL -->` line. */
  docUrl: string | null;
  blocks: SummaryBlock[];
}

/** A file name's week-end, "2026-11-21-claude.md" → "2026-11-21". */
const FILE = /^(\d{4}-\d{2}-\d{2})-(claude|final)\.md$/;

export function parseSummaryFile(name: string): { weekEnd: string; kind: "claude" | "final" } | null {
  const m = FILE.exec(name);
  return m ? { weekEnd: m[1], kind: m[2] as "claude" | "final" } : null;
}

/** Only an https Google Docs link is shown as a link. */
function docLink(text: string): string | null {
  const m = /<!--\s*doc:\s*(\S+?)\s*-->/.exec(text);
  if (!m) return null;
  return /^https:\/\/docs\.google\.com\//.test(m[1]) ? m[1] : null;
}

export function parseSummary(text: string): ParsedSummary {
  let title = "";
  const blocks: SummaryBlock[] = [];
  let tableRows: string[][] | null = null;

  const flushTable = () => {
    if (tableRows && tableRows.length) {
      const [head, ...rows] = tableRows;
      blocks.push({ t: "table", head, rows });
    }
    tableRows = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || /^<!--.*-->$/.test(trimmed)) continue;

    if (trimmed.startsWith("|")) {
      const cells = trimmed
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      (tableRows ??= []).push(cells);
      continue;
    }
    flushTable();

    if (line.startsWith("# ")) {
      if (!title) title = line.slice(2).trim();
    } else if (line.startsWith("### ")) {
      blocks.push({ t: "h", s: line.slice(4).trim() });
    } else if (line.startsWith("- ")) {
      const last = blocks[blocks.length - 1];
      if (last?.t === "ul") last.items.push(line.slice(2));
      else blocks.push({ t: "ul", items: [line.slice(2)] });
    } else if (line.startsWith("> ")) {
      blocks.push({ t: "callout", s: line.slice(2) });
    } else {
      blocks.push({ t: "p", s: trimmed });
    }
  }
  flushTable();

  return { title, docUrl: docLink(text), blocks };
}

/** "**Bold** rest" → [{bold, text}] so the page can draw it without raw HTML. */
export function inlineParts(s: string): { bold: boolean; text: string }[] {
  const out: { bold: boolean; text: string }[] = [];
  s.split(/\*\*(.+?)\*\*/g).forEach((text, i) => {
    if (text) out.push({ bold: i % 2 === 1, text });
  });
  return out;
}

/** A cell that is only an amount, for right-aligned tabular figures. */
export function isAmount(cell: string): boolean {
  return /^\$[\d,]+(\.\d{2})?$/.test(cell.trim());
}

/** The sign-off line the writer ends with ("-Keillor") is not a body paragraph. */
export function isSignOff(s: string): boolean {
  return /^-\s?[A-Z][a-z]+$/.test(s.trim());
}
