import { NextRequest, NextResponse } from "next/server";
import { createLine } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

interface Body {
  docId?: string;
  name?: string;
  quantity?: number;
  unitCost?: number;
  jobCostItemId?: string;
  description?: string;
}

/**
 * Add a new line (cost item) to an existing bill via createCostItem.
 * DISABLED BY DEFAULT: unless COMPANION_WRITES_ENABLED=true this writes nothing
 * and returns a preview, matching /api/code.
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
  if (!docId) return NextResponse.json({ error: "docId is required" }, { status: 400 });
  const name = (body.name ?? "").trim() || "Line item";

  if (!writesEnabled()) {
    return NextResponse.json({
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was added to JobTread.",
    });
  }

  try {
    const cfg = getPaveConfig();
    const { id } = await createLine(cfg, docId, {
      name,
      quantity: typeof body.quantity === "number" ? body.quantity : undefined,
      unitCost: typeof body.unitCost === "number" ? body.unitCost : undefined,
      jobCostItemId: body.jobCostItemId || undefined,
      description: body.description,
    });
    return NextResponse.json({ previewed: false, wrote: true, id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
