import { auth, envAllowed } from "@/auth";
import { resolveAllowedViews } from "@/lib/views";

/**
 * May the signed-in person change AscentBot's settings? The `ascentbot` view
 * (admin only by default, lib/views.ts). Middleware already refuses the
 * /api/ascentbot routes to anyone without it; each route checks again so it is
 * safe on its own.
 */
export async function requireBotAdmin(): Promise<{ ok: boolean; email: string }> {
  const session = await auth();
  const u = session?.user;
  const email = (u?.email ?? "").toLowerCase();
  const ok =
    envAllowed().includes(email) ||
    u?.role === "admin" ||
    (!!u && resolveAllowedViews(u.role, u.viewsAllow, u.viewsDeny, u.roleBase).has("ascentbot"));
  return { ok, email };
}
