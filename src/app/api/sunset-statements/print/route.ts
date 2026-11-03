import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { db, ensureDb } from "@/db";
import { sunsetStatements, type SunsetStatement } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { driveIdFromLink } from "@/lib/houseManual";
import { money } from "@/lib/money";
import { monthKeyLabel, statementMonthKey } from "@/lib/sunsetStatementMonth";

/**
 * GET /api/sunset-statements/print?month=YYYY-MM — one PDF to print: a summary
 * page listing the month's statements (paid or not), then every statement PDF
 * in the same order. The page opens it in a new tab; the browser prints it.
 *
 * Read-only. Each statement PDF comes from Drive through the Apps Script
 * (getDriveFilePdf), as on the side pane. A PDF that cannot be read is named on
 * the summary page instead of failing the whole print.
 *
 * Under /api/sunset-statements, so the "payments" view gates it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PDF_CONCURRENCY = 4;

/** Helvetica speaks WinAnsi only; anything else would throw mid-draw. */
const ascii = (t: string) => String(t ?? "").replace(/[^\x20-\x7E]/g, "").trim();

const fit = (font: PDFFont, size: number, text: string, width: number) => {
  let t = ascii(text);
  while (t && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1);
  return t;
};

const n = (v: string) => Number(v) || 0;

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month")?.trim() ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "Pass ?month=YYYY-MM" }, { status: 400 });

  await ensureDb();
  const rows: SunsetStatement[] = (await db.select().from(sunsetStatements))
    .filter((r) => statementMonthKey(r.statementDate) === month)
    .sort((a, b) => (a.accountName || a.project).localeCompare(b.accountName || b.project) || a.expId.localeCompare(b.expId));
  if (rows.length === 0) return NextResponse.json({ error: `No statements for ${monthKeyLabel(month)}.` }, { status: 404 });


  // Fetch the statement PDFs, a few at a time.
  const pdfs: (PDFDocument | null)[] = new Array(rows.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PDF_CONCURRENCY, rows.length) }, async () => {
      while (next < rows.length) {
        const i = next++;
        const fileId = driveIdFromLink(rows[i].pdfUrl ?? "");
        if (!fileId) continue;
        try {
          const f = await callAppsScriptOrThrow<{ data: string }>(
            { action: "getDriveFilePdf", id: fileId },
            { timeoutMs: 60_000 },
          );
          pdfs[i] = await PDFDocument.load(Buffer.from(f.data, "base64"), { ignoreEncryption: true });
        } catch {
          /* unread or unparseable — named on the summary page */
        }
      }
    }),
  );

  const out = await PDFDocument.create();
  out.setTitle(`Sunset Statements ${monthKeyLabel(month)}`);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  // ---- Summary page(s): Letter, landscape-free, ~32 rows a page.
  const W = 612;
  const H = 792;
  const M = 40;
  const cols: { label: string; x: number; w: number; right?: boolean }[] = [
    { label: "Account", x: M, w: 150 },
    { label: "Acct #", x: M + 155, w: 45 },
    { label: "Job", x: M + 205, w: 95 },
    { label: "Date", x: M + 305, w: 55 },
    { label: "Total", x: M + 362, w: 58, right: true },
    { label: "Discount", x: M + 422, w: 48, right: true },
    { label: "Net", x: M + 472, w: 58, right: true },
  ];
  const statusX = M + 2;
  let page: PDFPage = out.addPage([W, H]);
  let y = H - M;
  const header = () => {
    page.drawText(`Sunset Statements - ${monthKeyLabel(month)}`, { x: M, y, size: 14, font: bold });
    y -= 16;
    page.drawText(`${rows.length} statement${rows.length === 1 ? "" : "s"}. Printed ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`, {
      x: M,
      y,
      size: 9,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 22;
    for (const c of cols) {
      const w = bold.widthOfTextAtSize(c.label, 8);
      page.drawText(c.label, { x: c.right ? c.x + c.w - w : c.x, y, size: 8, font: bold });
    }
    y -= 4;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    y -= 12;
  };
  header();

  let total = 0;
  let net = 0;
  rows.forEach((r, i) => {
    if (y < M + 40) {
      page = out.addPage([W, H]);
      y = H - M;
      header();
    }
    const cells = [
      r.accountName || r.project || r.expId,
      r.statementNumber,
      r.project,
      r.statementDate,
      money(n(r.total)),
      n(r.discount) ? `-${money(n(r.discount))}` : "",
      money(n(r.net || r.total)),
    ];
    cols.forEach((c, k) => {
      const t = fit(font, 9, cells[k], c.w);
      const w = font.widthOfTextAtSize(t, 9);
      page.drawText(t, { x: c.right ? c.x + c.w - w : c.x, y, size: 9, font });
    });
    y -= 13;
    // A statement whose PDF did not come through is named, so the print is not short by surprise.
    if (!pdfs[i]) {
      page.drawText("PDF could not be read - not attached", { x: statusX, y: y + 2, size: 7.5, font, color: rgb(0.7, 0.1, 0.1) });
      y -= 9;
    }
    total += n(r.total);
    net += n(r.net || r.total);
  });
  y -= 2;
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  const tot = [`Total ${money(total)}`, `Net ${money(net)}`].join("     ");
  page.drawText(tot, { x: W - M - bold.widthOfTextAtSize(tot, 9), y: y - 4, size: 9, font: bold });

  // ---- Then every statement, in the summary's order.
  for (const src of pdfs) {
    if (!src) continue;
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }

  const bytes = await out.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Sunset Statements ${month}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
