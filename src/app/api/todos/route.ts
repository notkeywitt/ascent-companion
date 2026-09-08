import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { createToDo, getOpenToDos, type OpenToDo } from "@/lib/jobtread";
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
 * then undated — the order you would work them in. The signed-in person is
 * matched to their JobTread user through the Employee roster link
 * (src/lib/jtUserLink.ts), not by name, so two people called Casey stay apart.
 * An account with no roster link gets the unassigned + org-wide list rather
 * than an empty card.
 *
 * GET  ?limit=5          → { ok, me, todos, counts }
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
  // The cached roster link. `resolve` can cost one Apps Script round trip on a
  // cold row, which this route can afford — the card fetches it once per visit.
  const link = email ? await resolveJtUserLink(email).catch(() => null) : null;
  const myUserId = (link?.jtUserId ?? "").trim();

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
  const unassigned = rows.filter((r) => !r.mine && r.who === "").sort(byWorkOrder);
  // Mine first, then the ones nobody has picked up. Somebody else's to-do is
  // not on this card at all — /jobs and JobTread itself are where you read
  // another person's list.
  const shown = [...mine, ...unassigned].slice(0, limit);

  return NextResponse.json({
    ok: true,
    me: { name: link?.name ?? "", jtUserName: link?.jtUserName ?? "", linked: Boolean(myUserId) },
    todos: shown,
    counts: {
      mine: mine.length,
      unassigned: unassigned.length,
      overdue: [...mine, ...unassigned].filter((r) => r.overdue).length,
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
