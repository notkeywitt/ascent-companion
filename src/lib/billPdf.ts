/**
 * A one-file PDF writer, and the one document it draws: the Ascent-branded
 * record for a vendor bill that arrived with NO invoice file.
 *
 * Why hand-rolled rather than a PDF library: this draws text, hairlines and the
 * logo mark, on Letter paper, in the two standard fonts every reader already
 * has. That is ~150 lines here against a megabyte of dependency in the Vercel
 * bundle. If a future document needs images, tables that break mid-cell, or a
 * font that is not Helvetica, replace this with `pdf-lib` rather than growing
 * it.
 *
 * ponytail: approximate Helvetica metrics (textWidth below), exact Courier
 * ones. Wrapping is therefore a little conservative and money columns are
 * exact. Swap in the real AFM widths if a layout ever looks loose.
 */

const PAGE_W = 612; // Letter, points
const PAGE_H = 792;
const MARGIN = 54;
const RIGHT = PAGE_W - MARGIN;
const BOTTOM = 72; // where the body stops and the footer sits

/** Helvetica ≈. Courier is exact at 0.6 em, which is why money uses it. */
function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w += 0.278;
    else if (/[A-Z]/.test(ch)) w += 0.68;
    else if (/[0-9]/.test(ch)) w += 0.556;
    else if (/[ilj.,'!|:;()[\]]/.test(ch)) w += 0.26;
    else if (/[mw]/.test(ch)) w += 0.83;
    else w += 0.53;
  }
  return w * size * (bold ? 1.06 : 1);
}
const courierWidth = (s: string, size: number) => s.length * 0.6 * size;

/** PDF strings are Latin-1. Fold the punctuation we actually emit, drop the rest. */
function ascii(s: string): string {
  return (s ?? "")
    // Fold accents rather than dropping them: "Café" reads better as "Cafe"
    // than as "Caf", and vendor names carry them.
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "");
}
const esc = (s: string) => ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

type Font = "F1" | "F2" | "F3"; // Helvetica, Helvetica-Bold, Courier

/** One page's content stream, built op by op. */
class Page {
  ops: string[] = [];
  gray(g: number) {
    this.ops.push(`${g} g`);
  }
  text(x: number, y: number, s: string, size: number, font: Font = "F1", tracking = 0) {
    if (!s) return;
    this.ops.push(
      `BT /${font} ${size} Tf ${tracking ? `${tracking} Tc ` : ""}1 0 0 1 ${r(x)} ${r(y)} Tm (${esc(s)}) Tj ET`,
    );
  }
  right(x: number, y: number, s: string, size: number, font: Font = "F1") {
    const w = font === "F3" ? courierWidth(s, size) : textWidth(s, size, font === "F2");
    this.text(x - w, y, s, size, font);
  }
  rule(x1: number, y: number, x2: number, weight = 0.5) {
    this.ops.push(`${weight} w ${r(x1)} ${r(y)} m ${r(x2)} ${r(y)} l S`);
  }
  rect(x: number, y: number, w: number, h: number) {
    this.ops.push(`${r(x)} ${r(y)} ${r(w)} ${r(h)} re f`);
  }
  poly(pts: [number, number][]) {
    const [f, ...rest] = pts;
    this.ops.push(`${r(f[0])} ${r(f[1])} m ${rest.map((p) => `${r(p[0])} ${r(p[1])} l`).join(" ")} h f`);
  }
}
const r = (n: number) => Math.round(n * 100) / 100;

/** The logo lockup: the brand square with the peak knocked out of it, then the
 *  two-line wordmark. Peak points copied from AscentLogo.tsx (1080 viewBox,
 *  y-down) and flipped into PDF's y-up space. Black on white — the Website
 *  palette, which is what paper is. */
const PEAK: [number, number][] = [
  [439.919, 418.811],
  [271, 710],
  [809, 710],
  [582.362, 373],
  [472.75, 442.506],
];
function logo(p: Page, x: number, yTop: number, s = 30) {
  p.gray(0);
  p.rect(x, yTop - s, s, s);
  p.gray(1);
  p.poly(PEAK.map(([px, py]) => [x + (px / 1080) * s, yTop - (py / 1080) * s]));
  p.gray(0);
  p.text(x + s + 10, yTop - 12, "ASCENT", 10.5, "F1", 1.5);
  p.text(x + s + 10, yTop - 25, "BUILDING CO.", 10.5, "F1", 1.5);
}

