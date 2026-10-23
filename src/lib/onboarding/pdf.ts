/**
 * New-hire paperwork — the PDF half: read a fillable form's fields, fill one
 * from the new hire's answers, and build the office's packet.
 *
 * SERVER ONLY (pdf-lib on Node). The rules for WHICH field gets WHAT live in
 * `fields.ts`; this file only moves values in and out of the PDF.
 *
 * What a filled form carries:
 *   - every employee and fixed answer, made read-only so it cannot be retyped;
 *   - every office field left blank and still fillable (the I-9's Section 2);
 *   - the drawn signature painted onto the page where the form has a
 *     signature field (the field itself is removed so its box cannot cover it);
 *   - one appended page, the signature record: who signed, when, from where,
 *     and the consent they ticked. A form with no signature field (the W-4)
 *     is signed on this page.
 */
import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFField,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import { ORG_TZ } from "@/lib/orgTime";

import {
  groupKey,
  hasSignatureField,
  prefillValues,
  usDate,
  type Answers,
  type FieldConfig,
  type Profile,
  type RawField,
} from "./fields";

/* ---------------------------------------------------------------- reading */

function tooltipOf(f: PDFField): string {
  const tu = f.acroField.dict.get(PDFName.of("TU"));
  const d = tu as { decodeText?: () => string } | undefined;
  try {
    return d?.decodeText ? d.decodeText() : "";
  } catch {
    return "";
  }
}

/** The 0-based page a field's first widget sits on. */
function pageOf(doc: PDFDocument, f: PDFField): number {
  const w = f.acroField.getWidgets()[0];
  if (!w) return 0;
  const pages = doc.getPages();
  const p = w.P();
  if (p) {
    const i = pages.findIndex((pg) => pg.ref === p);
    if (i >= 0) return i;
  }
  const ref = doc.context.getObjectRef(w.dict);
  const page = ref ? doc.findPageForAnnotationRef(ref) : undefined;
  const i = page ? pages.indexOf(page) : -1;
  return i >= 0 ? i : 0;
}

/** A checkbox whose widgets each carry their own "on" value is a pick-one. */
function checkboxValues(f: PDFCheckBox): string[] {
  const vals = f.acroField
    .getWidgets()
    .map((w) => w.getOnValue()?.decodeText())
    .filter((v): v is string => !!v);
  return [...new Set(vals)];
}

function rawOf(doc: PDFDocument, f: PDFField): RawField {
  const base = { name: f.getName(), tooltip: tooltipOf(f), page: pageOf(doc, f) };
  if (f instanceof PDFTextField) {
    const max = f.getMaxLength();
    return { ...base, kind: "text", ...(max ? { maxLength: max } : {}) };
  }
  if (f instanceof PDFCheckBox) {
    const vals = checkboxValues(f);
    return vals.length > 1 ? { ...base, kind: "choice", options: vals } : { ...base, kind: "check" };
  }
  if (f instanceof PDFRadioGroup) return { ...base, kind: "choice", options: f.getOptions() };
  if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
    return { ...base, kind: "choice", options: f.getOptions() };
  }
  if (f instanceof PDFSignature) return { ...base, kind: "signature" };
  return { ...base, kind: "skip" };
}

export interface PdfInfo {
  pages: number;
  fields: RawField[];
}

/** Throws a plain-English Error for a PDF the app cannot fill. */
export async function readPdfFields(bytes: Uint8Array): Promise<PdfInfo> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new Error("That file is not a PDF the app can read.");
  }
  if (doc.isEncrypted) {
    throw new Error("That PDF is locked (encrypted). Upload an unlocked copy.");
  }
  const fields = doc.getForm().getFields().map((f) => rawOf(doc, f));
  return { pages: doc.getPageCount(), fields };
}

/* ---------------------------------------------------------------- filling */

// Helvetica writes WinAnsi only. Keep Latin-1 and the cp1252 extras; fold
// anything else to its base letter, or "?" — a throw here would lose the form.
const CP1252 = new Set("‘’“”–—…•€™‚„†‡ˆ‰Š‹ŒŽ˜šœžŸ");
export function winAnsi(s: string): string {
  let out = "";
  for (const ch of s.replace(/[\r\n\t]+/g, " ")) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252.has(ch)) out += ch;
    else {
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += /^[\x20-\x7e]+$/.test(base) ? base : "?";
    }
  }
  return out;
}

function setText(f: PDFTextField, value: string) {
  let v = winAnsi(value);
  const max = f.getMaxLength();
  if (max && v.length > max) v = v.slice(0, max);
  f.setText(v);
}

