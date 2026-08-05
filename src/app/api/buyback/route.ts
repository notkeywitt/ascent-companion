import { NextRequest, NextResponse } from "next/server";
import { buybackLine, clearJobCostCaches } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

interface Body {
  sourceDocId?: string;
  costItemId?: string;
  name?: string;
  unitCost?: number;
  description?: string;
}

/**
 * Buyback: move one bill line off a client job's bill onto a draft bill on the
 * Ascent - Shop job (created on first use, reused on repeat clicks against the
 * same source bill — see buybackLine's externalId idempotency).
 * DISABLED BY DEFAULT: unless COMPANION_WRITES_ENABLED=true this writes nothing
 * and returns a preview, matching /api/code, /api/add-line, /api/combine-lines.
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
  const sourceDocId = (body.sourceDocId ?? "").trim();
  const costItemId = (body.costItemId ?? "").trim();
  const name = (body.name ?? "").trim() || "Line item";
  if (!sourceDocId || !costItemId) {
    return NextResponse.json(
      { error: "sourceDocId and costItemId are required." },
      { status: 400 },
    );
  }
  if (typeof body.unitCost !== "number" || !Number.isFinite(body.unitCost)) {
    return NextResponse.json({ error: "unitCost (number) is required." }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was moved in JobTread.",
    });
  }

  try {
    const cfg = getPaveConfig();
    const { shopDocId, created } = await buybackLine(cfg, {
      sourceDocId,
      costItemId,
      name,
      unitCost: body.unitCost,
      description: body.description,
    });
    clearJobCostCaches(); // moves a line's cost off one job's actuals and onto Shop's
    return NextResponse.json({ previewed: false, wrote: true, shopDocId, created });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
