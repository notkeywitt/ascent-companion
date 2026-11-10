import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { toolScheduleUser } from "@/lib/toolScheduleAccess";
import { createKind, deleteKind, getSheetTools, loadPlan, updateKind, type KindPatch } from "@/lib/toolScheduleStore";

/**
 * The tool catalogue: tool types, and which Tools-sheet tools are which type.
 * Companion data only.
 *
 *   GET                          → { kinds, members, uses, tools, toolsError? }
 *                                  (`uses`: how many task rules tick each tool type)
 *   POST   { name }              → { id }
 *   PATCH  { id, name?, notes?, toolIds? } → { ok }
 *   DELETE ?id=                  → { ok }   (also drops its rule ticks, tool tags and bookings)
 *
 * Gated by the "tool-schedule-edit" view (office + admin).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function editor() {
  const u = await toolScheduleUser();
  return u.canEdit ? u : null;
}
const forbidden = () => NextResponse.json({ error: "Only the office can edit the tool catalogue." }, { status: 403 });
const fail = (e: unknown, status = 500) =>
  NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET() {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  try {
    const [plan, tools] = await Promise.all([
      loadPlan(),
      getSheetTools().then(
        (t) => ({ t, error: undefined as string | undefined }),
        (e) => ({ t: [], error: e instanceof Error ? e.message : "Could not read the Tools sheet." }),
      ),
    ]);
    return NextResponse.json({
      kinds: plan.kinds,
      members: plan.members,
      uses: Object.fromEntries(plan.kinds.map((k) => [k.id, plan.rules.filter((r) => r.kindIds.includes(k.id)).length])),
      tools: tools.t,
      ...(tools.error ? { toolsError: tools.error } : {}),
    });
  } catch (e) {
    return fail(e, 502);
  }
}

export async function POST(req: Request) {
  const u = await editor();
  if (!u) return forbidden();
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Give the tool type a name." }, { status: 400 });
  try {
    return NextResponse.json({ id: await createKind(name.slice(0, 80), u.email) });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  const u = await editor();
  if (!u) return forbidden();
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);
  const patch: KindPatch = {
    name: typeof body?.name === "string" ? body.name.slice(0, 80) : undefined,
    notes: typeof body?.notes === "string" ? body.notes.slice(0, 500) : undefined,
    toolIds: strs(body?.toolIds),
  };
  try {
    const ok = await updateKind(id, patch, u.email);
    return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: "No such tool type." }, { status: 404 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const u = await editor();
  if (!u) return forbidden();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Pass ?id=" }, { status: 400 });
  try {
    await deleteKind(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
