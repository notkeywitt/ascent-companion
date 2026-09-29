import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { featureRequests } from "@/db/schema";

// PATCH /api/feature-requests/:id — update status / title / detail.
// Office and admin only: every role may SEND feedback (the "requests" view),
// but triaging it is office work. Middleware cannot split a route by method,
// so the check is here.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const role = (await auth())?.user?.role;
  if (role !== "admin" && role !== "office") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
