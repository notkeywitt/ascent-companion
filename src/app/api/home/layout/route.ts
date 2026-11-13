import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { writeHomeLayout } from "@/lib/homeLayoutStore";
import { normalizeLayout } from "@/lib/homeWidgets";

/**
 * POST /api/home/layout { order, hidden, wide } → { ok, layout } — save the
 * reader's own desktop Home arrangement. Companion DB only. The page reads it
 * on the server (src/app/page.tsx), so there is no GET.
 *
 * Gated by the `home` view (src/lib/views.ts).
 */
export async function POST(req: NextRequest) {
  const email = (await auth())?.user?.email ?? "";
  if (!email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const layout = normalizeLayout(await req.json().catch(() => null));
  try {
    await writeHomeLayout(email, layout);
    return NextResponse.json({ ok: true, layout });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not save." }, { status: 500 });
  }
}
