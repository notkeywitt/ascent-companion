import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { rfis } from "@/db/schema";

// GET /api/rfis?jobId=... — list RFIs for a job (newest first).
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) return NextResponse.json({ error: "Pass ?jobId=" }, { status: 400 });
  await ensureDb();
  const rows = await db.select().from(rfis).where(eq(rfis.jobId, jobId)).orderBy(desc(rfis.id));
  return NextResponse.json({ rfis: rows });
}

// POST /api/rfis — create an RFI { jobId, subject, question?, assignee?, dueDate? }.
export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const jobId = (body.jobId ?? "").trim();
  const subject = (body.subject ?? "").trim();
  if (!jobId || !subject) {
    return NextResponse.json({ error: "jobId and subject are required" }, { status: 400 });
  }
  await ensureDb();
  const now = new Date().toISOString();
  const [row] = await db
    .insert(rfis)
    .values({
      jobId,
      subject,
      question: (body.question ?? "").trim(),
      assignee: (body.assignee ?? "").trim(),
      dueDate: (body.dueDate ?? "").trim(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json({ rfi: row }, { status: 201 });
}
