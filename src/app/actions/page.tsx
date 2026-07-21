"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, Card, Loading, PageHeader, SectionLabel, Spinner } from "@/components/ui";

// The Actions page renders one button per script job, driven entirely by the
// Apps Script COMPANION_TASKS registry (GET /api/actions). To add a button, add
// an entry to that registry — nothing here changes.
interface Task {
  key: string;
  label: string;
  group: string;
  description?: string;
  lock?: boolean;
}

type RunState = {
  status: "idle" | "busy" | "done" | "error";
  note?: string;
  lockBusy?: boolean;
};

export default function ActionsPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [runs, setRuns] = useState<Record<string, RunState>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/actions");
        const j = await res.json();
        if (!res.ok || j.ok === false) setLoadError(j.error ?? `HTTP ${res.status}`);
        else setTasks(j.tasks ?? []);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Network error");
      }
    })();
  }, []);

  // Group in registry order; preserve first-seen group order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Task[]>();
    (tasks ?? []).forEach((t) => {
      if (!map.has(t.group)) {
        map.set(t.group, []);
        order.push(t.group);
      }
      map.get(t.group)!.push(t);
    });
    return order.map((g) => ({ group: g, tasks: map.get(g)! }));
  }, [tasks]);

  async function run(task: Task) {
    setRuns((r) => ({ ...r, [task.key]: { status: "busy" } }));
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: task.key }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) {
        setRuns((r) => ({ ...r, [task.key]: { status: "error", note: j.error ?? `HTTP ${res.status}` } }));
      } else if (j.lockBusy) {
        setRuns((r) => ({
          ...r,
          [task.key]: { status: "done", lockBusy: true, note: j.note ?? "Lock busy — nothing ran." },
        }));
      } else {
        setRuns((r) => ({ ...r, [task.key]: { status: "done", note: j.note ?? "Done." } }));
      }
    } catch (e) {
      setRuns((r) => ({
        ...r,
        [task.key]: { status: "error", note: e instanceof Error ? e.message : "Network error" },
      }));
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Actions"
        description="Run a script job on demand. Each runs immediately in Apps Script; the outcome also lands in Logs."
      />

      {loadError && <Banner tone="error">{loadError}</Banner>}
      {!tasks && !loadError && <Loading label="Loading actions…" />}

      {groups.map(({ group, tasks: groupTasks }) => (
        <section key={group} className="mb-6">
          <SectionLabel className="mb-2">{group}</SectionLabel>
          <div className="space-y-2">
            {groupTasks.map((t) => {
              const st: RunState = runs[t.key] ?? { status: "idle" };
              return (
                <Card key={t.key} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{t.label}</div>
                    {t.description && (
                      <div className="mt-0.5 text-xs text-neutral-500">{t.description}</div>
                    )}
                    {st.note && (
                      <div
                        className={
                          "mt-1 text-xs " +
                          (st.status === "error"
                            ? "text-red-600 dark:text-red-400"
                            : st.lockBusy
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400")
                        }
                      >
                        {st.note}
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={() => run(t)}
                    disabled={st.status === "busy"}
                    variant={st.status === "error" ? "danger" : "primary"}
                    size="sm"
                    className="shrink-0"
                  >
                    {st.status === "busy" ? (
                      <>
                        <Spinner className="border-white/40 border-t-white" /> Running…
                      </>
                    ) : st.status === "done" ? (
                      "Run again"
                    ) : st.status === "error" ? (
                      "Retry"
                    ) : (
                      "Run"
                    )}
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
