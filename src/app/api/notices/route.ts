import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { notices, noticeReads } from "@/db/schema";
import { auth } from "@/auth";
import { audienceMatches, isLive } from "@/lib/notices";

/**
 * GET /api/notices — the reader's feed: notices that are LIVE right now, aimed
 * at THIS signed-in user, and not already dismissed. Powers both notice
 * surfaces (src/components/Notices.tsx) — the banner stack under the header and
 * the interrupting popup — from one request, so a page load asks once.
 *
 * Targeting and identity are resolved server-side from the session — the client
 * never says who it is or what role it has, so a notice can't be fished out by
 * spoofing the request. `audienceMatches` and `isLive` (src/lib/notices.ts) are
 * the same functions the authoring page shows its Live/Scheduled status from,
 * which is what keeps "it says live" and "it shows" the same claim.
 */
export async function GET() {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  const role = session?.user?.role ?? "";
  // No session (or dev-open with no identity) → nothing to key reads on.
  if (!email) return NextResponse.json({ notices: [] });

  await ensureDb();
  const active = await db
    .select()
    .from(notices)
    .where(eq(notices.active, true))
    .orderBy(desc(notices.id));

  const readRows = await db
    .select({ noticeId: noticeReads.noticeId })
    .from(noticeReads)
    .where(eq(noticeReads.email, email));
  const readIds = new Set(readRows.map((r) => r.noticeId));

  // One `now` for the whole request, so two notices sharing an edge of the same
  // window can't disagree about whether it has passed.
  const now = Date.now();
  const forMe = active.filter(
    (n) => !readIds.has(n.id) && isLive(n, now) && audienceMatches(n, { email, role }),
  );

  return NextResponse.json({
    notices: forMe.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      tone: n.tone,
      display: n.display,
      dismissible: n.dismissible,
      createdAt: n.createdAt,
    })),
  });
}
