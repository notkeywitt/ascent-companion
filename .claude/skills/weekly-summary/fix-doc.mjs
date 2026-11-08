#!/usr/bin/env node
// Second pass over the Google Doc that Drive made from `render.mjs doc`.
// Drive's HTML import gets fonts, colours and table shading right but puts
// paragraph rules on the wrong lines and makes every table column equal.
// This prints a Docs batchUpdate `requests` array that sets those styles
// directly, the way the Field Binder docs are built.
//
//   node fix-doc.mjs <read_doc output .json> <week>.md  > requests.json
//
// Style requests come first and never move text. The only deletes come last,
// highest index first, so every index stays valid.

import { readFileSync } from "node:fs";

const [, , docFile, mdFile] = process.argv;
if (!docFile || !mdFile) {
  console.error("usage: node fix-doc.mjs <read_doc.json> <week>.md");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(docFile, "utf8"));
const doc = raw.content ?? raw;
const body = (doc.tabs?.[0]?.documentTab ?? doc).body.content;

const md = readFileSync(mdFile, "utf8").split("\n");
const norm = (s) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const headings = new Set(md.filter((l) => l.startsWith("### ")).map((l) => norm(l.slice(4))));
const callouts = new Set(md.filter((l) => l.startsWith("> ")).map((l) => norm(l.slice(2))));

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return { color: { rgbColor: { red: (n >> 16) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 } } };
};
const pt = (m) => ({ magnitude: m, unit: "PT" });
const line = (hex, w, pad = 0) => ({ color: rgb(hex), width: pt(w), padding: pt(pad), dashStyle: "SOLID" });
const NONE = line("#ffffff", 0);
const INK = "#1b1b17";

const requests = [];
const para = (el, style) =>
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: el.startIndex, endIndex: el.endIndex },
      paragraphStyle: style,
      fields: Object.keys(style).join(","),
    },
  });
const text = (p) => p.elements.map((e) => e.textRun?.content ?? "").join("").trim();

const contentWidth = 612 - 54 * 2; // Letter, 0.75" margins (set on the doc)
// borderBetween too: Drive sets it on runs of same-styled paragraphs, which
// draws a faint rule between bullets and above tables.
const PLAIN = { borderTop: NONE, borderBottom: NONE, borderLeft: NONE, borderBetween: NONE, shading: { backgroundColor: {} } };

// 1. One reset over the whole body: no stray rules or tints, tight spacing.
const last = body[body.length - 1];
requests.push({
  updateParagraphStyle: {
    range: { startIndex: 1, endIndex: last.endIndex - 1 },
    paragraphStyle: { ...PLAIN, spaceAbove: pt(0), spaceBelow: pt(2), lineSpacing: 115 },
    fields: "borderTop,borderBottom,borderLeft,borderBetween,shading,spaceAbove,spaceBelow,lineSpacing",
  },
});

// 2. Only the paragraphs that differ from the reset.
for (const el of body) {
  if (el.paragraph) {
    const t = text(el.paragraph);
    const key = norm(t);
    if (headings.has(key)) {
      para(el, { borderBottom: line(INK, 0.75, 3), spaceAbove: pt(12), spaceBelow: pt(5), keepWithNext: true });
    } else if (callouts.has(key)) {
      para(el, { borderLeft: line("#b3261e", 3, 8), shading: { backgroundColor: rgb("#fbedec") }, indentStart: pt(8), indentFirstLine: pt(8), spaceBelow: pt(8) });
    } else if (!t) {
      // The blank line Docs keeps in front of every table: make it vanish.
      para(el, { spaceBelow: pt(0), lineSpacing: 100 });
      requests.push({ updateTextStyle: { range: { startIndex: el.startIndex, endIndex: el.endIndex }, textStyle: { fontSize: pt(2) }, fields: "fontSize" } });
    }
  } else if (el.table) {
    const tb = el.table;
    const loc = { index: el.startIndex };
    // Column widths: share the page by the longest text in each column,
    // with a floor so a short column (a date, an amount) still reads.
    const weights = Array.from({ length: tb.columns }, (_, c) => {
      const n = Math.max(...tb.tableRows.map((r) => r.tableCells[c].content.map((x) => (x.paragraph ? text(x.paragraph).length : 0)).reduce((a, b) => a + b, 0)));
      return Math.sqrt(Math.min(Math.max(n, 10), 80)); // sqrt: long text wraps, short columns keep room
    });
    const total = weights.reduce((a, b) => a + b, 0);
    // Repeat the dark header row when a table runs onto the next page.
    requests.push({ pinTableHeaderRows: { tableStartLocation: loc, pinnedHeaderRowsCount: 1 } });
    weights.forEach((w, c) =>
      requests.push({
        updateTableColumnProperties: {
          tableStartLocation: loc,
          columnIndices: [c],
          tableColumnProperties: { widthType: "FIXED_WIDTH", width: pt(Math.round((contentWidth * w) / total)) },
          fields: "widthType,width",
        },
      }),
    );
    const { padding, ...edge } = line("#dcdcd8", 0.5); // cell borders take no padding
    requests.push({
      updateTableCellStyle: {
        tableRange: { tableCellLocation: { tableStartLocation: loc, rowIndex: 0, columnIndex: 0 }, rowSpan: tb.rows, columnSpan: tb.columns },
        tableCellStyle: { paddingTop: pt(3), paddingBottom: pt(3), paddingLeft: pt(5), paddingRight: pt(5), contentAlignment: "MIDDLE", borderTop: edge, borderBottom: edge, borderLeft: edge, borderRight: edge },
        fields: "paddingTop,paddingBottom,paddingLeft,paddingRight,contentAlignment,borderTop,borderBottom,borderLeft,borderRight",
      },
    });
  }
}

// 3. Last, and highest index first: delete any horizontal-rule objects. Drive
// makes one out of a CSS border, and render.mjs no longer emits those, so
// this is a guard. Deleting last keeps every index above still valid.
const rules = [];
const walk = (content) => {
  for (const el of content) {
    if (el.paragraph) for (const e of el.paragraph.elements) if (e.horizontalRule) rules.push(e.startIndex);
    if (el.table) for (const r of el.table.tableRows) for (const c of r.tableCells) walk(c.content);
  }
};
walk(body);
rules.sort((a, b) => b - a).forEach((i) => requests.push({ deleteContentRange: { range: { startIndex: i, endIndex: i + 1 } } }));

process.stdout.write(JSON.stringify(requests) + "\n");
