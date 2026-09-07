import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getJobBoard, getLatestJobForUser } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { resolveJtUserLink } from "@/lib/jtUserLink";
import { ACTIVE_PHASE, spentOf } from "@/lib/jobBoard";

/**
 * Read-only: the home page's job board.
 *
 * WHAT COMES BACK DEPENDS ON THE ROLE, and that decision is made HERE rather
 * than in the browser — the board carries every job's budget, so a field phone
 * asking for it must get nothing back, not a hidden component.
 *   admin / office → every Phase="Active" job, the kanban row across the top
 *   lead           → the one job they last logged time to, as a wide panel
 *   field          → nothing
 *
 * Not gated in src/lib/views.ts on purpose: it answers per-role, so there is no
 * one view id it belongs to.
 */

export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const session = await auth();
  const role = session?.user?.role ?? "field";
  if (role === "field") return NextResponse.json({ role, cards: [] });

  try {
    const cfg = getPaveConfig();
    const cards = await getJobBoard(cfg);

    if (role === "lead") {
      const link = await resolveJtUserLink(session?.user?.email ?? "");
      const jobId = link?.jtUserId ? await getLatestJobForUser(cfg, link.jtUserId) : null;
      const mine = cards.find((c) => c.id === jobId);
      return NextResponse.json({ role, cards: mine ? [mine] : [] });
    }

    // Phase "Active" IS the board: it already excludes the pre-construction
    // budgets, the prospects, the completed work and Ascent's own overhead jobs,
    // which `closedOn` cannot (every job in the org is open). Jobs in flight
    // first — something on the calendar today — then by spend, so the row reads
    // left to right as "what is being worked, and how big".
    const board = cards
      .filter((c) => c.phase === ACTIVE_PHASE)
      .sort(
        (a, b) =>
          Number((b.schedule?.now.length ?? 0) > 0) - Number((a.schedule?.now.length ?? 0) > 0) ||
          spentOf(b) - spentOf(a),
      );
    return NextResponse.json({ role, cards: board });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
