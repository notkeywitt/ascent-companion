import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { findMemberByEmail, getOpenToDosCached } from "@/lib/jobtread";
import { resolveJtUserLink } from "@/lib/jtUserLink";
import { orgDay } from "@/lib/orgTime";

/**
 * The open JobTread to-dos assigned to the person reading — the Jobs page's
 * To-dos card (src/components/HubMyTodos.tsx). READ-ONLY.
 *
 * Why not /api/todos: that route is gated by the admin-only `digest` view and
 * also creates to-dos. Office needs this list and no write, so it has its own
 * route under the `jobs-hub` view. "Who am I" is answered the same way:
 * signed-in email against JobTread memberships, then the Employee roster link.
 * Somebody else's to-do, and an unclaimed one, never appear here.
 *
 * GET ?limit=6 → { ok, me, todos, total, overdue }
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "6");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 6;

  const session = await auth();
  const email = (session?.user?.email ?? "").trim().toLowerCase();
  // The session already carries the JobTread user id (set at sign-in), so the
  // lookups below run only for a token that has none.
  let myUserId = (session?.user?.jtUserId ?? "").trim();
  let myName = "";
  if (!myUserId) {
    const member = email ? await findMemberByEmail(getPaveConfig(), email).catch(() => null) : null;
    const link = !member && email ? await resolveJtUserLink(email).catch(() => null) : null;
    myUserId = (member?.userId || link?.jtUserId || "").trim();
    myName = member?.name || link?.jtUserName || link?.name || "";
  }

  let open;
  try {
    open = await getOpenToDosCached(getPaveConfig());
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // The org's day, not UTC's: a to-do due today is not overdue after 5pm Pacific.
  const today = orgDay(new Date().toISOString());
  const mine = (myUserId ? open.filter((t) => t.assigneeIds.includes(myUserId)) : [])
    .map((t) => {
      const due = t.endDate || t.startDate || null;
      return {
        id: t.id,
        name: t.name,
        due,
        overdue: Boolean(due && due < today),
        jobName: t.jobName ?? null,
      };
    })
    // Overdue first, then soonest due, then undated — the order you work them.
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (!a.due || !b.due) return a.due ? -1 : b.due ? 1 : a.name.localeCompare(b.name);
      return a.due.localeCompare(b.due);
    });

  return NextResponse.json({
    ok: true,
    me: { name: myName, linked: Boolean(myUserId) },
    todos: mine.slice(0, limit),
    total: mine.length,
    overdue: mine.filter((t) => t.overdue).length,
  });
}
