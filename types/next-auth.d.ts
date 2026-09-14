/**
 * Module augmentation so the role + per-user view overrides we stash on the
 * JWT (in the `jwt` callback) and copy onto the session (in the `session`
 * callback) are typed everywhere we read them — middleware, server routes, and
 * the layout. See src/auth.ts. Runtime behaviour is unaffected; this is types.
 */
import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/views";

declare module "next-auth" {
  interface Session {
    user: {
      role?: Role;
      viewsAllow?: string[];
      viewsDeny?: string[];
      roleBase?: string[]; // the role's (possibly admin-edited) default view set
      /** True when the periodic membership re-check found this person is no
       *  longer on the team. Middleware treats it as no session at all. */
      revoked?: boolean;
      jtUserId?: string; // JobTread user id from the cached roster link ("" = unknown)
      employeeId?: string; // the Employee roster row id ("" = unknown)
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    va?: string[]; // viewsAllow
    vd?: string[]; // viewsDeny
    rb?: string[]; // roleBase
    ck?: number; // checkedAt — when membership was last re-verified (ms epoch)
    dead?: boolean; // membership re-check said this person is off the team
    jt?: string; // jtUserId  (short keys: the JWT rides in a cookie)
    emp?: string; // employeeId
  }
}
