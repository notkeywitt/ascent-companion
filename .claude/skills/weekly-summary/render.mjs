#!/usr/bin/env node
// Weekly summary renderer. One Markdown source, three outputs:
//   node render.mjs <week>.md email  → email HTML (simple, no CSS classes)
//   node render.mjs <week>.md text   → plain-text email body
//   node render.mjs <week>.md doc    → HTML for Drive to convert into a Google Doc,
//                                      styled like the Field Binder docs
//
// Markdown it reads (nothing else):
//   # Title                      first line of the document
//   plain paragraph              the first one after the title is the meta line
//   ### Section                  section label
//   - bullet  **bold** inline
//   > callout                    red left rule (doc), bold line (email)
//   | a | b |  with |---| row     table; first row is the header
//   <!-- doc: URL -->            the Google Doc; the email links to it
//   <!-- ... -->                 otherwise ignored

import { readFileSync } from "node:fs";

const [, , file, mode = "email"] = process.argv;
if (!file || !["email", "text", "doc"].includes(mode)) {
  console.error("usage: node render.mjs <file.md> email|text|doc");
  process.exit(1);
}

// ── parse ────────────────────────────────────────────────────────────
const blocks = [];
for (const raw of readFileSync(file, "utf8").split("\n")) {
  const line = raw.trimEnd();
  const last = blocks[blocks.length - 1];
  if (!line.trim() || /^<!--.*-->$/.test(line.trim())) continue;
  if (line.startsWith("# ")) blocks.push({ t: "title", s: line.slice(2) });
  else if (line.startsWith("### ")) blocks.push({ t: "h", s: line.slice(4) });
  else if (line.startsWith("- ")) {
    if (last?.t === "ul") last.items.push(line.slice(2));
    else blocks.push({ t: "ul", items: [line.slice(2)] });
  } else if (line.startsWith("> ")) blocks.push({ t: "callout", s: line.slice(2) });
  else if (line.startsWith("|")) {
    const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (last?.t === "table") last.rows.push(cells);
    else blocks.push({ t: "table", rows: [cells] });
  } else blocks.push({ t: "p", s: line });
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const plain = (s) => s.replace(/\*\*/g, "");

// ── text ─────────────────────────────────────────────────────────────
if (mode === "text") {
  const out = [];
  const doc = readFileSync(file, "utf8").match(/<!-- doc: (\S+) -->/);
  if (doc) out.push("Printable version: " + doc[1], "");
  for (const b of blocks) {
    if (b.t === "title") out.push(plain(b.s));
    else if (b.t === "h") out.push("", plain(b.s).toUpperCase());
    else if (b.t === "ul") b.items.forEach((i) => out.push("- " + plain(i)));
    else if (b.t === "callout") out.push("! " + plain(b.s));
    else if (b.t === "table") b.rows.slice(1).forEach((r) => out.push("- " + r.map(plain).filter((c) => c && c !== "—").join(" · ")));
    else out.push(b.s === "-Keillor" ? "\n" + b.s : plain(b.s));
  }
  process.stdout.write(out.join("\n").trim() + "\n");
  process.exit(0);
}

// ── email ────────────────────────────────────────────────────────────
if (mode === "email") {
  let h = "";
  const doc = readFileSync(file, "utf8").match(/<!-- doc: (\S+) -->/);
  if (doc) h += `<p>Printable version (Google Doc, File → Download → PDF): <a href="${doc[1]}">Office Weekly Summary</a></p>`;
  for (const b of blocks) {
    if (b.t === "title") h += `<h2>${inline(b.s)}</h2>`;
    else if (b.t === "h") h += `<h3>${inline(b.s)}</h3>`;
    else if (b.t === "ul") h += `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
    else if (b.t === "callout") h += `<p><b>${inline(plain(b.s))}</b></p>`;
    else if (b.t === "table") {
      const [head, ...rows] = b.rows;
      h += `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse"><tr>${head.map((c) => `<th align="left">${inline(c)}</th>`).join("")}</tr>`;
      h += rows.map((r) => `<tr>${r.map((c) => `<td valign="top">${inline(c)}</td>`).join("")}</tr>`).join("");
      h += "</table>";
    } else h += `<p>${inline(b.s)}</p>`;
  }
  process.stdout.write(h + "\n");
  process.exit(0);
}

// ── doc (Field Binder style) ─────────────────────────────────────────
// Colours and sizes copied from the Gormley Studio Field Binder tabs.
const INK = "#1b1b17";
const GREY = "#6b6b66";
const ZEBRA = "#f3f3f1";
const RED = "#b3261e";
const RED_TINT = "#fbedec";
const CSS = `
body,p,li,td{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:${INK}}
.ey{font-size:8pt;font-weight:bold;color:${GREY};margin:0}
.ti{font-size:15pt;font-weight:bold;margin:2pt 0 0 0}
.me{font-size:8.5pt;color:${GREY};margin:2pt 0 4pt 0}
.h{font-size:10pt;font-weight:bold;margin:10pt 0 5pt 0}
.co{font-size:10.5pt;font-weight:bold;margin:0 0 8pt 0}
li,.p{font-size:9.5pt;margin:0 0 2pt 0}
table{border-collapse:collapse;width:100%}
td{font-size:8.5pt;padding:4pt 6pt;vertical-align:middle;border:0.5pt solid #dcdcd8}
.th{background-color:${INK};color:#ffffff;font-weight:bold}
.z{background-color:${ZEBRA}}
.k{font-weight:bold}`;

let h = `<html><head><meta charset="utf-8"><style>${CSS}</style></head><body>`;
h += `<p class="ey">OFFICE · WEEKLY SUMMARY</p>`;
let metaDone = false;
for (const b of blocks) {
  if (b.t === "title") h += `<p class="ti">${inline(b.s)}</p>`;
  else if (b.t === "p" && !metaDone) {
    metaDone = true;
    h += `<p class="me">${inline(b.s)}</p>`;
  } else if (b.t === "h") h += `<p class="h">${inline(plain(b.s).toUpperCase())}</p>`;
  else if (b.t === "ul") h += `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
  else if (b.t === "callout") h += `<p class="co">${inline(plain(b.s))}</p>`;
  else if (b.t === "table") {
    const [head, ...rows] = b.rows;
    h += `<table><tr>${head.map((c) => `<td class="th">${inline(plain(c).toUpperCase())}</td>`).join("")}</tr>`;
    rows.forEach((r, i) => {
      h += `<tr>${r.map((c, j) => `<td class="${[i % 2 ? "z" : "", j === 0 ? "k" : ""].join(" ").trim()}">${inline(c)}</td>`).join("")}</tr>`;
    });
    h += "</table>";
  } else h += `<p class="p">${inline(b.s)}</p>`;
}
h += "</body></html>";
process.stdout.write(h + "\n");
