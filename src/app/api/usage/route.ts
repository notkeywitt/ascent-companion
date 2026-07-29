import { NextRequest, NextResponse } from "next/server";
import { auth, envAllowed } from "@/auth";
import { getUsageSummary } from "@/lib/usage";
import { VIEWS } from "@/lib/views";

// Admin → Activity data source: a windowed rollup of who signed in and what they
// used. Admin-only, enforced in-handler the same way /api/team is (this route
// maps to no gate view, so middleware lets any signed-in user through and the
// check below is the actual gate).

/** Env founders or role:"admin" only. */
async function requireAdmin() {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  const isAdmin = session?.user?.role === "admin" || envAllowed().includes(email);
  return { isAdmin };
}

// Map a view id to its human label for the "most-used" rollup.
const VIEW_LABEL = new Map(VIEWS.map((v) => [v.id, v.label]));
function labelFor(viewId: string): string {
  return VIEW_LABEL.get(viewId) ?? viewId;
}

// GET /api/usage?days=30 → UsageSummary
export async function GET(req: NextRequest) {
  const { isAdmin } = await requireAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const raw = Number(req.nextUrl.searchParams.get("days"));
  const days = [7, 30, 90].includes(raw) ? raw : 30;

  const summary = await getUsageSummary(days, labelFor);
  return NextResponse.json(summary);
}
