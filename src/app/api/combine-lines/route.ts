import { NextRequest, NextResponse } from "next/server";
import { combineLines } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

interface Body {
  docId?: string;
  keepId?: string;
  deleteIds?: string[];
  name?: string;
  extendedCost?: number;
  jobCostItemId?: string;
  description?: string;
}

/**
 * Combine several of a bill's lines that share a cost code into one (keeps one
 * cost item, sums the amounts, concatenates the descriptions, deletes the rest).
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
  const docId = (body.docId ?? "").trim();
  const keepId = (body.keepId ?? "").trim();
  const deleteIds = (body.deleteIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (!docId || !keepId || deleteIds.length === 0) {
    return NextResponse.json(
      { error: "docId, keepId, and at least one deleteId are required." },
      { status: 400 },
    );
  }
  if (typeof body.extendedCost !== "number" || !Number.isFinite(body.extendedCost)) {
    return NextResponse.json({ error: "extendedCost (number) is required." }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was combined in JobTread.",
    });
  }

  try {
    const cfg = getPaveConfig();
    const { keptId, deleted } = await combineLines(cfg, {
      docId,
      keepId,
      deleteIds,
      name: body.name ?? "Line item",
      extendedCost: body.extendedCost,
      jobCostItemId: body.jobCostItemId || undefined,
      description: body.description,
    });
    return NextResponse.json({ previewed: false, wrote: true, keptId, deleted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
