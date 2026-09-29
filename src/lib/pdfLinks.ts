/**
 * The clickable links inside a PDF, each with the words it sits on.
 *
 * Architects send finish schedules as PDFs whose spec cells are live links to
 * the product page. Claude reads the table well from the rendered page, but a
 * link's target is an ANNOTATION, not text, so it never reaches the model. This
 * reads the annotations with pdf.js and pairs each one with the text under its
 * rectangle (the anchor) and the text to its left on the same line (the row).
 * Claude then attaches link ids to rows; it never writes a URL itself.
 *
 * Server-only. pdf.js runs in the main thread here: importing its worker module
 * and handing it over as `globalThis.pdfjsWorker` is pdf.js's own hook for that,
 * and it makes the worker file a static import, so Vercel's file tracing ships
 * it with the function.
 */

export interface PdfLink {
  /** "L1", "L2" … — what Claude refers to. */
  id: string;
  url: string;
  /** The words under the link. */
  text: string;
  /** The words left of the link on the same line — usually the row's room and item. */
  context: string;
  page: number;
}

interface TextItem {
  str: string;
  transform: number[];
}

/** Only web links. A PDF can carry `javascript:` or `file:` targets. */
export function isWebUrl(u: string): boolean {
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

export async function extractPdfLinks(bytes: Uint8Array): Promise<PdfLink[]> {
  // @ts-expect-error pdf.js ships no type declarations for its worker module.
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const task = getDocument({ data: bytes.slice(), disableFontFace: true });
  const doc = await task.promise;
  // One entry per URL. A link that wraps onto a second line is two annotations
  // with one target, and one product often links from several rows (the same
  // floor in three rooms); Claude may give one id to every row it belongs to.
  const byUrl = new Map<string, PdfLink>();
  const add = (list: string, part: string, sep: string) =>
    !part || list.includes(part) ? list : list ? `${list}${sep}${part}` : part;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const annots = (await page.getAnnotations()) as { subtype?: string; url?: string; rect?: number[] }[];
      const items = ((await page.getTextContent()).items as TextItem[]).filter(
        (i) => typeof i.str === "string" && i.str.trim(),
      );
      const x = (i: TextItem) => i.transform[4];
      const y = (i: TextItem) => i.transform[5];
      for (const a of annots) {
        if (a.subtype !== "Link" || !a.url || !a.rect || !isWebUrl(a.url)) continue;
        const [x1, y1, x2, y2] = a.rect;
        const text = items
          .filter((i) => x(i) >= x1 - 1 && x(i) <= x2 + 1 && y(i) >= y1 - 2 && y(i) <= y2 + 2)
          .map((i) => i.str.trim())
          .join(" ");
        const context = items
          .filter((i) => Math.abs(y(i) - (y1 + 1)) < 4 && x(i) < x1)
          .sort((m, n) => x(m) - x(n))
          .map((i) => i.str.trim())
          .join(" ");
        const link = byUrl.get(a.url) ?? { id: `L${byUrl.size + 1}`, url: a.url, text: "", context: "", page: p };
        link.text = add(link.text, text, " ");
        link.context = add(link.context, context, " / ");
        byUrl.set(a.url, link);
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return [...byUrl.values()];
}
