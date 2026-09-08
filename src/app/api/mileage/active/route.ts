import { NextRequest, NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";

import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { mileageOpenTrips } from "@/db/schema";
import { OPEN_TRIP_TTL_DAYS, parseTrip } from "@/lib/mileageTrip";

/**
 * The OPEN mileage trip — started, not yet ended.
 *
 * The phone's localStorage is the primary copy; this is the backup that survives
 * a cleared browser and lets a trip started on one device be ended on another.
 * It writes nothing to JobTread and nothing to the Mileage sheet: a trip reaches
 * the sheet only when POST /api/mileage saves the finished one.
 *
 * Scoped to the signed-in user, always from the session and never the body — a
 * trip is one person's drive.
 *
 *   GET    → { trip: ActiveTrip | null }
 *   POST   { trip } → { ok: true }
 *   DELETE → { ok: true }
 */
export const dynamic = "force-dynamic";

async function emailOf(): Promise<string> {
  const session = await auth();
  return (session?.user?.email ?? "").trim().toLowerCase();
}

/** Drop trips nobody ended. A week open means it was abandoned, not driven. */
async function sweep(email: string) {
  const cutoff = new Date(Date.now() - OPEN_TRIP_TTL_DAYS * 86_400_000).toISOString();
  await db
    .delete(mileageOpenTrips)
    .where(and(eq(mileageOpenTrips.email, email), lt(mileageOpenTrips.updatedAt, cutoff)));
}

export async function GET() {
  const email = await emailOf();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    await ensureDb();
    await sweep(email);
    const rows = await db
      .select()
      .from(mileageOpenTrips)
      .where(eq(mileageOpenTrips.email, email))
      .limit(1);
    const trip = rows[0] ? parseTrip(JSON.parse(rows[0].payload)) : null;
    return NextResponse.json({ trip });
  } catch {
    // The backup must never break the page: the phone's own copy is the one that
    // matters, so an unreachable DB reads as "no open trip".
    return NextResponse.json({ trip: null }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const email = await emailOf();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { trip?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const trip = parseTrip(body.trip);
  if (!trip) return NextResponse.json({ error: "A trip with a start point is required" }, { status: 400 });

  const payload = JSON.stringify(trip);
  // The client caps the trail it sends; anything this size is a bug.
  if (payload.length > 256_000) return NextResponse.json({ error: "Trip too large" }, { status: 413 });

  try {
    await ensureDb();
    const updatedAt = new Date().toISOString();
    await db
      .insert(mileageOpenTrips)
      .values({ email, payload, updatedAt })
      .onConflictDoUpdate({ target: mileageOpenTrips.email, set: { payload, updatedAt } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export async function DELETE() {
  const email = await emailOf();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    await ensureDb();
    await db.delete(mileageOpenTrips).where(eq(mileageOpenTrips.email, email));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
