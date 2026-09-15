/**
 * THE RULE: whose time may this request touch?
 *
 *   Your own JobTread user            → always allowed.
 *   Someone else's, and you are ADMIN → allowed, and marked `acting`.
 *   Someone else's, and you are not   → refused, 403.
 *
 * ONE EXCEPTION, and it is the reason the field was ever loose: a person whose
 * roster link carries NO JobTread user has no "own" to compare against. They
 * are identifying themselves, not impersonating anyone, so any org user is
 * accepted from them. An admin closes that gap for good by linking them on the
 * Employees page.
 *
 * Its own module, with NO imports, because `actingAs.ts` around it reads the
 * session and the JobTread roster — and the rule has to be testable without
 * either. `lib/actingAs.ts` is what applies it to a real request.
 */

/**
 * The decision, with no I/O — given who is asking and what they asked for.
 *
 * Split out from `resolveTimeIdentity` so the rule above is unit-testable
 * without a session, a database or JobTread. `ownJtUserId` is "" for a person
 * whose roster link names no JobTread user.
 */
export function decideTimeSubject(args: {
  requested: string;
  ownJtUserId: string;
  role: string;
}): { subject: string; acting: boolean } | { error: string; status: number } {
  const requested = (args.requested ?? "").trim();
  const own = (args.ownJtUserId ?? "").trim();
  const subject = requested || own;

  if (!subject) {
    return { error: "No JobTread user — pick who you are in JobTread first.", status: 400 };
  }
  if (subject === own) return { subject, acting: false };

  // No link of their own: this is self-identification, not impersonation.
  if (!own) return { subject, acting: false };

  if (args.role !== "admin") {
    return { error: "You can only log and edit your own time.", status: 403 };
  }
  return { subject, acting: true };
}
