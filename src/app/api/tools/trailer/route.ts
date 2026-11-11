import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { callAppsScript } from "@/lib/appsScript";
import { mirrorToolWrite } from "@/lib/sheetTables";
import { isTrailerType } from "@/lib/toolSchedule";
import { getSheetTools, setToolTrailer, trailerLoads } from "@/lib/toolScheduleStore";

/**
 * Which tools ride in which trailer (a Tools-list tool of a trailer type —
 * `isTrailerType`). The load is companion data (`tool_trailer_items`); a tool
 * put in a trailer also takes the trailer's Location in the Tools sheet, and
 * from then on moves with it (`lib/toolTrailers.ts`).
 *
 *   GET                       → { loads: { [toolId]: trailerId } }
 *   PUT { toolId, trailerId } → { ok, moved }   (trailerId "" takes it out)
 *
 * Gated by the "tools" view, like the Tools page that calls it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json({ loads: await trailerLoads() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const toolId = String(body?.toolId ?? "").trim();
  const trailerId = String(body?.trailerId ?? "").trim();
  if (!toolId) return NextResponse.json({ error: "Pass toolId." }, { status: 400 });
  const session = await auth();
  const email = session?.user?.email ?? "";
  try {
    if (!trailerId) {
      await setToolTrailer(toolId, "", email);
      return NextResponse.json({ ok: true, moved: false });
    }
    const tools = await getSheetTools();
    const trailer = tools.find((t) => t.id === trailerId);
    if (!trailer || !isTrailerType(trailer.type)) return NextResponse.json({ error: "That tool is not a trailer." }, { status: 400 });
    if (trailerId === toolId) return NextResponse.json({ error: "A trailer cannot ride in itself." }, { status: 400 });
    if (isTrailerType(tools.find((t) => t.id === toolId)?.type ?? "")) return NextResponse.json({ error: "A trailer cannot ride in another trailer." }, { status: 400 });
    await setToolTrailer(toolId, trailerId, email);
    // It is where the trailer is now.
    let moved = false;
    if (trailer.location) {
      const r = await callAppsScript({ action: "updateToolLocation", toolId, projectId: trailer.location, lastScanEmail: email }, { timeoutMs: 30_000 });
      moved = !r.error;
      if (moved) {
        revalidateTag("tools");
        await mirrorToolWrite(r.data); // Stage 7 copy; off by default
      }
    }
    return NextResponse.json({ ok: true, moved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