function setChoice(f: PDFField, value: string) {
  if (f instanceof PDFRadioGroup) {
    if (f.getOptions().includes(value)) f.select(value);
    return;
  }
  if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
    if (f.getOptions().includes(value)) f.select(value);
    return;
  }
  if (f instanceof PDFCheckBox) {
    // A pick-one checkbox: set the value, then show exactly one widget ticked.
    const on = PDFName.of(value);
    f.acroField.dict.set(PDFName.of("V"), on);
    for (const w of f.acroField.getWidgets()) {
      w.setAppearanceState(w.getOnValue()?.decodeText() === value ? on : PDFName.of("Off"));
    }
  }
}

async function paintSignature(doc: PDFDocument, f: PDFField, png: Uint8Array) {
  const img = await doc.embedPng(png);
  const pages = doc.getPages();
  for (const w of f.acroField.getWidgets()) {
    const p = w.P();
    let page: PDFPage | undefined = p ? pages.find((pg) => pg.ref === p) : undefined;
    if (!page) {
      const ref = doc.context.getObjectRef(w.dict);
      page = ref ? doc.findPageForAnnotationRef(ref) : undefined;
    }
    if (!page) continue;
    const r = w.getRectangle();
    const scale = Math.min(r.height / img.height, r.width / img.width);
    const width = img.width * scale;
    const height = img.height * scale;
    page.drawImage(img, { x: r.x + 2, y: r.y + (r.height - height) / 2, width, height });
  }
}

/** Paint a signature on a printed line the PDF has no field for. */
async function paintBox(doc: PDFDocument, cfg: FieldConfig, png: Uint8Array) {
  const page = doc.getPages()[cfg.page];
  const r = cfg.box;
  if (!page || !r) return;
  // A link drawn over the line (the Direct Deposit form's has one) would sit
  // on top of the signature with a red border. Drop any that overlap.
  const annots = page.node.Annots();
  if (annots) {
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookup(i, PDFDict);
      if (a.get(PDFName.of("Subtype")) !== PDFName.of("Link")) continue;
      const rect = a.lookup(PDFName.of("Rect"), PDFArray)
        .asArray()
        .map((n) => (n instanceof PDFNumber ? n.asNumber() : 0));
      const [x1, y1, x2, y2] = rect;
      if (x1 < r.x + r.width && x2 > r.x && y1 < r.y + r.height && y2 > r.y) annots.remove(i);
    }
  }
  const img = await doc.embedPng(png);
  const scale = Math.min(r.height / img.height, r.width / img.width);
  page.drawImage(img, { x: r.x, y: r.y, width: img.width * scale, height: img.height * scale });
}

export interface Signer {
  name: string;
  email: string;
  ip: string;
  userAgent: string;
  at: Date;
}

export function orgStamp(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ORG_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

/** Today in the org's timezone, as YYYY-MM-DD. */
export function orgToday(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TZ }).format(at);
}

export const CONSENT =
  "I agree that my electronic signature is the legal equivalent of my handwritten signature, and that the information I gave is true and correct.";

/** Write lines top-down, wrapping at `width`. Returns the y below the last line. */
function writeLines(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  size: number,
  width: number,
): number {
  const words = winAnsi(text).split(" ");
  let line = "";
  const flush = () => {
    page.drawText(line, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
    y -= size * 1.4;
    line = "";
  };
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      flush();
      line = w;
    } else line = next;
  }
  if (line) flush();
  return y;
}

async function addSignatureRecord(
  doc: PDFDocument,
  formName: string,
  signer: Signer,
  png: Uint8Array,
  signedHere: boolean,
) {
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 730;
  page.drawText("Electronic signature record", { x: 54, y, size: 16, font: bold });
  y -= 30;
  const rows: [string, string][] = [
    ["Form", formName],
    ["Signed by", signer.name],
    ["Account", signer.email],
    ["Signed at", orgStamp(signer.at)],
    ["IP address", signer.ip || "not recorded"],
    ["Device", signer.userAgent.slice(0, 110) || "not recorded"],
  ];
  for (const [k, v] of rows) {
    page.drawText(k, { x: 54, y, size: 10, font: bold });
    y = writeLines(page, font, v, 150, y, 10, 400) - 4;
  }
  y -= 10;
  y = writeLines(page, font, `The signer ticked: "${CONSENT}"`, 54, y, 10, 500) - 10;
  if (signedHere) {
    y = writeLines(page, font, "This form has no signature field of its own. The signature below signs it.", 54, y, 10, 500) - 6;
  }
  const img = await doc.embedPng(png);
  const scale = Math.min(240 / img.width, 80 / img.height);
  page.drawImage(img, { x: 54, y: y - img.height * scale, width: img.width * scale, height: img.height * scale });
  y -= img.height * scale + 6;
  page.drawLine({ start: { x: 54, y }, end: { x: 320, y }, thickness: 0.6, color: rgb(0.4, 0.4, 0.4) });
  page.drawText(winAnsi(signer.name), { x: 54, y: y - 14, size: 9, font });
}

