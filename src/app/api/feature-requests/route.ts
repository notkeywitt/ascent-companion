import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { featureRequests } from "@/db/schema";

// GET /api/feature-requests — all requests, newest first.
export async function GET() {
  await ensureDb();
  const rows = await db.select().from(featureRequests).orderBy(desc(featureRequests.id));
  return NextResponse.json({ requests: rows });
}

// POST /api/feature-requests — { title, detail?, requester? }.
export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  await ensureDb();
  const now = new Date().toISOString();
  const [row] = await db
    .insert(featureRequests)
    .values({
      title,
      detail: (body.detail ?? "").trim(),
      requester: (body.requester ?? "").trim(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return NextResponse.json({ request: row }, { status: 201 });
}
