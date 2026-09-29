import { getPaveConfig } from "@/lib/config";
import { OFFICE_JOB_ID, getOpenToDos } from "@/lib/jobtread";
import { orgDay } from "@/lib/orgTime";
import type { OfficeTodo } from "./OfficeTodos";

/**
 * The Office job's open to-dos, as the to-do list draws them: overdue and
 * soonest first, undated last. Server-only. Read by the Office dashboard and by
 * GET /api/office/todos (which Today reads).
 */
export async function readOfficeTodos(): Promise<OfficeTodo[]> {
  const todos = (await getOpenToDos(getPaveConfig())).filter((t) => t.jobId === OFFICE_JOB_ID);
  const today = orgDay(new Date().toISOString());
  return todos
    .map((t) => {
      const due = t.endDate || t.startDate || "";
      return {
        id: t.id,
        name: t.name,
        description: t.description ?? "",
        due,
        overdue: Boolean(due && due < today),
        assignees: t.assignees,
        assigneeIds: t.assigneeIds,
      };
    })
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.name.localeCompare(b.name));
}