/** Greedy wrap on the approximate metrics above. */
function wrap(s: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of ascii(s).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

/** Cut a cell's text to its column, with an ellipsis when it doesn't fit. */
function clip(s: string, size: number, width: number): string {
  let t = ascii(s);
  if (textWidth(t, size) <= width) return t;
  while (t.length > 1 && textWidth(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t.trim()}...`;
}

const money = (n: number) =>
  `$${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface BillPdfLine {
  name: string;
  code?: string;
  quantity?: number | null;
  amount: number;
}
export interface BillPdfInput {
  vendor: string;
  billNumber?: string;
  job?: string;
  customer?: string;
  issueDate?: string;
  dueDate?: string;
  status?: string;
  description: string;
  lines: BillPdfLine[];
  total: number;
  /** ISO instant the record was created. Defaults to now. */
  createdAt?: string;
  /** Who asked for it — printed in the footer so the record has an author. */
  createdBy?: string;
}

/**
 * Draw the record. Returns the finished PDF bytes.
 */
export function buildBillPdf(input: BillPdfInput): Buffer {
  const pages: Page[] = [];
  let p = new Page();
  pages.push(p);

  logo(p, MARGIN, PAGE_H - MARGIN);
  p.gray(0.4);
  p.right(RIGHT, PAGE_H - MARGIN - 12, "VENDOR BILL RECORD", 8.5, "F2");
  p.gray(0);
  p.rule(MARGIN, PAGE_H - MARGIN - 42, RIGHT, 1);

  let y = PAGE_H - MARGIN - 66;

  // Header facts, two columns. Label above value, the way the app's own
  // statement blocks read.
  const facts: [string, string][] = [
    ["VENDOR", input.vendor || "-"],
    ["BILL NUMBER", input.billNumber || "-"],
    ["JOB", input.job || "-"],
    ["CUSTOMER", input.customer || "-"],
    ["BILL DATE", input.issueDate || "-"],
    ["PAYMENT DUE", input.dueDate || "-"],
  ];
  const colX = [MARGIN, MARGIN + 258];
  facts.forEach(([label, value], i) => {
    const x = colX[i % 2];
    if (i % 2 === 0 && i > 0) y -= 34;
    p.gray(0.45);
    p.text(x, y, label, 7, "F2", 0.6);
    p.gray(0);
    p.text(x, y - 12, clip(value, 10, 240), 10);
  });
  y -= 44;

  if (input.description.trim()) {
    p.gray(0.45);
    p.text(MARGIN, y, "DESCRIPTION", 7, "F2", 0.6);
    p.gray(0);
    y -= 13;
    for (const line of wrap(input.description, 9.5, RIGHT - MARGIN)) {
      p.text(MARGIN, y, line, 9.5);
      y -= 12.5;
    }
    y -= 10;
  }

  // Line table. Columns: description | cost code | qty | amount.
  const CODE_X = 340;
  const QTY_X = 470; // right edge of the qty column
  const DESC_W = CODE_X - MARGIN - 22; // the gap the approximate metrics need to stay honest

  const tableHead = () => {
    p.gray(0.45);
    p.text(MARGIN, y, "LINE ITEM", 7, "F2", 0.6);
    p.text(CODE_X, y, "COST CODE", 7, "F2", 0.6);
    p.right(QTY_X, y, "QTY", 7, "F2");
    p.right(RIGHT, y, "AMOUNT", 7, "F2");
    p.gray(0);
    y -= 6;
    p.rule(MARGIN, y, RIGHT);
    y -= 14;
  };
  tableHead();

  for (const l of input.lines) {
    if (y < BOTTOM + 40) {
      p = new Page();
      pages.push(p);
      y = PAGE_H - MARGIN;
      tableHead();
    }
    p.text(MARGIN, y, clip(l.name || "Line item", 9.5, DESC_W), 9.5);
    p.gray(0.35);
    p.text(CODE_X, y, clip(l.code || "", 8.5, QTY_X - CODE_X - 22), 8.5);
    p.gray(0);
    if (l.quantity != null) p.right(QTY_X, y, String(l.quantity), 9, "F3");
    p.right(RIGHT, y, money(l.amount), 9.5, "F3");
    y -= 8;
    p.gray(0.85);
    p.rule(MARGIN, y, RIGHT);
    p.gray(0);
    y -= 13;
  }

  // Total. Its own rule above, heavier than the row hairlines.
  if (y < BOTTOM + 40) {
    p = new Page();
    pages.push(p);
    y = PAGE_H - MARGIN;
  }
  y -= 4;
  p.rule(MARGIN, y + 8, RIGHT, 1);
  p.text(CODE_X, y - 4, "TOTAL", 10, "F2");
  p.right(RIGHT, y - 4, money(input.total), 12, "F3");

  const stamp = (input.createdAt ? new Date(input.createdAt) : new Date()).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  pages.forEach((pg, i) => {
    pg.gray(0.5);
    pg.text(
      MARGIN,
      BOTTOM - 20,
      "No vendor invoice file was supplied. This record was created in Ascent Assistant from the bill in JobTread.",
      7,
    );
    pg.text(MARGIN, BOTTOM - 31, `${stamp}${input.createdBy ? ` - ${input.createdBy}` : ""}`, 7);
    pg.right(RIGHT, BOTTOM - 31, `Page ${i + 1} of ${pages.length}`, 7);
    pg.gray(0);
  });

  return assemble(pages);
}

/** Objects, xref table, trailer. The only part that is PDF plumbing. */
function assemble(pages: Page[]): Buffer {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body); // 1-indexed by position

  const kidsStart = 3; // 1 catalog, 2 pages, then page/content pairs
  const kids = pages.map((_, i) => `${kidsStart + i * 2} 0 R`).join(" ");
  add(`<< /Type /Catalog /Pages 2 0 R >>`);
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  const fontBase = kidsStart + pages.length * 2;
  pages.forEach((pg, i) => {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${fontBase} 0 R /F2 ${fontBase + 1} 0 R /F3 ${fontBase + 2} 0 R >> >> ` +
        `/Contents ${kidsStart + i * 2 + 1} 0 R >>`,
    );
    const stream = pg.ops.join("\n");
    add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });
  add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
  add(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
