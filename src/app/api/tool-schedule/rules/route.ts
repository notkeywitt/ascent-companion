import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { toolScheduleUser } from "@/lib/toolScheduleAccess";
import { rangeFromUrl, unresolvedTasks } from "@/lib/toolScheduleData";
import { deleteRule, isRuleMatch, upsertRule } from "@/lib/toolScheduleStore";

/**
 * How schedule tasks map to cost codes. JobTread links no task to a code, so
 * the office maps each task NAME once and it applies on every job.
 *
 *   GET    [?months=6]                     → { rules, unresolved (with suggestions), costCodes }
 *   PUT    { match, key, costCodeId|null, label? } → { ok }   (null = needs no tools)
 *   DELETE ?match=&key=                    → { ok }
 *
 * Gated by the "tool-schedule-edit" view (office + admin).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (e: unknown, status = 500) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: Request) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const { from, to } = rangeFromUrl(new URL(req.url));
  try {
    const { unresolved, costCodes, plan } = await unresolvedTasks(from, to);
    return NextResponse.json({ from, to, rules: plan.rules, unresolved, costCodes });
  } catch (e) {
    return fail(e, 502);
  }
}

export async function PUT(req: Request) {
  const u = await toolScheduleUser();
  if (!u.canEdit) return NextResponse.json({ error: "Only the office can map task codes." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!isRuleMatch(body?.match)) return NextResponse.json({ error: "match must be task, name, taskType or phase." }, { status: 400 });
  const key = String(body?.key ?? "").slice(0, 300);
  const costCodeId = body?.costCodeId ? String(body.costCodeId) : null;
  try {
    await upsertRule({ match: body.match, key, costCodeId, label: typeof body?.label === "string" ? body.label.slice(0, 300) : key }, u.email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, 400);
  }
}

export async function DELETE(req: Request) {
  const u = await toolScheduleUser();
  if (!u.canEdit) return NextResponse.json({ error: "Only the office can map task codes." }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const match = q.get("match");
  if (!isRuleMatch(match)) return NextResponse.json({ error: "Pass ?match=&key=" }, { status: 400 });
  try {
    await deleteRule(match, q.get("key") ?? "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
