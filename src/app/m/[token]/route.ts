import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { houseManuals } from "@/db/schema";
import { PUBLIC_TOKEN } from "@/lib/houseManual";

/**
 * A published house manual, for the Squarespace page that embeds it.
 *
 *   GET /m/<token>  → the published block as html, or 404
 *
 * PUBLIC: no sign-in (see PUBLIC in src/middleware.ts). The token is the key,
 * and the route returns only the html the office published on /house-manual —
 * never the draft, the job id or the linked Drive sources. Any site may read it
 * (CORS `*`), because the Squarespace page fetches it from its own domain.
 */

export const dynamic = "force-dynamic";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
  // Opened straight in a browser, this is a page on the app's own origin.
  // The block needs no script, so the page may run none and gets no cookies.
  "Content-Security-Policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; sandbox",
  // Up to a minute at Vercel's edge, where it caches. A new publish shows
  // within that minute.
  "Cache-Control": "public, max-age=0, s-maxage=60",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!PUBLIC_TOKEN.test(token)) return new NextResponse("Not found", { status: 404, headers: HEADERS });
  await ensureDb();
  const [row] = await db
    .select({ html: houseManuals.publishedHtml })
    .from(houseManuals)
    .where(and(eq(houseManuals.publicToken, token), ne(houseManuals.publishedHtml, "")))
    .limit(1);
  if (!row) return new NextResponse("Not found", { status: 404, headers: HEADERS });
  return new NextResponse(row.html, { headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}
