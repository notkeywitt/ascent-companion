import { describe, expect, it } from "vitest";

import type { OpenToDo } from "@/lib/jobtread";
import { rankTodos } from "./homeTodos";

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
