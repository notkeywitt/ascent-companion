/**
 * WHOSE TIME IS THIS REQUEST ABOUT?
 *
 * Every /employee-time route used to answer that question its own way, and the
 * answers disagreed. The Timesheets read was strictly the signed-in person. The
 * edit re-read the entry's owner from JobTread and refused anyone else's. But
 * clock-in, clock-out and "log a range" all took `userId` straight from the
 * request body — because an employee with no roster link has to be able to say
 * "I am this JobTread user" before they can log anything.
 *
 * So the same field meant two things, and one of them was unchecked. This
 * module makes it mean one thing, decided in one place.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 *   Your own JobTread user            → always allowed.
 *   Someone else's, and you are ADMIN → allowed, and marked `acting`.
 *   Someone else's, and you are not   → refused, 403.
 *
 * ONE EXCEPTION, and it is the reason the loose field existed: a person whose
 * roster link carries NO JobTread user has no "own" to compare against. They
 * are identifying themselves, not impersonating anyone, so any real org user is
 * accepted from them — exactly as before. An admin can close that gap for good
 * by linking them on the Employees page.
 *
 * ── WHAT "ACTING" CHANGES, AND WHAT IT NEVER CHANGES ────────────────────────
 *
 * Acting swaps the JobTread user a request reads and writes. It never swaps the
 * ATTRIBUTION: `email` and `role` stay the signed-in admin's, so the Time
 * Entries log's "Logged By" column and the financial journal both name the
 * person who really did it. An admin fixing Dan's Tuesday is recorded as the
 * admin fixing Dan's Tuesday, never as Dan.
 *
 * Server-only: it reads the session and the JobTread org roster.
 */
import { auth } from "@/auth";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { findMemberByEmail, getOrgUsers, type MemberRef } from "@/lib/jobtread";
import { readJtUserLinkByJtUserId, resolveJtUserLink } from "@/lib/jtUserLink";
import { decideTimeSubject } from "@/lib/timeSubject";

export { decideTimeSubject } from "@/lib/timeSubject";

/** Who the request acts as, and who is really making it. */
export interface TimeIdentity {
  /** The JobTread user whose time this request reads or writes. */
  jtUserId: string;
  /** That person's display name, for a log row and a banner. */
  name: string;
  /** That person's login, when we know it. "" for someone who never signed in. */
  subjectEmail: string;
  /** The SIGNED-IN person. Attribution, always — never the subject. */
  email: string;
  role: string;
  /** True when the subject is not the signed-in person. Admin only. */
  acting: boolean;
}

export type TimeIdentityResult =
  | { ok: true; identity: TimeIdentity }
  | { ok: false; status: number; error: string };

/**
 * The signed-in person's OWN JobTread user, asked of JobTread itself.
 *
 * The Employee roster is the first answer, but it matches the login against a
 * hand-typed cell, so one wrong character makes a linked employee resolve to
 * nobody — `millarddfm@gmail.com` on the roster against the
 * `millard.dfm@gmail.com` he actually signs in with (found 2026-09-15). That
 * employee could still LOG time, because a write carries the id the phone
 * picked, but every READ resolves server-side and came back empty: he filed
 * hours all week and his timesheet showed none of them.
 *
 * A JobTread membership already carries the invite address, so ask it before
 * giving up. Cached 30 minutes with the roster (`getMembersByEmail`), and only
 * consulted when the link is blank, so a linked employee pays nothing.
 */
async function ownFromJobTread(email: string, linked: string): Promise<MemberRef | null> {
  if (linked || !hasGrant()) return null;
  return findMemberByEmail(getPaveConfig(), email).catch(() => null);
}

/**
 * Resolve the identity for one /employee-time request.
 *
 * `requested` is whichever field the route carries it in — `?actingAs` on a
 * read, `userId` in a write body. They are the same question, so they get the
 * same answer.
 *
 * A subject that is not the caller's own is checked against the JobTread org
 * roster before it is returned. That check is what stops an arbitrary id
 * reaching `createTimeEntry`, and it is why this is worth a round trip (the
 * roster is cached for 30 minutes — see `getOrgUsers`).
 */
export async function resolveTimeIdentity(requested: string): Promise<TimeIdentityResult> {
  const session = await auth();
  const email = (session?.user?.email ?? "").trim();
  const role = ((session?.user as { role?: string } | undefined)?.role ?? "").trim();
  if (!email) return { ok: false, status: 401, error: "Not signed in." };

  const link = await resolveJtUserLink(email);
  const fallback = (await ownFromJobTread(email, (link?.jtUserId ?? "").trim())) ?? null;
  const own = (link?.jtUserId ?? "").trim() || (fallback?.userId ?? "");

  const decided = decideTimeSubject({ requested, ownJtUserId: own, role });
  if ("error" in decided) return { ok: false, status: decided.status, error: decided.error };

  if (!decided.acting) {
    return {
      ok: true,
      identity: {
        jtUserId: decided.subject,
        name: link?.name || link?.jtUserName || fallback?.name || (session?.user?.name ?? ""),
        subjectEmail: link?.email || email,
        email,
        role,
        acting: false,
      },
    };
  }

  // Acting as someone else. The subject must be a real member of the org — an
  // id that isn't would otherwise be handed straight to a JobTread write.
  if (!hasGrant()) {
    return { ok: false, status: 400, error: "JT_GRANT_KEY is not set, so the roster can't be checked." };
  }
  let name = "";
  try {
    const users = await getOrgUsers(getPaveConfig());
    const hit = users.find((u) => u.id === decided.subject);
    if (!hit) return { ok: false, status: 404, error: "That person isn't a JobTread user in this org." };
    name = hit.name;
  } catch (e) {
    // Fail CLOSED. An unreadable roster cannot be read as permission.
    return {
      ok: false,
      status: 502,
      error: e instanceof Error ? e.message : "Could not check the JobTread roster.",
    };
  }

  return {
    ok: true,
    identity: {
      jtUserId: decided.subject,
      name,
      subjectEmail: await emailForJtUser(decided.subject),
      email,
      role,
      acting: true,
    },
  };
}

/**
 * The subject's own login, from the link cache — the table is keyed by email,
 * so this is the reverse lookup.
 *
 * Best-effort on purpose. It fills the Time Entries log's "Employee Email" for
 * a row an admin files on someone's behalf, and "" is the honest answer for a
 * JobTread user who has never signed into this app. Writing the ADMIN's email
 * there instead would make the log say the wrong thing.
 */
async function emailForJtUser(jtUserId: string): Promise<string> {
  return (await readJtUserLinkByJtUserId(jtUserId))?.email ?? "";
}

/** Is the signed-in person allowed to open someone else's time at all? */
export async function canActAsOthers(): Promise<boolean> {
  const session = await auth();
  return ((session?.user as { role?: string } | undefined)?.role ?? "") === "admin";
}
