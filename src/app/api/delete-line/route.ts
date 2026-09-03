import { NextRequest, NextResponse } from "next/server";
import { clearJobCostCaches, deleteLine, getLineJournalSnapshot } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { openJournal } from "@/lib/financialJournal";

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

  // The line is read BEFORE it is deleted, because afterwards nothing anywhere
  // says what it held. This snapshot is the whole reason a deleted charge is
  // now recoverable: amount, cost code, and the bill it was on.
  const cfg = getPaveConfig();
  const j = await openJournal("/api/delete-line");
  const prior = await getLineJournalSnapshot(cfg, costItemId);
  const event = {
    action: "line.delete",
    entity: "line",
    entityId: costItemId,
    docId: prior?.docId || (body.docId ?? "").trim(),
    jobId: prior?.jobId ?? "",
    // A delete has no field: the whole record is the change, so `before` carries
    // the line and `after` is empty.
    before: prior ?? undefined,
    beforeSource: (prior ? "read" : "none") as "read" | "none",
    amount: prior?.cost ?? null,
  };
  try {
    await deleteLine(cfg, costItemId);
    clearJobCostCaches(); // removing a line changes the job's actuals per cost code
    await j.record([event]);
    return NextResponse.json({ previewed: false, wrote: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await j.record([{ ...event, outcome: "error", error: message }]);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
