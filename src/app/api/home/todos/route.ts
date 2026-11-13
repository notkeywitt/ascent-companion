import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { OFFICE_JOB_ID, findMemberByEmail, getOpenToDos, getOpenToDosCached } from "@/lib/jobtread";
import { rankTodos } from "@/lib/homeTodos";
import { resolveJtUserLink } from "@/lib/jtUserLink";
import { orgDay } from "@/lib/orgTime";

/**
 * GET /api/home/todos[?fresh=1] → { ok, linked, todos } — Home's one to-do list
 * (lib/homeTodos decides what is on it and the order). READ-ONLY.
 *
 * "Who am I": the session's JobTread user id, else the signed-in email against
 * JobTread memberships, else the Employee roster link. The org's open to-dos
 * are kept 60 s; `fresh=1` (after Home adds one) reads them live.
 *
 * Gated by the `home` view (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });

  const session = await auth();
  const email = (session?.user?.email ?? "").trim().toLowerCase();
  let me = (session?.user?.jtUserId ?? "").trim();
  if (!me && email) {
    const member = await findMemberByEmail(getPaveConfig(), email).catch(() => null);
    const link = member ? null : await resolveJtUserLink(email).catch(() => null);
    me = (member?.userId || link?.jtUserId || "").trim();
  }

  try {
    const cfg = getPaveConfig();
    const open = req.nextUrl.searchParams.get("fresh") === "1" ? await getOpenToDos(cfg) : await getOpenToDosCached(cfg);
    const today = orgDay(new Date().toISOString());
    return NextResponse.json({ ok: true, linked: Boolean(me), todos: rankTodos(open, me, OFFICE_JOB_ID, today) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
