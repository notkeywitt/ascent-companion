import type { OpenToDo } from "@/lib/jobtread";

/**
 * Home's ONE to-do list: the reader's own JobTread to-dos, the Office job's,
 * and the unclaimed ones, merged (it replaced three cards on 2026-11-13).
 *
 * Sorted by URGENCY, then IMPORTANCE:
 *   urgency    — overdue, due today, due within a week, later, no date
 *   importance — mine, then the Office job's, then nobody's
 * Somebody else's to-do on any other job appears only with `includeOthers`. Pure, so the order is
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
  kind: "mine" | "office" | "unclaimed" | "other";
  assignees: string[];
  description: string;
}

const IMPORTANCE = { mine: 0, office: 1, unclaimed: 2, other: 3 } as const;

/** The card's per-user settings (kept in localStorage by TodosWidget). */
export interface TodoPrefs {
  sort: "urgency" | "due" | "name" | "job";
  group: "none" | "kind" | "job";
  kinds: HomeTodo["kind"][];
  /** "any" or the most days ahead a dated to-do may be due; overdue always passes. */
  within: "any" | "0" | "7" | "30";
  hideUndated: boolean;
}

export const DEFAULT_PREFS: TodoPrefs = {
  sort: "urgency",
  group: "none",
  kinds: ["mine", "office", "unclaimed"],
  within: "any",
  hideUndated: false,
};

/** Anything stored -> valid prefs; a bad field falls back to its default. */
export function normalizePrefs(raw: unknown): TodoPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
  const kinds = Array.isArray(r.kinds)
    ? (r.kinds.filter((k) => k in IMPORTANCE) as HomeTodo["kind"][])
    : DEFAULT_PREFS.kinds;
  return {
    sort: pick(r.sort, ["urgency", "due", "name", "job"], "urgency"),
    group: pick(r.group, ["none", "kind", "job"], "none"),
    kinds,
    within: pick(r.within, ["any", "0", "7", "30"], "any"),
    hideUndated: r.hideUndated === true,
  };
}

/** Filter, sort and group the ranked list (already urgency-sorted). Pure. */
export function applyTodoPrefs(todos: HomeTodo[], p: TodoPrefs, today: string): { label: string; todos: HomeTodo[] }[] {
  const limit = p.within === "any" ? null : Date.parse(`${today}T00:00:00Z`) + Number(p.within) * 86_400_000;
  let list = todos.filter(
    (t) =>
      p.kinds.includes(t.kind) &&
      !(p.hideUndated && !t.due) &&
      (limit === null || !t.due || t.overdue || Date.parse(`${t.due}T00:00:00Z`) <= limit),
  );
  if (p.sort === "due") list = [...list].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  else if (p.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  else if (p.sort === "job") list = [...list].sort((a, b) => (a.jobName ?? "\uffff").localeCompare(b.jobName ?? "\uffff"));
  if (p.group === "none") return [{ label: "", todos: list }];
  const key = (t: HomeTodo) => (p.group === "job" ? (t.jobName ?? "No job") : t.kind);
  const groups = new Map<string, HomeTodo[]>();
  for (const t of list) groups.set(key(t), [...(groups.get(key(t)) ?? []), t]);
  return [...groups].map(([label, todos]) => ({ label, todos }));
}

function urgency(due: string | null, today: string): number {
  if (!due) return 4;
  if (due < today) return 0;
  if (due === today) return 1;
  const days = (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days <= 7 ? 2 : 3;
}

export function rankTodos(open: OpenToDo[], myUserId: string, officeJobId: string, today: string, includeOthers = false): HomeTodo[] {
  const out: (HomeTodo & { u: number })[] = [];
  for (const t of open) {
    const kind = myUserId && t.assigneeIds.includes(myUserId)
      ? "mine"
      : t.jobId === officeJobId
        ? "office"
        : t.assignees.length === 0
          ? "unclaimed"
          : includeOthers
            ? "other"
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
      description: t.description ?? "",
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
