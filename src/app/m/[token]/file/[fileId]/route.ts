import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { houseManuals } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { PUBLIC_TOKEN, pdfPath } from "@/lib/houseManual";

/**
 * A PDF a published house manual links to (owner, 2026-11-02).
 *
 *   GET /m/<token>/file/<driveFileId>  → the file as a PDF, or 404
 *
 * PUBLIC, like /m/<token>: the homeowner opens it with no Google login, and
 * the Drive file needs no sharing — the Apps Script bridge reads it as the
 * office (getDriveFilePdf; a Google Doc, Sheet or Slides file comes back
 * exported to PDF). The token is not enough on its own: a file is served only
 * when the PUBLISHED manual links to this exact path, so the route can never
 * read a Drive file the office did not put on the page.
 *
 * Vercel caps one response at about 4.5 MB, so a bigger PDF gets a short note
 * instead. Cached an hour at the edge, so a page of readers is one Drive read.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FILE_ID = /^[\w-]{10,}$/;
/** Under Vercel's ~4.5 MB response cap, with room for headers. */
const MAX_BYTES = 4_300_000;

const text = (body: string, status: number) =>
  new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await params;
  if (!PUBLIC_TOKEN.test(token) || !FILE_ID.test(fileId)) return text("Not found", 404);
  await ensureDb();
  const [row] = await db
    .select({ html: houseManuals.publishedHtml })
    .from(houseManuals)
    .where(and(eq(houseManuals.publicToken, token), ne(houseManuals.publishedHtml, "")))
    .limit(1);
  if (!row || !row.html.includes(pdfPath(token, fileId))) return text("Not found", 404);

  let pdf: { data: string; name?: string };
  try {
    pdf = await callAppsScriptOrThrow<{ data: string; name?: string }>(
      { action: "getDriveFilePdf", id: fileId },
      { timeoutMs: 110_000 },
    );
  } catch {
    return text("This document could not be opened. Please let Ascent Building Co. know.", 502);
  }
  const bytes = Buffer.from(pdf.data, "base64");
  if (bytes.length > MAX_BYTES) {
    return text("This document is too large to open here. Please ask Ascent Building Co. for a copy.", 413);
  }
  const name = (pdf.name || "document").replace(/\.pdf$/i, "").replace(/[^\w .()-]+/g, "_").slice(0, 120);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // Opens in the browser's own PDF viewer; Save there downloads it.
      "Content-Disposition": `inline; filename="${name}.pdf"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
