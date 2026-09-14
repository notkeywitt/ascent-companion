import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ROLE_VIEWS, resolveAllowedViews, type Role } from "@/lib/views";

/** Emails always allowed (env — the founders / bootstrap). Treated as admins. */
export function envAllowed(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function parseIds(s: string | null | undefined): string[] {
  try {
    const a = JSON.parse(s ?? "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The DB-resolved default view set for a role — the hardcoded ROLE_VIEWS,
 * adjusted by any admin edit made on /admin's Role Defaults editor. "admin"
 * short-circuits with no DB call: it's never overridable, so a bad edit can't
 * lock every admin out of the console that would fix it.
 *
 * Exported so the role-preview lens (src/app/layout.tsx) can render the
 * launcher as a given role would actually see it TODAY — role defaults included
 * — rather than the hardcoded factory set.
 */
export async function roleBaseFor(role: Role): Promise<string[]> {
  if (role === "admin") return ROLE_VIEWS.admin;
  try {
    const { db, ensureDb } = await import("@/db");
    const { roleAccess } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await ensureDb();
    const rows = await db.select().from(roleAccess).where(eq(roleAccess.role, role)).limit(1);
    const row = rows[0];
    if (!row) return ROLE_VIEWS[role];
    return [...resolveAllowedViews(role, parseIds(row.viewsAllow), parseIds(row.viewsDeny))];
  } catch {
    return ROLE_VIEWS[role];
  }
}

/**
 * Resolve a signed-in email to its role + per-user view overrides + that
 * role's (possibly admin-edited) base view set. Env founders are admins;
 * everyone else comes from the allowed_users DB row. Lazy-loads the DB so it
 * never enters the edge/middleware bundle — only ever called from the `jwt`
 * callback on initial sign-in (Node runtime), never per-request on edge.
 */
async function accessForEmail(
  email: string,
): Promise<{ role: Role; va: string[]; vd: string[]; rb: string[] }> {
  if (!email) return { role: "field", va: [], vd: [], rb: await roleBaseFor("field") };
  if (envAllowed().includes(email)) {
    return { role: "admin", va: [], vd: [], rb: await roleBaseFor("admin") };
  }
  try {
    const { db, ensureDb } = await import("@/db");
    const { allowedUsers } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await ensureDb();
    const rows = await db
      .select()
      .from(allowedUsers)
      .where(eq(allowedUsers.email, email))
      .limit(1);
    const row = rows[0];
    if (!row) return { role: "field", va: [], vd: [], rb: await roleBaseFor("field") };
    const role: Role = asRole(row.role);
    return {
      role,
      va: parseIds(row.viewsAllow),
      vd: parseIds(row.viewsDeny),
      rb: await roleBaseFor(role),
    };
  } catch {
    return { role: "field", va: [], vd: [], rb: await roleBaseFor("field") };
  }
}

function asRole(v: unknown): Role {
  return v === "admin" || v === "office" || v === "lead" || v === "field" ? v : "field";
}

/**
 * How long a session lives, and how often the token is re-minted.
 *
 * Until 2026-09-14 neither was set, so the library default applied: THIRTY DAYS,
 * with role and membership stamped into the token at sign-in and never looked at
 * again. Deleting a person in /admin therefore did not sign them out — their
 * existing token kept working, with the role it was issued with, for up to a
 * month. That was finding H-1 of the September 2026 security review.
 *
 * 12 hours is the hard ceiling on that window: a removed account is out by the
 * next working day whatever else fails. `REVALIDATE_MS` below is what usually
 * closes it in minutes instead.
 */
const SESSION_MAX_AGE_S = 12 * 60 * 60; // 12 hours
const SESSION_UPDATE_AGE_S = 30 * 60; // re-mint the token at most every 30 min

/** How stale the last membership check may be before `jwt` looks again. */
const REVALIDATE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Re-read one email's access from the database, for the periodic check in the
 * `jwt` callback.
 *
 * ⚠️ THE RETURN TYPE IS THE WHOLE POINT. This must tell three answers apart,
 * where `accessForEmail` above only tells two:
 *
 *   { member: true, … }  the person is still on the team — refresh their role
 *   { member: false }    the database answered, and they are NOT on it — revoke
 *   null                 the database could not be reached — CHANGE NOTHING
 *
 * The third case is not hypothetical. This callback also runs on the edge
 * runtime, where the libSQL client cannot be imported at all, so the dynamic
 * import throws every time. Collapsing that into "no row found" — which is what
 * `accessForEmail`'s catch does, deliberately, for its own purpose — would sign
 * the whole company out on every edge request. Returning null instead means a
 * request that cannot verify leaves the token exactly as it was, and the 12-hour
 * ceiling above is what bounds the damage.
 */
async function revalidateAccess(
  email: string,
): Promise<{ member: boolean; role: Role; va: string[]; vd: string[]; rb: string[] } | null> {
  if (!email) return null;
  // Founders resolve from env with no database at all, so this path works on the
  // edge too — and a founder can never be locked out by a database problem.
  if (envAllowed().includes(email)) {
    return { member: true, role: "admin", va: [], vd: [], rb: ROLE_VIEWS.admin };
  }
  try {
    const { db, ensureDb } = await import("@/db");
    const { allowedUsers } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await ensureDb();
    const rows = await db
      .select()
      .from(allowedUsers)
      .where(eq(allowedUsers.email, email))
      .limit(1);
    const row = rows[0];
    // The database answered and holds no row for them: removed from the team.
    if (!row) return { member: false, role: "field", va: [], vd: [], rb: [] };
    const role: Role = asRole(row.role);
    return {
      member: true,
      role,
      va: parseIds(row.viewsAllow),
      vd: parseIds(row.viewsDeny),
      rb: await roleBaseFor(role),
    };
  } catch {
    return null; // could not ask — do not revoke
  }
}

/**
 * The key that signs session cookies.
 *
 * The old chain fell through to APP_PASSWORD and then to a fixed string written
 * in this repository. Both are dangerous and were finding M-3 of the September
 * 2026 security review: whoever knew the shared password could mint a token
 * claiming `role: "admin"`, and with neither variable set the key was public.
 *
 * The fallbacks are kept rather than removed, because Auth.js throws without a
 * secret — removing them would take the app down for field staff if AUTH_SECRET
 * turned out not to be set in Vercel, which cannot be checked from this repo. So
 * it warns loudly instead, and DEPLOY.md carries the one-time fix: set
 * AUTH_SECRET, then delete APP_PASSWORD.
 */
function sessionSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return configured;

  const password = process.env.APP_PASSWORD?.trim();
  if (password) {
    console.error(
      "[SECURITY] AUTH_SECRET is not set, so sessions are being signed with APP_PASSWORD. " +
        "Anyone who knows that password can forge an admin session. " +
        "Set AUTH_SECRET in Vercel, then delete APP_PASSWORD.",
    );
    return password;
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      "[SECURITY] Neither AUTH_SECRET nor APP_PASSWORD is set. Sessions are being signed " +
        "with a key that is published in this repository. Set AUTH_SECRET in Vercel now.",
    );
  }
  return "local-dev-only-secret";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: sessionSecret(),
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_S,
    updateAge: SESSION_UPDATE_AGE_S,
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID?.trim(),
      clientSecret: process.env.AUTH_GOOGLE_SECRET?.trim(),
      // Always show Google's account chooser instead of silently reusing the
      // one already signed in — so people can pick which account to use.
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  cookies: {
    // Sent inside the Chrome side-panel iframe (third-party context).
    sessionToken: { options: { httpOnly: true, sameSite: "none", secure: true, path: "/" } },
  },
  callbacks: {
    async signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      if (!email) return false;
      if (envAllowed().includes(email)) return true;
      // Lazy-load the DB so it never enters the edge/middleware bundle.
      try {
        const { db, ensureDb } = await import("@/db");
        const { allowedUsers } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");
        await ensureDb();
        const rows = await db
          .select()
          .from(allowedUsers)
          .where(eq(allowedUsers.email, email))
          .limit(1);
        return rows.length > 0;
      } catch {
        return false;
      }
    },
    // Bake role + overrides into the JWT at sign-in (when `user` is set), and
    // re-check membership periodically on every request after that. This
    // callback runs on the edge as well as in Node, and the edge cannot reach
    // the database — which the re-check below is written around.
    async jwt({ token, user }) {
      if (!user) {
        // ---- Every later request: the periodic membership re-check ----------
        //
        // Access used to be stamped in once, here, and never looked at again for
        // the life of the token — so removing someone in /admin did not sign
        // them out (finding H-1). This is what closes that, without putting a
        // database round trip in front of every request.
        //
        // Three outcomes, and only one of them changes anything:
        //   • checked recently        → return as-is (the common path, free)
        //   • database says "gone"    → mark the token dead; middleware refuses
        //   • database not reachable  → return as-is, and do NOT stamp `ck`,
        //     so the next request that CAN reach it tries again
        //
        // The last case is the edge runtime, where this callback also runs and
        // the database client cannot be imported. That is why a failed check
        // must never look like a successful one — see revalidateAccess.
        const checkedAt = typeof token.ck === "number" ? token.ck : 0;
        if (Date.now() - checkedAt < REVALIDATE_MS) return token;

        const email = (token.email ?? "").toLowerCase();
        if (!email) return token;

        const fresh = await revalidateAccess(email);
        if (!fresh) return token; // could not ask — leave the token untouched

        if (!fresh.member) {
          token.dead = true; // removed from the team; the session callback surfaces it
          token.ck = Date.now();
          return token;
        }

        // Still a member. Refresh role and overrides too, so a DEMOTION also
        // takes effect within REVALIDATE_MS rather than at the next sign-in.
        token.role = fresh.role;
        token.va = fresh.va;
        token.vd = fresh.vd;
        token.rb = fresh.rb;
        token.dead = false;
        token.ck = Date.now();
        return token;
      }

      {
        const email = (user.email ?? token.email ?? "").toLowerCase();
        const access = await accessForEmail(email);
        token.role = access.role;
        token.va = access.va;
        token.vd = access.vd;
        token.rb = access.rb;
        token.dead = false;
        token.ck = Date.now();

        // The person's JobTread identity, carried the same way. A page that
        // logs time needs the JobTread user id, and reading it from the roster
        // costs a ~3 s Apps Script round trip — so it rides in the token and
        // costs nothing per request. DB READ ONLY here: a cache miss leaves it
        // blank and the page resolves it once in the background (which fills
        // the cache), rather than putting three seconds in front of a sign-in.
        try {
          const { readJtUserLink } = await import("@/lib/jtUserLink");
          const link = await readJtUserLink(email);
          if (link) {
            token.jt = link.jtUserId;
            token.emp = link.employeeId;
          }
        } catch {
          /* the page's own fallback covers this */
        }
      }
      return token;
    },
    // Surface the token's role/overrides on the session so middleware
    // (req.auth), server routes, and the layout can read them. (Read the token
    // through a local cast — the next-auth/jwt module augmentation doesn't merge
    // into the callback's token type in this v5 beta, but Session.user does.)
    async session({ session, token }) {
      const t = token as {
        role?: Role;
        va?: string[];
        vd?: string[];
        rb?: string[];
        jt?: string;
        emp?: string;
        dead?: boolean;
      };
      if (session.user) {
        // Founders are always admin — resolved from env (no DB), so a founder
        // is never locked out even on a token minted before roles existed.
        const email = (session.user.email ?? "").toLowerCase();
        const isFounder = email !== "" && envAllowed().includes(email);
        // The periodic re-check found this person is no longer on the team.
        // Middleware treats a revoked session as no session at all, which sends
        // them back to /login; signing in again is what re-tests the allowlist.
        // A founder can never be revoked — their access is env, not a DB row.
        session.user.revoked = !isFounder && t.dead === true;
        const role = isFounder ? "admin" : t.role ?? "field";
        session.user.role = role;
        session.user.viewsAllow = t.va ?? [];
        session.user.viewsDeny = t.vd ?? [];
        // A token minted before role defaults existed has no `rb` — fall back
        // to the hardcoded default rather than leaving it undefined.
        session.user.roleBase = isFounder ? ROLE_VIEWS.admin : t.rb ?? ROLE_VIEWS[role];
        // Blank on a token minted before this existed, or when the link cache
        // missed at sign-in — every reader falls back to resolveJtUserLink().
        session.user.jtUserId = t.jt ?? "";
        session.user.employeeId = t.emp ?? "";
      }
      return session;
    },
  },
  events: {
    // Log every successful sign-in for the Admin → Activity dashboard, and take
    // the opportunity (logins are infrequent) to prune the activity table. Both
    // are lazy-imported so @/db never enters the edge/middleware bundle, exactly
    // like the callbacks above. Best-effort — never block or fail the sign-in.
    async signIn({ user }) {
      const email = (user?.email ?? "").toLowerCase();
      if (!email) return;
      try {
        const { recordLogin, pruneUsageEvents } = await import("@/lib/usage");
        await recordLogin(email);
        await pruneUsageEvents();
      } catch {
        /* activity logging must never break auth */
      }
    },
  },
});
