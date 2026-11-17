import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { roadmapVotes } from "@/db/schema";
import { FEATURE_IDS } from "@/lib/roadmap";

/**
 * Roadmap votes (src/lib/roadmap.ts).
 *
 *   GET                       → { votes: [{ email, name, feature, score }], me }
 *   POST { feature, score }   → { ok }  sets the signed-in person's priority;
 *                                       score null clears it.
 *
 * Companion DB only. Gated by the "roadmap" view.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  await ensureDb();
  const votes = await db
    .select({
      email: roadmapVotes.email,
      name: roadmapVotes.name,
      feature: roadmapVotes.feature,
      score: roadmapVotes.score,
    })
    .from(roadmapVotes);
  return NextResponse.json({ votes, me: session?.user?.email?.toLowerCase() ?? "" });
}

export async function POST(req: NextRequest) {
  let body: { feature?: unknown; score?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const feature = String(body.feature ?? "");
  const score = body.score === null ? null : Number(body.score);
  if (!FEATURE_IDS.has(feature) || (score !== null && ![0, 1, 2, 3].includes(score)))
    return NextResponse.json({ error: "Send a feature and a score 0–3." }, { status: 400 });
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await ensureDb();
  const where = and(eq(roadmapVotes.email, email), eq(roadmapVotes.feature, feature));
  if (score === null) {
    await db.delete(roadmapVotes).where(where);
  } else {
    const row = {
      email,
      feature,
      score,
      name: session?.user?.name ?? "",
      updatedAt: new Date().toISOString(),
    };
    await db
      .insert(roadmapVotes)
      .values(row)
      .onConflictDoUpdate({ target: [roadmapVotes.email, roadmapVotes.feature], set: row });
  }
  return NextResponse.json({ ok: true });
}
