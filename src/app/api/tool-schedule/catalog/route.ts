import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { toolScheduleUser } from "@/lib/toolScheduleAccess";
import { loadCatalog } from "@/lib/toolScheduleData";
import { addType, deleteType } from "@/lib/toolScheduleStore";

/**
 * The tool catalogue: the Tools list itself — every tool, typed by its
 * ToolType — plus tool types the office added because the list has none.
 * A tool's name, type and condition are edited on the Tools page
 * (`/api/tools`); this route only adds and removes the hand-added types.
 *
 *   GET                    → { tools, types, groups, toolsError? }
 *   POST   { name }        → { id }      (add a type the Tools list has none of)
 *   DELETE ?rowId=         → { ok }      (remove an added type; rules naming it keep it)
 *
 * Gated by the "tool-schedule-edit" view (office + admin).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const forbidden = () => NextResponse.json({ error: "Only the office can edit the tool catalogue." }, { status: 403 });
const fail = (e: unknown, status = 500) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET() {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  try {
    const { tools, types, groups, toolsError } = await loadCatalog();
    return NextResponse.json({ tools, types, groups, ...(toolsError ? { toolsError } : {}) });
  } catch (e) {
    return fail(e, 502);
  }
}

export async function POST(req: Request) {
  const u = await toolScheduleUser();
  if (!u.canEdit) return forbidden();
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Give the tool type a name." }, { status: 400 });
  try {
    return NextResponse.json({ id: await addType(name.slice(0, 80), u.email) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const u = await toolScheduleUser();
  if (!u.canEdit) return forbidden();
  const rowId = new URL(req.url).searchParams.get("rowId") ?? "";
  if (!rowId) return NextResponse.json({ error: "Pass ?rowId=" }, { status: 400 });
  try {
    await deleteType(rowId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
