import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { recordView } from "@/lib/usage";
import { viewIdForPath } from "@/lib/views";

// Page-view beacon. The UsageBeacon client component (in the root layout) POSTs
// the current pathname here on each in-app navigation; we attribute it to the
// signed-in user server-side (the body's email, if any, is ignored). Any
// authenticated user may call it — it only ever records their OWN activity.
//
// A distinct path prefix from /api/usage on purpose: /api/usage is admin-gated
// in-handler, this one must stay open to everyone.

// Keep the request light and resilient to garbage input.
function cleanPath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Only same-origin app paths; strip any query/hash and cap the length.
  const p = raw.split("#")[0].split("?")[0].trim();
  if (!p.startsWith("/") || p.startsWith("//")) return "";
  return p.slice(0, 300);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  // No session (unauthenticated / local-dev-open) → nothing to attribute. 204.
  if (!email) return new NextResponse(null, { status: 204 });

  const body = await req.json().catch(() => ({}));
  const path = cleanPath((body as { path?: unknown }).path);
  if (!path) return new NextResponse(null, { status: 204 });

  await recordView(email, path, viewIdForPath(path) ?? "");
  return new NextResponse(null, { status: 204 });
}
