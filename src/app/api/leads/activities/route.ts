import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { leadActivities, leads as leadsTable } from "@/db/schema";

/**
 * The contact log for a lead. Companion-owned; nothing here touches JobTread.
 *
 * Logging a touch also stamps `leads.last_contact_date`, which is what the
 * board's staleness aging reads — so "days since last contact" can never drift
 * away from the timeline the office actually sees.
 */

const ACTIVITY_KINDS = ["call", "email", "meeting", "site_visit", "note"] as const;

// GET /api/leads/activities?accountId=... — newest first.
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId")?.trim();
  if (!accountId) return NextResponse.json({ error: "Pass ?accountId=" }, { status: 400 });
  await ensureDb();
  const rows = await db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.accountId, accountId))
    .orderBy(desc(leadActivities.occurredAt), desc(leadActivities.id));
  return NextResponse.json({ activities: rows });
}

// POST /api/leads/activities — log a touch { accountId, kind?, note?, occurredAt? }.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const accountId = String(body.accountId ?? "").trim();
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });

  const kind = String(body.kind ?? "note").trim();
  if (!(ACTIVITY_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `Unknown kind "${kind}"` }, { status: 400 });
  }
  const note = String(body.note ?? "").trim();
  const occurredAt = String(body.occurredAt ?? "").trim() || new Date().toISOString().slice(0, 10);

  const session = await auth();
  const email = session?.user?.email ?? "";

  await ensureDb();
  const now = new Date().toISOString();
  const [row] = await db
    .insert(leadActivities)
    .values({ accountId, kind, note, occurredAt, createdBy: email, createdAt: now })
    .returning();

  // Stamp last contact — a bare "note" is bookkeeping, not a touch, so it does
  // not count as having contacted the lead. Never move the date backwards: a
  // back-dated entry logged after a newer one must not un-freshen the lead.
  if (kind !== "note") {
    const [existing] = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.accountId, accountId));
    if (!existing) {
      await db
        .insert(leadsTable)
        .values({ accountId, lastContactDate: occurredAt, createdAt: now, updatedAt: now });
    } else if (occurredAt > existing.lastContactDate) {
      await db
        .update(leadsTable)
        .set({ lastContactDate: occurredAt, updatedAt: now })
        .where(eq(leadsTable.accountId, accountId));
    }
  }

  return NextResponse.json({ activity: row }, { status: 201 });
}
