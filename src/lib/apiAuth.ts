/**
 * In-handler authorization for API routes that middleware cannot gate.
 *
 * SERVER ONLY — it reads the session, so never import it from a client component.
 *
 * ## When to use this instead of src/lib/views.ts
 *
 * Middleware gates a whole route prefix: every method, every query string. Most
 * routes want exactly that, and belong in a VIEW's `paths` instead of here.
 *
 * This is for the routes middleware cannot express — one route that serves two
 * audiences. `/api/employees` is the case it was written for: the Safety Meeting
 * page (a FIELD view) needs the active roster, while the same route's full read
 * and its edit hand over staff home addresses, birthdays and licence numbers.
 * A prefix gate can only open both or close both.
 *
 * `holdsView` applies the SAME rule middleware applies — role base, per-role
 * admin edits, and per-user grants and denials — so a per-user grant made in the
 * admin console works here too, rather than this being a second, divergent idea
 * of who may do what.
 */
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { noAuthConfigured } from "@/lib/authMode";
import { resolveAllowedViews } from "@/lib/views";

/** The one refusal shape, matching what middleware returns for a gated route. */
export const FORBIDDEN = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

/**
 * Does the signed-in caller hold `viewId`?
 *
 * False for a caller with no session. True on a local dev machine with no
 * sign-in configured, which matches the middleware's own open branch — see
 * src/lib/authMode.ts for why that branch exists and what is wrong with it.
 */
export async function holdsView(viewId: string): Promise<boolean> {
  const session = await auth();
  const user = session?.user;
  if (!user) return noAuthConfigured();
  if (user.revoked) return false;
  return resolveAllowedViews(user.role, user.viewsAllow, user.viewsDeny, user.roleBase).has(viewId);
}
