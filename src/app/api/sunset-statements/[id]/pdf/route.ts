import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { sunsetStatements } from "@/db/schema";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { driveIdFromLink } from "@/lib/houseManual";

/**
 * GET /api/sunset-statements/:expId/pdf — the statement's Drive PDF, served
 * inline, for the side pane on /payments.
 *
 * The browser cannot embed the Drive link itself: Drive's viewer needs a Google
 * login cookie, which Safari and the Chrome side panel block. The Apps Script
 * owns the Drive and reads the bytes instead (`getDriveFilePdf`, JobFiles.js).
 * Keyed on the ExpID, so only a statement's own PDF can come back.
 *
 * Under /api/sunset-statements, so the "payments" view gates it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const expId = decodeURIComponent(id).trim();
  if (!expId) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  await ensureDb();
  const [row] = await db
    .select({ pdfUrl: sunsetStatements.pdfUrl })
    .from(sunsetStatements)
    .where(eq(sunsetStatements.expId, expId));
  const fileId = row ? driveIdFromLink(row.pdfUrl ?? "") : "";
  if (!fileId) return NextResponse.json({ error: "No PDF on file for this statement." }, { status: 404 });

  try {
    const file = await callAppsScriptOrThrow<{ name: string; data: string }>(
      { action: "getDriveFilePdf", id: fileId },
      { timeoutMs: 50_000 },
    );
    return new NextResponse(Buffer.from(file.data, "base64"), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${(file.name || "statement.pdf").replace(/["\\\r\n]/g, "")}"`,
        // A statement PDF does not change once filed.
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
