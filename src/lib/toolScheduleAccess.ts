import { auth } from "@/auth";
import { noAuthConfigured } from "@/lib/authMode";
import { resolveAllowedViews } from "@/lib/views";

/** The view that may edit the tool schedule's catalogue, rules and holds. */
export const TOOL_SCHEDULE_EDIT_VIEW = "tool-schedule-edit";

/**
 * Who is asking, and may they edit the tool schedule? Middleware already gates
 * the edit routes by the same view; this is the check the schedule page uses to
 * show its Edit link, and a second guard on every write.
 */
export async function toolScheduleUser(): Promise<{ email: string; canEdit: boolean }> {
  const session = await auth();
  if (!session?.user) return { email: "", canEdit: noAuthConfigured() };
  const u = session.user;
  const views = resolveAllowedViews(u.role, u.viewsAllow, u.viewsDeny, u.roleBase);
  return { email: u.email ?? "", canEdit: views.has(TOOL_SCHEDULE_EDIT_VIEW) };
}
