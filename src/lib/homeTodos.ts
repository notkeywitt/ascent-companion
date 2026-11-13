import type { OpenToDo } from "@/lib/jobtread";

/**
 * Home's ONE to-do list: the reader's own JobTread to-dos, the Office job's,
 * and the unclaimed ones, merged (it replaced three cards on 2026-11-13).
 *
 * Sorted by URGENCY, then IMPORTANCE:
 *   urgency    — overdue, due today, due within a week, later, no date
 *   importance — mine, then the Office job's, then nobody's
 * Somebody else's to-do on any other job never appears. Pure, so the order is
 * tested (homeTodos.test.ts) without JobTread.
 */

export interface HomeTodo {
  id: string;
  name: string;
  due: string | null;
  overdue: boolean;
  jobId: string | null;
  jobName: string | null;
  /** "mine" | "office" | "unclaimed" — why it is on the list. */
  kind: "mine" | "office" | "unclaimed";
  assignees: string[];
}

const IMPORTANCE = { mine: 0, office: 1, unclaimed: 2 } as const;

function urgency(due: string | null, today: string): number {
  if (!due) return 4;
  if (due < today) return 0;
  if (due === today) return 1;
  const days = (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days <= 7 ? 2 : 3;
}

export function rankTodos(open: OpenToDo[], myUserId: string, officeJobId: string, today: string): HomeTodo[] {
  const out: (HomeTodo & { u: number })[] = [];
  for (const t of open) {
    const kind = myUserId && t.assigneeIds.includes(myUserId)
      ? "mine"
      : t.jobId === officeJobId
        ? "office"
        : t.assignees.length === 0
          ? "unclaimed"
          : null;
    if (!kind) continue;
    const due = t.endDate || t.startDate || null;
    out.push({
      id: t.id,
      name: t.name,
      due,
      overdue: Boolean(due && due < today),
      jobId: t.jobId ?? null,
      jobName: t.jobName ?? null,
      kind,
      assignees: t.assignees,
      u: urgency(due, today),
    });
  }
  out.sort(
    (a, b) =>
      a.u - b.u ||
      IMPORTANCE[a.kind] - IMPORTANCE[b.kind] ||
      (a.due ?? "").localeCompare(b.due ?? "") ||
      a.name.localeCompare(b.name),
  );
  return out.map(({ u: _u, ...t }) => t);
}
