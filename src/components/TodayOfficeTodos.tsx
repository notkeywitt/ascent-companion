"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { SectionHeading } from "@/components/ui";
import { OfficeTodos, type OfficeTodo } from "@/app/office/OfficeTodos";

/**
 * The Office job's open to-dos on Today, beside your own (HomeTodos, admin
 * only). Each part keeps its own gate: this one the "office" view, whose
 * /api/office prefix also gates the read. Same list and same edits as the
 * Office dashboard; after a change it re-reads itself.
 */
export function TodayOfficeTodos() {
  const can = useAccess().can("office");
  const [todos, setTodos] = useState<OfficeTodo[] | null>(null);

  const load = useCallback(() => {
    fetch("/api/office/todos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setTodos(Array.isArray(j.todos) ? j.todos : []))
      // A list that cannot be read is simply not shown.
      .catch(() => setTodos(null));
  }, []);

  useEffect(() => {
    if (can) load();
  }, [can, load]);

  if (!can || todos === null) return null;
  return (
    <section className="mb-6 space-y-2">
      <SectionHeading>Office to-dos</SectionHeading>
      <OfficeTodos todos={todos} onChanged={load} />
    </section>
  );
}
