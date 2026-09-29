import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { specFiles } from "@/db/schema";

/**
 * GET ?id=<spec list id> → the PDF that list was read from, inline, so the
 * browser's own PDF viewer shows it with its links live. Gated by the "specs"
 * view with the rest of /api/specs.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Send id." }, { status: 400 });
  await ensureDb();
  const [row] = await db.select().from(specFiles).where(eq(specFiles.listId, id)).limit(1);
  if (!row) return NextResponse.json({ error: "No PDF is kept for that import." }, { status: 404 });
  const name = (row.name || "spec-list.pdf").replace(/[^\w .()-]/g, "_");
  return new NextResponse(new Uint8Array(row.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
