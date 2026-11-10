import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { isRuleMatch } from "@/lib/toolScheduleStore";
import { rangeFromUrl, shortagesFor } from "@/lib/toolScheduleData";

/**
 * GET /api/tool-schedule/availability?match=&key=&targets=type:a,type:b[&months=6]
 *   → { shortages: [{ kindId, typeName, jobId, jobName, jobLabel, from, to, taskNames, noneOwned }] }
 *
 * After the office names a tool type on a rule: the jobs whose tasks under that
 * rule need one on a day none is free. The editor then asks whether to file a
 * requisition. Read only. Gated by the "tool-schedule-edit" view.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const url = new URL(req.url);
  const match = url.searchParams.get("match");
  const key = url.searchParams.get("key") ?? "";
  const targets = (url.searchParams.get("targets") ?? "").split(",").filter(Boolean).slice(0, 50);
  if (!isRuleMatch(match) || !key) return NextResponse.json({ error: "Pass ?match=&key=&targets=" }, { status: 400 });
  const { from, to } = rangeFromUrl(url);
  try {
    return NextResponse.json({ shortages: await shortagesFor(match, key, targets, from, to) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
