import { NextRequest, NextResponse } from "next/server";
import { clearJobCostCaches, deleteLine } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

interface Body {
  docId?: string;
  costItemId?: string;
}

/**
 * Delete a single line (cost item) from a bill via deleteCostItem.
 * DISABLED BY DEFAULT: unless COMPANION_WRITES_ENABLED=true this writes nothing
 * and returns a preview, matching /api/code and /api/add-line.
 */
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const costItemId = (body.costItemId ?? "").trim();
  if (!costItemId) {
    return NextResponse.json({ error: "costItemId is required." }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was deleted in JobTread.",
    });
  }

  try {
    const cfg = getPaveConfig();
    await deleteLine(cfg, costItemId);
    clearJobCostCaches(); // removing a line changes the job's actuals per cost code
    return NextResponse.json({ previewed: false, wrote: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
