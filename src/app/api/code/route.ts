import { NextRequest, NextResponse } from "next/server";
import { updateLine } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

interface Change {
  costItemId: string;
  jobCostItemId?: string;
  quantity?: number;
  unitCost?: number;
}

const hasEdit = (c: Change) =>
  c.costItemId &&
  (c.jobCostItemId !== undefined || c.quantity !== undefined || c.unitCost !== undefined);

/**
 * Phase B — save bill-line edits (coding / quantity / unitCost) to JobTread.
 * DISABLED BY DEFAULT: unless COMPANION_WRITES_ENABLED=true, this writes nothing
 * and returns a preview of what *would* change.
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
  const changes = (body.changes ?? []).filter(hasEdit);
  if (changes.length === 0) {
    return NextResponse.json({ error: "No line edits provided" }, { status: 400 });
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
      await updateLine(cfg, c.costItemId, {
        jobCostItemId: c.jobCostItemId,
        quantity: c.quantity,
        unitCost: c.unitCost,
      });
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