export interface FillInput {
  template: Uint8Array;
  formName: string;
  fields: FieldConfig[];
  answers: Answers;
  profile: Profile;
  /** Typed on the page, held in browser memory only; used when a field asks for it. */
  ssn: string;
  signaturePng: Uint8Array;
  signer: Signer;
}

/** Fill one form. Only employee and fixed fields are written. */
export async function fillForm(input: FillInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.template, { ignoreEncryption: true });
  const form = doc.getForm();
  // An XFA layer (IRS and USCIS forms carry one) would be drawn INSTEAD of the
  // values written below, and a usage-rights signature would flag every edit.
  form.deleteXFA();
  doc.catalog.delete(PDFName.of("Perms"));

  const prefill = prefillValues(input.profile, orgToday(input.signer.at), input.ssn);
  const signatureFields: PDFField[] = [];

  const boxes: FieldConfig[] = [];
  for (const cfg of input.fields) {
    if (cfg.box) {
      if (cfg.role === "employee" && cfg.kind === "signature") boxes.push(cfg);
      continue;
    }
    let f: PDFField;
    try {
      f = form.getField(cfg.name);
    } catch {
      continue; // the template changed under the setup — skip, never fail the hire
    }
    if (cfg.role === "fixed") {
      if (f instanceof PDFTextField) setText(f, cfg.value ?? "");
      else if (f instanceof PDFCheckBox && cfg.kind === "check") {
        if (cfg.value) f.check();
        else f.uncheck();
      } else if (cfg.value) setChoice(f, cfg.value);
      f.enableReadOnly();
      continue;
    }
    if (cfg.role !== "employee") continue;
    if (cfg.kind === "signature") {
      signatureFields.push(f);
      continue;
    }
    if (f instanceof PDFTextField) {
      // The date is the server's, never the phone's.
      const v = cfg.prefill === "today" ? prefill.today : String(input.answers[cfg.name] ?? "");
      setText(f, v);
    } else if (f instanceof PDFCheckBox && cfg.kind === "check") {
      const on = cfg.group
        ? input.answers[groupKey(cfg.group)] === cfg.name
        : input.answers[cfg.name] === true;
      if (on) f.check();
      else f.uncheck();
    } else {
      const v = input.answers[cfg.name];
      if (typeof v === "string" && v) setChoice(f, v);
    }
    f.enableReadOnly();
  }

  for (const f of signatureFields) {
    await paintSignature(doc, f, input.signaturePng);
    form.removeField(f);
  }
  for (const b of boxes) await paintBox(doc, b, input.signaturePng);

  form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica));
  await addSignatureRecord(doc, input.formName, input.signer, input.signaturePng, !hasSignatureField(input.fields));
  return doc.save({ updateFieldAppearances: false });
}

/* ----------------------------------------------------------------- packet */

export interface ProfileSheetMeta {
  position: string;
  hireDate: string;
  invitedAt: string;
  profileAt: string;
}

/** The packet's first page: who this is, for the bookkeeper. */
export async function profileSheet(p: Profile, meta: ProfileSheetMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 730;
  page.drawText("New hire profile", { x: 54, y, size: 18, font: bold });
  y -= 20;
  page.drawText("Ascent Building Co.", { x: 54, y, size: 10, font });
  y -= 34;
  const name = [p.firstName, p.middleInitial && `${p.middleInitial}.`, p.lastName].filter(Boolean).join(" ");
  const rows: [string, string][] = [
    ["Legal name", name],
    ["Position", meta.position],
    ["Hire date", meta.hireDate ? usDate(meta.hireDate) : ""],
    ["Address", [p.street, p.apt].filter(Boolean).join(" ")],
    ["", [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")],
    ["Phone", p.phone],
    ["Email", p.email],
    ["Date of birth", usDate(p.birthday)],
    ["Driver's license", p.dl],
    ["Emergency contact", [p.emergencyName, p.emergencyRelation && `(${p.emergencyRelation})`].filter(Boolean).join(" ")],
    ["", p.emergencyPhone],
    ["Profile completed", meta.profileAt ? orgStamp(new Date(meta.profileAt)) : "not yet"],
  ];
  for (const [k, v] of rows) {
    if (!k && !v) continue;
    if (k) page.drawText(k, { x: 54, y, size: 10, font: bold });
    y = writeLines(page, font, v || "—", 180, y, 10, 370) - 4;
  }
  return doc.save();
}

/** One PDF out of many, in order. */
export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of parts) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const pg of pages) out.addPage(pg);
  }
  return out.save();
}
