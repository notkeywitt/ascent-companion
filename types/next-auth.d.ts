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
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    va?: string[]; // viewsAllow
    vd?: string[]; // viewsDeny
    rb?: string[]; // roleBase
  }
}
