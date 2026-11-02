import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { sunsetStatementLinks } from "@/db/schema";
import { sunsetLineKey, sunsetLinkId } from "@/lib/sunsetLinks";

// /api/sunset-statement-links — the office's "Link" on a Sunset statement line.
//   POST   { statementExpId, lineNumber, docId?, invoiceNumber? } → save (replaces)
//   DELETE { statementExpId, lineNumber }                          → remove
// A link tells the statement reconcile which JobTread bill a printed line pays,
// on any job. It is reconcile metadata in the companion DB: it never writes to
// JobTread, the sheet or Drive. The reconcile route passes every link to
// appscript, which applies them before any automatic match.
// Gated on the "recode" view (views.ts) — office/admin, like the other Sunset
// writes on /payments.

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  const statementExpId = String(body.statementExpId ?? "").trim();
  const lineNumber = String(body.lineNumber ?? "").trim();
  const docId = String(body.docId ?? "").trim();
  const invoiceNumber = String(body.invoiceNumber ?? "").trim();
  if (!statementExpId || !sunsetLineKey(lineNumber)) {
    return NextResponse.json({ ok: false, error: "statementExpId and lineNumber are required." }, { status: 400 });
  }
  if (!docId && !sunsetLineKey(invoiceNumber)) {
    return NextResponse.json({ ok: false, error: "Pick a bill (docId) or type its invoice number." }, { status: 400 });
  }

  let email = "";
  try {
    email = (await auth())?.user?.email ?? "";
  } catch {
    /* best-effort — createdBy is optional */
  }

  await ensureDb();
  const row = {
    id: sunsetLinkId(statementExpId, lineNumber),
    statementExpId,
    lineNumber,
    lineKey: sunsetLineKey(lineNumber),
    docId,
    invoiceNumber,
    createdBy: email,
    createdAt: new Date().toISOString(),
  };
  await db
    .insert(sunsetStatementLinks)
    .values(row)
    .onConflictDoUpdate({
      target: sunsetStatementLinks.id,
      set: { docId, invoiceNumber, lineNumber, createdBy: email, createdAt: row.createdAt },
    });
  return NextResponse.json({ ok: true, link: row });
}

export async function DELETE(req: NextRequest) {
  const body = await readBody(req);
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  const statementExpId = String(body.statementExpId ?? "").trim();
  const lineNumber = String(body.lineNumber ?? "").trim();
  if (!statementExpId || !sunsetLineKey(lineNumber)) {
    return NextResponse.json({ ok: false, error: "statementExpId and lineNumber are required." }, { status: 400 });
  }
  await ensureDb();
  await db.delete(sunsetStatementLinks).where(eq(sunsetStatementLinks.id, sunsetLinkId(statementExpId, lineNumber)));
  return NextResponse.json({ ok: true });
}
