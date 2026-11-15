import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { dismissByKey } from "@/lib/findings";

/**
 * POST /api/notices/dismiss { id } — the reader acknowledges a notice. Dismisses
 * the reader's own row in the findings store (source "notices", scope = their
 * email), which keeps it out of the feed and the inbox from now on; a repeat
 * dismiss is harmless. The email comes from the session, never the body.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await dismissByKey("notices", email, String(id), email);
  return NextResponse.json({ ok: true });
}
