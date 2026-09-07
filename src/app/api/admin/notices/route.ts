import { NextRequest, NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { allowedUsers, notices, noticeReads } from "@/db/schema";
import { auth, envAllowed } from "@/auth";
import { ROLES, resolveAllowedViews } from "@/lib/views";
import {
  NOTICE_DISPLAYS,
  NOTICE_TONES,
  cleanEmails,
  cleanRoles,
  joinList,
  windowIsOrdered,
  type NoticeDisplay,
  type NoticeTone,
} from "@/lib/notices";

/**
 * The AUTHORING side of notices (Notices page + Admin → Notices). CRUD over the
 * `notices` table: what it says, how it shows, when it shows, and who sees it.
 *
 * ADMIN **and OFFICE** — not admin-only like /api/team. The gate is the
 * `notices` view id, which office holds by default (lib/views.ts), so posting an
 * announcement is a normal office job while access control stays admin-only.
 * Middleware already refuses this path to a role without that view; the check
 * repeats here so the route is safe on its own.
 *
 * These are companion-DB writes, not JobTread writes, so they sit outside the
 * Pave write gates entirely.
 *
 * The path keeps its /api/admin/ prefix from when notices were admin-only —
 * renaming it would break nothing but buys nothing either. The reader's feed is
 * the separate, ungated /api/notices.
 */

async function requireAuthor() {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  const u = session?.user;
  const isFounder = envAllowed().includes(email);
  const canAuthor =
    isFounder ||
    u?.role === "admin" ||
    (!!u && resolveAllowedViews(u.role, u.viewsAllow, u.viewsDeny, u.roleBase).has("notices"));
  return { canAuthor, email };
}

const FORBIDDEN = NextResponse.json({ error: "Forbidden" }, { status: 403 });

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/** An ISO stamp, or "" for an open end of the window. Rejects anything else. */
function normalizeStamp(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Validate the audience and reduce it to the stored shape. "targeted" with both
 * lists empty is rejected: it would reach nobody, which is never what the author
 * meant, and the old columns are cleared so a row can't carry two answers.
 */
function normalizeAudience(body: Record<string, unknown>):
  | { audienceType: string; audienceValue: string; audienceRoles: string; audienceEmails: string }
  | null {
  const everyone = body.audienceType === "all" || body.audienceType === undefined;
  if (everyone) {
    return { audienceType: "all", audienceValue: "", audienceRoles: "", audienceEmails: "" };
  }
  if (body.audienceType !== "targeted") return null;
  const roles = cleanRoles(body.audienceRoles);
  const emails = cleanEmails(body.audienceEmails);
  if (roles.length === 0 && emails.length === 0) return null;
  return {
    audienceType: "targeted",
    audienceValue: "",
    audienceRoles: joinList(roles),
    audienceEmails: joinList(emails),
  };
}

/** All notices, newest first, each with a count of who's acknowledged it. */
async function listNotices() {
  const rows = await db.select().from(notices).orderBy(desc(notices.id));
  const counts = await db
    .select({ noticeId: noticeReads.noticeId, n: sql<number>`count(*)` })
    .from(noticeReads)
    .groupBy(noticeReads.noticeId);
  const readCount = new Map(counts.map((c) => [c.noticeId, Number(c.n)]));
  return rows.map((r) => ({ ...r, readCount: readCount.get(r.id) ?? 0 }));
}

/**
 * Everyone who can sign in, so the author picks a person from a list instead of
 * typing an email. A typo in a hand-typed address is a notice that silently
 * reaches nobody. Env founders aren't in the table and are always admins.
 */
async function listPeople() {
  const rows = await db
    .select({ email: allowedUsers.email, role: allowedUsers.role })
    .from(allowedUsers);
  const people = new Map(rows.map((r) => [r.email.toLowerCase(), r.role]));
  for (const email of envAllowed()) people.set(email, "admin");
  return [...people.entries()]
    .map(([email, role]) => ({ email, role }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function GET() {
  const { canAuthor } = await requireAuthor();
  if (!canAuthor) return FORBIDDEN;
  await ensureDb();
  return NextResponse.json({
    notices: await listNotices(),
    people: await listPeople(),
    roles: ROLES,
  });
}

export async function POST(req: NextRequest) {
  const { canAuthor, email } = await requireAuthor();
  if (!canAuthor) return FORBIDDEN;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const title = String(body.title ?? "").trim();
  if (!title) return bad("title is required");
  const tone = NOTICE_TONES.includes(body.tone as NoticeTone) ? (body.tone as NoticeTone) : "info";
  const display = NOTICE_DISPLAYS.includes(body.display as NoticeDisplay)
    ? (body.display as NoticeDisplay)
    : "banner";
  const audience = normalizeAudience(body);
  if (!audience) return bad("Pick who sees this — a group, a person, or everyone.");
  const startsAt = normalizeStamp(body.startsAt);
  const endsAt = normalizeStamp(body.endsAt);
  if (startsAt === null || endsAt === null) return bad("invalid start or end time");
  if (!windowIsOrdered(startsAt, endsAt)) return bad("The end time must come after the start.");

  await ensureDb();
  const now = new Date().toISOString();
  await db.insert(notices).values({
    title,
    body: String(body.body ?? "").trim(),
    tone,
    display,
    // A popup is always dismissible — it covers the page, so an unclearable one
    // would lock the app. Only a banner can be made standing.
    dismissible: display === "popup" ? true : body.dismissible !== false,
    startsAt,
    endsAt,
    ...audience,
    active: body.active === false ? false : true,
    createdBy: email,
    createdAt: now,
    updatedAt: now,
  });
  return NextResponse.json({ notices: await listNotices() }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { canAuthor } = await requireAuthor();
  if (!canAuthor) return FORBIDDEN;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return bad("id required");

  const set: Partial<typeof notices.$inferInsert> = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) return bad("title can't be empty");
    set.title = title;
  }
  if (body.body !== undefined) set.body = String(body.body).trim();
  if (body.tone !== undefined) {
    if (!NOTICE_TONES.includes(body.tone as NoticeTone)) return bad("invalid tone");
    set.tone = body.tone as NoticeTone;
  }
  if (body.display !== undefined) {
    if (!NOTICE_DISPLAYS.includes(body.display as NoticeDisplay)) return bad("invalid display");
    set.display = body.display as NoticeDisplay;
    if (body.display === "popup") set.dismissible = true;
  }
  if (body.dismissible !== undefined && set.dismissible === undefined) {
    set.dismissible = Boolean(body.dismissible);
  }
  if (body.active !== undefined) set.active = Boolean(body.active);
  if (body.startsAt !== undefined || body.endsAt !== undefined) {
    // The window is validated as a PAIR, so read whichever half wasn't sent off
    // the stored row rather than assuming "".
    const [row] = await db
      .select({ startsAt: notices.startsAt, endsAt: notices.endsAt })
      .from(notices)
      .where(eq(notices.id, id))
      .limit(1);
    if (!row) return NextResponse.json({ error: "No such notice" }, { status: 404 });
    const startsAt = body.startsAt !== undefined ? normalizeStamp(body.startsAt) : row.startsAt;
    const endsAt = body.endsAt !== undefined ? normalizeStamp(body.endsAt) : row.endsAt;
    if (startsAt === null || endsAt === null) return bad("invalid start or end time");
    if (!windowIsOrdered(startsAt, endsAt)) return bad("The end time must come after the start.");
    set.startsAt = startsAt;
    set.endsAt = endsAt;
  }
  if (body.audienceType !== undefined) {
    const audience = normalizeAudience(body);
    if (!audience) return bad("Pick who sees this — a group, a person, or everyone.");
    Object.assign(set, audience);
  }
  if (Object.keys(set).length === 0) return bad("nothing to update");
  set.updatedAt = new Date().toISOString();

  await ensureDb();
  await db.update(notices).set(set).where(eq(notices.id, id));
  return NextResponse.json({ notices: await listNotices() });
}

export async function DELETE(req: NextRequest) {
  const { canAuthor } = await requireAuthor();
  if (!canAuthor) return FORBIDDEN;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return bad("id required");
  await ensureDb();
  await db.delete(noticeReads).where(eq(noticeReads.noticeId, id));
  await db.delete(notices).where(eq(notices.id, id));
  return NextResponse.json({ notices: await listNotices() });
}
