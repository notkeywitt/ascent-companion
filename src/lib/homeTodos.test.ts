import { describe, expect, it } from "vitest";

import type { OpenToDo } from "@/lib/jobtread";
import { DEFAULT_PREFS, applyTodoPrefs, rankTodos } from "./homeTodos";

const t = (id: string, o: Partial<OpenToDo>): OpenToDo => ({ id, name: id, assignees: [], assigneeIds: [], ...o });

describe("rankTodos", () => {
  const today = "2026-11-13";
  const open = [
    t("other", { assignees: ["Ty"], assigneeIds: ["u2"], endDate: "2026-11-01", jobId: "j1" }),
    t("mine-later", { assignees: ["Me"], assigneeIds: ["u1"], endDate: "2026-12-30" }),
    t("unclaimed-overdue", { endDate: "2026-11-10", jobId: "j1" }),
    t("office-today", { assignees: ["Ty"], assigneeIds: ["u2"], endDate: today, jobId: "OFF" }),
    t("mine-today", { assignees: ["Me"], assigneeIds: ["u1"], endDate: today }),
    t("mine-undated", { assignees: ["Me"], assigneeIds: ["u1"] }),
    t("mine-overdue", { assignees: ["Me"], assigneeIds: ["u1"], endDate: "2026-11-12" }),
  ];

  it("sorts by urgency, then mine, office, unclaimed; drops other people's", () => {
    expect(rankTodos(open, "u1", "OFF", today).map((x) => x.id)).toEqual([
      "mine-overdue",
      "unclaimed-overdue",
      "mine-today",
      "office-today",
      "mine-later",
      "mine-undated",
    ]);
  });

  it("an unlinked reader still sees the office and unclaimed ones", () => {
    expect(rankTodos(open, "", "OFF", today).map((x) => x.kind)).toEqual(["unclaimed", "office"]);
  });
});

describe("includeOthers", () => {
  it("adds other people's to-dos last in their urgency band", () => {
    const k = rankTodos(
      [t("o", { assignees: ["Ty"], assigneeIds: ["u2"], endDate: "2026-11-01", jobId: "j1" })],
      "u1",
      "OFF",
      "2026-11-13",
      true,
    );
    expect(k[0].kind).toBe("other");
  });
});

describe("applyTodoPrefs", () => {
  const today = "2026-11-13";
  const todos = rankTodos(
    [
      t("a", { assignees: ["Me"], assigneeIds: ["u1"], endDate: "2026-11-10", jobId: "j", jobName: "Z" }),
      t("b", { assignees: ["Me"], assigneeIds: ["u1"], endDate: "2026-12-30", jobName: "A" }),
      t("c", { assignees: ["Me"], assigneeIds: ["u1"] }),
    ],
    "u1",
    "OFF",
    today,
  );
  it("filters by window and undated, keeps overdue", () => {
    const out = applyTodoPrefs(todos, { ...DEFAULT_PREFS, within: "7", hideUndated: true }, today);
    expect(out[0].todos.map((x) => x.id)).toEqual(["a"]);
  });
  it("sorts by job and groups", () => {
    const out = applyTodoPrefs(todos, { ...DEFAULT_PREFS, sort: "job", group: "job" }, today);
    expect(out.map((g) => g.label)).toEqual(["A", "Z", "No job"]);
  });
});
