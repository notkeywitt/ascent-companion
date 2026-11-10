/**
 * The small slice of markdown Claude Code's monthly report uses, parsed into
 * blocks the page draws with React — no HTML string is ever injected.
 *
 * Supported: `#`/`##`/`###` headings, `-`/`*`/`•` bullets (one level),
 * `|` tables, blank-line paragraphs, and inline `**bold**`, `[text](url)` and
 * bare https:// links. Anything else is shown as plain text.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; content: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "para"; content: Inline[] };

const SAFE_HREF = /^(https?:\/\/|\/)/i;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ kind: "text", text: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) {
      if (SAFE_HREF.test(m[3])) out.push({ kind: "link", text: m[2], href: m[3] });
      else out.push({ kind: "text", text: m[0] });
    } else out.push({ kind: "link", text: m[4], href: m[4] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => parseInline(c.trim()));

export function parseReport(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", content: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, content: parseInline(h[2]) });
      continue;
    }
    if (/^[-*•]\s+/.test(t)) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].trim().replace(/^[-*•]\s+/, "")));
        i++;
      }
      i--;
      blocks.push({ kind: "list", items });
      continue;
    }
    if (t.startsWith("|")) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      i--;
      const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
      if (body.length) blocks.push({ kind: "table", header: cells(body[0]), rows: body.slice(1).map(cells) });
      continue;
    }
    para.push(t);
  }
  flush();
  return blocks;
}
