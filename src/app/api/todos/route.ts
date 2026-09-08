import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { createToDo, findMemberByEmail, getOpenToDos, type OpenToDo } from "@/lib/jobtread";
import { resolveJtUserLink } from "@/lib/jtUserLink";
import { orgDay } from "@/lib/orgTime";

/**
 * The To Dos card's own route — JobTread to-dos, read live and created live.
 *
 * SEPARATE FROM /api/digest ON PURPOSE. The digest is a stored morning snapshot;
 * a to-do list has to be true when you look at it, because you are working
 * through it and you just added one. So this reads JobTread on every call and
 * the card never shows a to-do the digest happened to catch at 6am.
 *
 * "RELEVANT" MEANS MINE, THEN NOBODY'S. Ordered overdue first, then by due date,
 * then undated — the order you would work them in. Mine and unclaimed are
 * returned SEPARATELY (`mine`, `unclaimed`) so the card can label them; a list
 * that silently mixes in other work reads as the wrong list.
 *
 * WHO AM I is answered by EMAIL first — the signed-in address matched against
 * JobTread's own memberships (`findMemberByEmail`). The Employee roster link is
 * the fallback, not the primary: it is only right once an admin has linked that
 * person, and an unlinked account silently matched nothing, which is why this
 * card first shipped showing unassigned work instead of the reader's own.
 *
 * GET  ?limit=5          → { ok, me, mine, unclaimed, counts }
 * POST { name, jobId?, membershipIds?, dueDate?, description?, notify? }
 *                        → { ok, wrote, previewed?, id? }
 *
 * Gated by the `digest` view (src/lib/views.ts), enforced in middleware — the
 * same gate as the card this backs.
 */
export const dynamic = "force-dynamic";

/** One to-do as the card draws it. */
interface TodoRow {
  id: string;
  name: string;
  description?: string;
  due: string | null;
  overdue: boolean;
  jobId: string | null;
  jobName: string | null;
  /** Display names, or "" when JobTread has it assigned to nobody. */
  who: string;
  /** Is this one assigned to the person reading it. */
  mine: boolean;
}

/** The due date JobTread shows — endDate, else the start it was given. */
function dueOf(t: OpenToDo): string | null {
  return t.endDate || t.startDate || null;
}

/** Overdue first (oldest first), then due soonest, then the undated. */
function byWorkOrder(a: TodoRow, b: TodoRow): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (!a.due && !b.due) return a.name.localeCompare(b.name);
  if (!a.due) return 1;
  if (!b.due) return -1;
  return a.due.localeCompare(b.due);
}

export async function GET(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ ok: false, error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "5");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 5;

  const session = await auth();
  const email = (session?.user?.email ?? "").trim().toLowerCase();
  // The membership that signs in with this address — one cached JobTread read,
  // no Google round trip, right whether or not anybody has been linked.
  const member = email
    ? await findMemberByEmail(getPaveConfig(), email).catch(() => null)
    : null;
  // Fallback only: an office account that is not itself a JobTread member (a
  // shared mailbox, say) can still be resolved through the Employee roster.
  // `resolve` can cost one Apps Script round trip on a cold row, which this
  // route can afford — the card fetches it once per visit.
  const link = !member && email ? await resolveJtUserLink(email).catch(() => null) : null;
  const myUserId = (member?.userId || link?.jtUserId || "").trim();
  const myName = member?.name || link?.jtUserName || link?.name || "";

  let todos: OpenToDo[];
  try {
    todos = await getOpenToDos(getPaveConfig());
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // The ORG's day, not UTC's. A to-do due today reads as overdue after 5pm
  // Pacific if you slice a UTC ISO string instead (the seven-hour error).
  const today = orgDay(new Date().toISOString());
  const rows: TodoRow[] = todos.map((t) => {
    const due = dueOf(t);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      due,
      overdue: Boolean(due && due < today),
      jobId: t.jobId ?? null,
      jobName: t.jobName ?? null,
      who: t.assignees.join(", "),
      mine: Boolean(myUserId) && t.assigneeIds.includes(myUserId),
    };
  });

  const mine = rows.filter((r) => r.mine).sort(byWorkOrder);
  // Nobody has picked these up, so they are everyone's. Somebody ELSE's to-do
  // is not on this card at all — JobTread's own list is where you read theirs.
  const unclaimed = rows.filter((r) => !r.mine && r.who === "").sort(byWorkOrder);
  // Mine gets the whole allowance; the unclaimed only fill what is left, so a
  // busy person never sees someone else's backlog ahead of their own.
  const shownMine = mine.slice(0, limit);
  const shownUnclaimed = unclaimed.slice(0, Math.max(0, limit - shownMine.length));

  return NextResponse.json({
    ok: true,
    me: { name: myName, linked: Boolean(myUserId) },
    mine: shownMine,
    unclaimed: shownUnclaimed,
    counts: {
      mine: mine.length,
      unclaimed: unclaimed.length,
      overdue: mine.filter((r) => r.overdue).length,
      open: rows.length,
    },
  });
}

interface CreateBody {
  name?: string;
  description?: string;
  /** Org-local "YYYY-MM-DD". */
  dueDate?: string;
  jobId?: string;
  /** JobTread MEMBERSHIP ids (UserRef.membershipId from /api/jt-users). */
  membershipIds?: string[];
  notify?: boolean;
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Say what needs doing." }, { status: 400 });
  const dueDate = (body.dueDate ?? "").trim();
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json({ error: `Unreadable due date: ${dueDate}` }, { status: 400 });
  }
  const todo = {
    name,
    description: (body.description ?? "").trim() || undefined,
    dueDate: dueDate || undefined,
    jobId: (body.jobId ?? "").trim() || undefined,
    membershipIds: (body.membershipIds ?? []).map((s) => String(s).trim()).filter(Boolean),
    notify: body.notify !== false,
  };

  if (!writesEnabled()) {
    return NextResponse.json({
      ok: true,
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was sent to JobTread.",
      todo,
    });
  }

  try {
    const { id } = await createToDo(getPaveConfig(), todo);
    return NextResponse.json({ ok: true, previewed: false, wrote: true, id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
