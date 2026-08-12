import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { notices, noticeReads } from "@/db/schema";
import { auth } from "@/auth";

/**
 * GET /api/notices — the reader's feed: active notices aimed at THIS signed-in
 * user that they haven't dismissed yet. Powers the global popup
 * (src/components/Notices.tsx).
 *
 * Targeting and identity are resolved server-side from the session — the client
 * never says who it is or what role it has, so a notice can't be fished out by
 * spoofing the request. A notice matches when it's active AND either aimed at
 * everyone, at the caller's role, or at the caller's email; already-read notices
 * (a notice_reads row for this email) are filtered out.
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

  const forMe = active.filter((n) => {
    if (readIds.has(n.id)) return false;
    if (n.audienceType === "all") return true;
    if (n.audienceType === "role") return n.audienceValue === role;
    if (n.audienceType === "user") return n.audienceValue.toLowerCase() === email;
    return false;
  });

  return NextResponse.json({
    notices: forMe.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      tone: n.tone,
      createdAt: n.createdAt,
    })),
  });
}
