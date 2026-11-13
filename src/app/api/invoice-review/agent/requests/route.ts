import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { featureRequests } from "@/db/schema";
import { authorizeAgent } from "@/lib/agentToken";

/**
 * /api/invoice-review/agent/requests — the /queue skill's door to App Feedback
 * (scripts/queue/agent.mjs). The owner types tweaks on /requests from any
 * device; /queue reads the open ones here and writes back what it did.
 *
 * It sits under /api/invoice-review/agent so it shares that door's bearer
 * token (REVIEW_AGENT_TOKEN, lib/agentToken.ts) and its public entry in
 * src/middleware.ts. The token is the only gate; there is no session fallback.
 *
 * GET                           open and planned requests, push-through first
 * POST { id, result, status? }  write the result on one request; status
 *                               defaults to "done"
 *
 * WRITES. One row of the companion's feature_requests table. Nothing here
 * touches JobTread.
 */
export const dynamic = "force-dynamic";

const STATUS = ["open", "planned", "done", "declined"];

export async function GET(req: NextRequest) {
  const denied = authorizeAgent(req);
  if (denied) return denied;
  await ensureDb();
  const rows = await db
    .select()
    .from(featureRequests)
    .where(inArray(featureRequests.status, ["open", "planned"]))
    .orderBy(desc(featureRequests.pushThrough), featureRequests.id);
  return NextResponse.json({ requests: rows });
}

export async function POST(req: NextRequest) {
  const denied = authorizeAgent(req);
  if (denied) return denied;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = Number(body.id);
  const result = String(body.result ?? "").trim().slice(0, 2000);
  const status = String(body.status ?? "done");
  if (!Number.isInteger(id) || !result || !STATUS.includes(status)) {
    return NextResponse.json({ error: "Need an id, a result and a known status." }, { status: 400 });
  }
  await ensureDb();
  const [row] = await db
    .update(featureRequests)
    .set({ result, status, updatedAt: new Date().toISOString() })
    .where(eq(featureRequests.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ request: row });
}
