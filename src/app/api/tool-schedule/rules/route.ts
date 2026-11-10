import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { toolScheduleUser } from "@/lib/toolScheduleAccess";
import { rangeFromUrl, taskRules } from "@/lib/toolScheduleData";
import { deleteRule, isRuleMatch, upsertRule } from "@/lib/toolScheduleStore";

/**
 * What each schedule task needs: specific tools from the Tools list
 * ("tool:<id>") or any tool of a type ("type:<key>"). JobTread keeps no tool on
 * a task, so the office names them on a phase (covers every task under it), a
 * task name (overrides its phase, on every job), or a task type.
 *
 *   GET    [?months=6]   → { rules, tools, types, groups, phases, taskTypes, unresolved (with suggested targets) }
 *   PUT    { match, key, targets: string[], label? } → { ok }   ([] = needs no tools)
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
    const { plan, tools, types, groups, toolsError, phases, taskTypes, unresolved } = await taskRules(from, to);
    return NextResponse.json({
      from,
      to,
      rules: plan.rules,
      tools,
      types,
      groups,
      ...(toolsError ? { toolsError } : {}),
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
  if (!Array.isArray(body?.targets)) return NextResponse.json({ error: "targets must be a list ([] = needs no tools)." }, { status: 400 });
  const key = String(body?.key ?? "").slice(0, 300);
  try {
    await upsertRule(
      { match: body.match, key, targets: body.targets.map(String).slice(0, 50), label: typeof body?.label === "string" ? body.label.slice(0, 300) : key },
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
