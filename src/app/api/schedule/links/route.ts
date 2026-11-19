import { NextRequest, NextResponse } from "next/server";

import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { openJournal } from "@/lib/financialJournal";
import {
  TASK_DOC_TYPES,
  bustTaskCaches,
  getDocumentForLink,
  getJobDocumentsToLink,
  getTaskForEdit,
  getTaskLinkedDocuments,
  onlyTaskChanged,
  setDocumentTask,
} from "@/lib/jobtread";

/**
 * The Schedule page's bills and estimates on tasks (docs/plans/SCHEDULE_PLAN.md
 * stage 4). JobTread's own link: `document.task`.
 *
 *   GET  /api/schedule/links                → { links: { [taskId]: TaskDocument[] } }
 *   GET  /api/schedule/links?jobId=<id>     → { documents: TaskDocument[] } on that job with no task
 *   POST /api/schedule/links { documentId, taskId | null }
 *        → { ok, wrote, previewed? }   puts the document on the task, or off it (null)
 *
 * THE write: `updateDocument { taskId }`, nothing else. Before it, the route
 * reads the document and the task and refuses unless: same org, the task is a
 * schedule task (not a to-do or a phase row) on an open job, the document is a
 * bill, estimate, vendor order or bid request on THAT job, and it is not
 * voided. After it, the route reads the document back; if its status, cost,
 * price or externalId moved, it puts the old task back and answers with an
 * error. Every change goes in the financial journal.
 *
 * Behind `writesEnabled()`; with it off the route sends nothing and answers
 * `previewed: true`. Gated by the `schedule-links` view (src/lib/views.ts).
 */
export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function GET(req: NextRequest) {
  if (!hasGrant()) return fail("JT_GRANT_KEY is not set.", 400);
  try {
    const cfg = getPaveConfig();
    const jobId = (req.nextUrl.searchParams.get("jobId") ?? "").trim();
    if (jobId) {
      return NextResponse.json({ documents: await getJobDocumentsToLink(cfg, jobId) });
    }
    const links: Record<string, Awaited<ReturnType<typeof getTaskLinkedDocuments>>> = {};
    for (const d of await getTaskLinkedDocuments(cfg)) (links[d.taskId] ??= []).push(d);
    return NextResponse.json({ links });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Unknown error", 502);
  }
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) return fail("JT_GRANT_KEY is not set.", 400);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return fail("Invalid JSON body", 400);
  const documentId = String(body.documentId ?? "").trim();
  if (!documentId) return fail("Which document? No id was sent.", 400);
  const taskId = body.taskId === null ? null : String(body.taskId ?? "").trim();
  if (taskId === "") return fail("Which task? Send a task id, or null to take it off.", 400);

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
    const doc = await getDocumentForLink(cfg, documentId);
    if (!doc) return fail("That document no longer exists in JobTread.", 404);
    if (doc.orgId !== cfg.orgId) return fail("That document is not in this organization.", 403);
    if (!(TASK_DOC_TYPES as readonly string[]).includes(doc.type)) {
      return fail("Only a bill, estimate, vendor order or bid request can go on a task.", 400);
    }
    if (doc.status === "denied") return fail("That document is voided.", 400);
    if (doc.taskId === (taskId ?? "")) return NextResponse.json({ ok: true, previewed: false, wrote: false });

    if (taskId) {
      const t = await getTaskForEdit(cfg, taskId);
      if (!t) return fail("That task no longer exists in JobTread.", 404);
      if (t.orgId !== cfg.orgId) return fail("That task is not in this organization.", 403);
      if (t.isGroup || t.isToDo) return fail("A document goes on a schedule task, not a phase or a to-do.", 400);
      if (!t.jobOpen) return fail("That task is not on an open job.", 403);
      if (t.jobId !== doc.jobId) return fail("The document and the task are on different jobs.", 400);
    }

    const journal = await openJournal("/api/schedule/links");
    const event = {
      action: "document.task.set",
      entity: "document",
      entityId: doc.id,
      docId: doc.id,
      jobId: doc.jobId,
      field: "task",
      before: doc.taskId,
      after: taskId ?? "",
      beforeSource: "read" as const,
    };

    try {
      await setDocumentTask(cfg, doc.id, taskId);
      const after = await getDocumentForLink(cfg, doc.id);
      if (!after || after.taskId !== (taskId ?? "")) {
        await journal.record([{ ...event, outcome: "error", error: "JobTread did not keep the task." }]);
        return fail("JobTread did not keep the change. Check the document in JobTread.", 502);
      }
      if (!onlyTaskChanged(doc, after)) {
        // Something besides the task moved. Put the old task back and say so.
        await setDocumentTask(cfg, doc.id, doc.taskId || null).catch(() => {});
        await journal.record([
          { ...event, outcome: "error", error: "Status, cost or price moved; the task was put back." },
        ]);
        return fail("That change moved the document's status or amount, so it was undone.", 409);
      }
      await journal.record([{ ...event, outcome: "ok" }]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      await journal.record([{ ...event, outcome: "error", error: message }]);
      return fail(message, 502);
    }
    bustTaskCaches(cfg);
    return NextResponse.json({ ok: true, previewed: false, wrote: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Unknown error", 502);
  }
}
