import { NextRequest, NextResponse } from "next/server";

import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { readOfficeTodos } from "@/app/office/readOfficeTodos";
import {
  OFFICE_JOB_ID,
  createToDo,
  deleteToDo,
  getToDoJobId,
  updateToDo,
  type ToDoPatch,
} from "@/lib/jobtread";

/**
 * The Office dashboard's to-do WRITES — create, edit and delete a JobTread
 * to-do on the Office job. The page reads its list server-side; this route only
 * writes, then the page re-renders.
 *
 * SCOPED TO THE OFFICE JOB. A create always files on it, and an edit or delete
 * first reads the to-do and refuses one on any other job, so this route cannot
 * touch the rest of the org's to-dos.
 *
 * POST   { name, description?, dueDate?, membershipIds? } → { ok, wrote, previewed?, id? }
 * PATCH  { id, name?, description?, dueDate?, membershipIds?, done? } → { ok, wrote, previewed? }
 * DELETE ?id=<taskId>                                      → { ok, wrote, previewed? }
 *
 * Every write is behind `writesEnabled()`; with it off the route answers
 * `previewed: true` and sends nothing. Gated by the "office" view
 * (src/lib/views.ts), enforced in middleware.
 */
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

const previewed = () =>
  NextResponse.json({
    ok: true,
    previewed: true,
    wrote: false,
    message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was sent to JobTread.",
  });

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Unknown error");

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Membership ids from an untrusted body, or undefined when absent. */
function idsOf(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  return (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean);
}

/** A refusal when `id` is not a to-do on the Office job, else null. */
async function notOffice(id: string): Promise<NextResponse | null> {
  const jobId = await getToDoJobId(getPaveConfig(), id);
  if (jobId === undefined) return fail("That to-do no longer exists in JobTread.", 404);
  if (jobId !== OFFICE_JOB_ID) return fail("That to-do is not on the Office job.", 403);
  return null;
}

/** GET → { todos } — the Office job's open to-dos, for Today's list. */
export async function GET() {
  if (!hasGrant()) return fail("JT_GRANT_KEY is not set.", 400);
  try {
    return NextResponse.json({ todos: await readOfficeTodos() });
  } catch (e) {
    return fail(errorText(e), 502);
  }
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) return fail("JT_GRANT_KEY is not set.", 400);
  const body = await readBody(req);
  if (!body) return fail("Invalid JSON body", 400);

  const name = String(body.name ?? "").trim();
  if (!name) return fail("Say what needs doing.", 400);
  const dueDate = String(body.dueDate ?? "").trim();
  if (dueDate && !DAY.test(dueDate)) return fail(`Unreadable due date: ${dueDate}`, 400);
  if (!writesEnabled()) return previewed();

  try {
    const { id } = await createToDo(getPaveConfig(), {
      name,
      description: String(body.description ?? "").trim() || undefined,
      dueDate: dueDate || undefined,
      jobId: OFFICE_JOB_ID,
      membershipIds: idsOf(body.membershipIds) ?? [],
    });
    return NextResponse.json({ ok: true, previewed: false, wrote: true, id });
  } catch (e) {
    return fail(errorText(e), 502);
  }
}

export async function PATCH(req: NextRequest) {
  if (!hasGrant()) return fail("JT_GRANT_KEY is not set.", 400);
  const body = await readBody(req);
  if (!body) return fail("Invalid JSON body", 400);
  const id = String(body.id ?? "").trim();
  if (!id) return fail("Which to-do? No id was sent.", 400);

  const patch: ToDoPatch = {};
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.description !== undefined)
    patch.description = body.description === null ? null : String(body.description);
  if (body.dueDate !== undefined) {
    const d = body.dueDate === null ? "" : String(body.dueDate).trim();
    if (d && !DAY.test(d)) return fail(`Unreadable due date: ${d}`, 400);
    patch.dueDate = d || null;
  }
  const ids = idsOf(body.membershipIds);
  if (ids !== undefined) patch.membershipIds = ids;
  if (body.done !== undefined) patch.done = body.done === true;
  if (Object.keys(patch).length === 0) return fail("Nothing to change.", 400);
  if (patch.name !== undefined && !patch.name.trim()) return fail("A to-do needs a name.", 400);
  if (!writesEnabled()) return previewed();

  try {
    const refused = await notOffice(id);
    if (refused) return refused;
    await updateToDo(getPaveConfig(), id, patch);
    return NextResponse.json({ ok: true, previewed: false, wrote: true });
  } catch (e) {
    return fail(errorText(e), 502);
  }
}

export async function DELETE(req: NextRequest) {
  if (!hasGrant()) return fail("JT_GRANT_KEY is not set.", 400);
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return fail("Which to-do? No id was sent.", 400);
  if (!writesEnabled()) return previewed();

  try {
    const refused = await notOffice(id);
    if (refused) return refused;
    await deleteToDo(getPaveConfig(), id);
    return NextResponse.json({ ok: true, previewed: false, wrote: true });
  } catch (e) {
    return fail(errorText(e), 502);
  }
}
