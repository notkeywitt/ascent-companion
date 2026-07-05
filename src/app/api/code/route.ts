import { NextRequest, NextResponse } from "next/server";
import { setLineCoding } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

interface Change {
  costItemId: string;
  jobCostItemId: string;
}

/**
 * Phase B — save line coding to JobTread.
 * DISABLED BY DEFAULT: unless COMPANION_WRITES_ENABLED=true, this writes nothing
 * and returns a preview of what *would* change, so the flow is testable safely.
 */
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { changes?: Change[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const changes = (body.changes ?? []).filter((c) => c.costItemId && c.jobCostItemId);
  if (changes.length === 0) {
    return NextResponse.json({ error: "No coding changes provided" }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was sent to JobTread.",
      changes,
    });
  }

  const cfg = getPaveConfig();
  const results: { costItemId: string; ok: boolean; error?: string }[] = [];
  for (const c of changes) {
    try {
      await setLineCoding(cfg, c.costItemId, c.jobCostItemId);
      results.push({ costItemId: c.costItemId, ok: true });
    } catch (e) {
      results.push({
        costItemId: c.costItemId,
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }
  return NextResponse.json({ previewed: false, wrote: true, results });
}
