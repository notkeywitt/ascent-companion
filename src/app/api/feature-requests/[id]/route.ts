import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { featureRequests } from "@/db/schema";
import { requireAuth } from "@/lib/require-auth";

// PATCH /api/feature-requests/:id — update status / title / detail.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const reqId = Number(id);
  if (!Number.isFinite(reqId)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const FR_STATUSES = ["open", "planned", "done", "declined"];
  if (typeof body.status === "string" && !FR_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of ${FR_STATUSES.join("|")}` },
      { status: 400 },
    );
  }
  const patch: Record<string, string> = { updatedAt: new Date().toISOString() };
  for (const field of ["status", "title", "detail", "requester"]) {
    if (typeof body[field] === "string") patch[field] = body[field];
  }
  await ensureDb();
  const [row] = await db
    .update(featureRequests)
    .set(patch)
    .where(eq(featureRequests.id, reqId))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ request: row });
}
