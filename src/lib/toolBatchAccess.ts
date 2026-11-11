import { auth } from "@/auth";
import { noAuthConfigured } from "@/lib/authMode";
import { resolveAllowedViews } from "@/lib/views";

/** The view that may start a batch analysis and clear its problems (office + admin). */
export const TOOLS_BATCH_ANALYZE_VIEW = "tools-batch-analyze";

/** Who is asking, and may they run "Analyze Tools Batch"? Every role may capture. */
export async function toolBatchUser(): Promise<{ email: string; canAnalyze: boolean }> {
  const session = await auth();
  if (!session?.user) return { email: "", canAnalyze: noAuthConfigured() };
  const u = session.user;
  const views = resolveAllowedViews(u.role, u.viewsAllow, u.viewsDeny, u.roleBase);
  return { email: u.email ?? "", canAnalyze: views.has(TOOLS_BATCH_ANALYZE_VIEW) };
}
