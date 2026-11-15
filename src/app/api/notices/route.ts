import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { notices, type Notice } from "@/db/schema";
import { auth } from "@/auth";
import { list, report } from "@/lib/findings";
import { audienceMatches, isLive } from "@/lib/notices";

const SOURCE = "notices";
/** The reader can clear it: it has a ✕, or it is a popup (always dismissible). */
const canClear = (n: Notice) => n.dismissible || n.display === "popup";

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

  // One `now` for the whole request, so two notices sharing an edge of the same
  // window can't disagree about whether it has passed.
  const now = Date.now();
  const live = active.filter((n) => isLive(n, now) && audienceMatches(n, { email, role }));

  // The reader's own rows in the findings store (scope = their email). Only a
  // notice the reader can clear goes in: a standing banner has no ✕, so it is
  // not a row anyone could dismiss. A dismissal survives the notice ending
  // and starting again, as the old read mark did.
  const clearable = live.filter(canClear);
  await report(
    SOURCE,
    clearable.map((n) => ({
      key: String(n.id),
      kind: "notice",
      severity: n.tone === "warning" ? "warning" : "info",
      title: n.title,
    })),
    email,
  );
  const open = new Set((await list({ source: SOURCE, scope: email, reader: email })).map((r) => r.key));
  const forMe = live.filter((n) => !canClear(n) || open.has(String(n.id)));

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
