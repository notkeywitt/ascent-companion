import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { toolScheduleUser } from "@/lib/toolScheduleAccess";
import { rangeFromUrl, taskRules } from "@/lib/toolScheduleData";
import { deleteRule, isRuleMatch, upsertRule } from "@/lib/toolScheduleStore";

/**
 * Which tool types each schedule task needs. JobTread keeps no tool on a task,
 * so the office ticks tools on a phase (covers every task under it), a task
 * name (overrides its phase, on every job), or a task type.
 *
 *   GET    [?months=6]   → { rules, kinds, phases, taskTypes, unresolved (with suggested tool ids) }
 *   PUT    { match, key, kindIds: string[], label? } → { ok }   ([] = needs no tools)
 *   DELETE ?match=&key=  → { ok }
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
    const { plan, phases, taskTypes, unresolved } = await taskRules(from, to);
    return NextResponse.json({
      from,
      to,
      rules: plan.rules,
      kinds: plan.kinds.map((k) => ({ id: k.id, name: k.name })),
      phases,
      taskTypes,
      unresolved,
    });
  } catch (e) {
    return fail(e, 502);
  }
}

export async function PUT(req: Request) {
  const u = await toolScheduleUser();
  if (!u.canEdit) return NextResponse.json({ error: "Only the office can set which tools a task needs." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!isRuleMatch(body?.match)) return NextResponse.json({ error: "match must be task, name, taskType or phase." }, { status: 400 });
  if (!Array.isArray(body?.kindIds)) return NextResponse.json({ error: "kindIds must be a list ([] = needs no tools)." }, { status: 400 });
  const key = String(body?.key ?? "").slice(0, 300);
  try {
    await upsertRule(
      { match: body.match, key, kindIds: body.kindIds.map(String), label: typeof body?.label === "string" ? body.label.slice(0, 300) : key },
      u.email,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, 400);
  }
}

export async function DELETE(req: Request) {
  const u = await toolScheduleUser();
  if (!u.canEdit) return NextResponse.json({ error: "Only the office can set which tools a task needs." }, { status: 403 });
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
