import { NextRequest, NextResponse } from "next/server";

import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { bustTaskCaches, getTaskForEdit, updateToDo } from "@/lib/jobtread";
import { itemEditPatch } from "@/lib/weekActivity";

/**
 * PATCH /api/home/week/task — the This Week widget's one edit route (owner
 * approved 2026-11-15). Edits one schedule task or to-do on any OPEN job in
 * this org.
 *
 * { id, kind: "task" | "todo", name?, description?, start?, end?, done? }
 *   → { ok, wrote, previewed? }
 *
 * Writes only `updateTask` name, description, startDate, endDate and progress
 * (`itemEditPatch`, src/lib/weekActivity.ts). It never deletes a task. It reads
 * the task first and refuses a group row, a task in another org, a task with
 * no job or on a closed job, and a kind that does not match.
 *
 * Behind `writesEnabled()`; with it off the route answers `previewed: true`
 * and sends nothing. Gated by the `home` view (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function PATCH(req: NextRequest) {
  if (!hasGrant()) return fail("JT_GRANT_KEY is not set.", 400);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return fail("Invalid JSON body", 400);
  const id = String(body.id ?? "").trim();
  if (!id) return fail("Which task? No id was sent.", 400);
  const kind = body.kind === "todo" ? "todo" : body.kind === "task" ? "task" : null;
  if (!kind) return fail("Say whether it is a task or a to-do.", 400);
  const patch = itemEditPatch(kind, body);
  if (typeof patch === "string") return fail(patch, 400);
  if (!writesEnabled()) {
    return NextResponse.json({
      ok: true,
      previewed: true,
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was sent to JobTread.",
    });
  }

  try {
    const cfg = getPaveConfig();
    const t = await getTaskForEdit(cfg, id);
    if (!t) return fail("That task no longer exists in JobTread.", 404);
    if (t.orgId !== cfg.orgId) return fail("That task is not in this organization.", 403);
    if (t.isGroup) return fail("That is a schedule phase. Edit it in JobTread.", 403);
    if (t.isToDo !== (kind === "todo"))
      return fail(`That id is not a ${kind === "todo" ? "to-do" : "schedule task"}.`, 400);
    if (!t.jobOpen) return fail("That task is not on an open job.", 403);
    await updateToDo(cfg, id, patch);
    bustTaskCaches(cfg);
    return NextResponse.json({ ok: true, previewed: false, wrote: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Unknown error", 502);
  }
}
