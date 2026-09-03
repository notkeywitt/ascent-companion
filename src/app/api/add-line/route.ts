import { NextRequest, NextResponse } from "next/server";
import { clearJobCostCaches, createLine } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { openJournal } from "@/lib/financialJournal";

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

  const cfg = getPaveConfig();
  const j = await openJournal("/api/add-line");
  const line = {
    name,
    quantity: typeof body.quantity === "number" ? body.quantity : undefined,
    unitCost: typeof body.unitCost === "number" ? body.unitCost : undefined,
    jobCostItemId: body.jobCostItemId || undefined,
    description: body.description,
  };
  // A create has no prior value by definition, so `beforeSource` is "none" and
  // `after` carries the whole line rather than one field.
  const extended =
    typeof line.quantity === "number" && typeof line.unitCost === "number"
      ? Math.round(line.quantity * line.unitCost * 100) / 100
      : (line.unitCost ?? null);
  try {
    const { id } = await createLine(cfg, docId, line);
    clearJobCostCaches(); // a new line changes the job's actuals per cost code
    await j.record([
      {
        action: "line.create",
        entity: "line",
        entityId: id,
        docId,
        after: line,
        beforeSource: "none",
        amount: extended,
      },
    ]);
    return NextResponse.json({ previewed: false, wrote: true, id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await j.record([
      {
        action: "line.create",
        entity: "line",
        docId,
        after: line,
        beforeSource: "none",
        amount: extended,
        outcome: "error",
        error: message,
      },
    ]);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
