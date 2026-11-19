"use client";

import { useEffect, useState } from "react";

import { useAccess } from "@/components/AccessProvider";
import { toast } from "@/components/Toast";
import { Banner, Button, Dialog } from "@/components/ui";
import { ScheduleView } from "./ScheduleView";

/**
 * "Link to Task" on a bill (docs/plans/SCHEDULE_PLAN.md stage 4). The button
 * opens the bill's job schedule at full size; a tap on a task bar puts the bill
 * on that task (JobTread's own `document.task`, POST /api/schedule/links). When
 * the bill is already on a task the button names it, the popup outlines it, and
 * "Remove link" takes the bill off. Shown only to a role with `schedule-links`.
 */
export function BillTaskLink({
  docId,
  jobId,
  voided = false,
  className = "",
}: {
  docId: string;
  jobId: string;
  /** A voided bill goes on no task. */
  voided?: boolean;
  className?: string;
}) {
  const allowed = useAccess().can("schedule-links") && !voided && !!docId && !!jobId;
  // undefined = still reading; null = on no task.
  const [task, setTask] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!allowed) return;
    setTask(undefined);
    const stop = new AbortController();
    fetch(`/api/schedule/links?documentId=${encodeURIComponent(docId)}`, { signal: stop.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => setTask(ok ? (j.task ?? null) : null))
      .catch(() => {});
    return () => stop.abort();
  }, [allowed, docId]);

  if (!allowed) return null;

  async function write(to: { id: string; name: string } | null) {
    setBusy(true);
    setError("");
    const r = await fetch("/api/schedule/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: docId, taskId: to ? to.id : null }),
    }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; previewed?: boolean; error?: string } | null;
    setBusy(false);
    if (!r?.ok || !j?.ok) return setError(j?.error ?? "Could not save to JobTread.");
    if (j.previewed) {
      toast("Writes are off. Nothing was saved.");
      return setOpen(false);
    }
    setTask(to);
    toast(to ? `Linked to ${to.name}` : "Link removed");
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        title={task ? "This bill is on a schedule task. Change it." : "Put this bill on a task in the job's schedule"}
        className={`inline-flex min-h-9 max-w-full items-center rounded-full border border-line bg-white px-3 text-xs font-semibold text-neutral-700 transition hover:border-accent dark:bg-ink-raised dark:text-neutral-200 ${className}`}
      >
        <span className="truncate">{task ? `Task: ${task.name}` : "Link to Task"}</span>
      </button>

      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          busy={busy}
          size="xl"
          title="Link to Task"
          description={
            task
              ? `This bill is on “${task.name}”. Tap another task to move it.`
              : "Tap a task to put this bill on it."
          }
          className="h-[94dvh] sm:h-[94dvh] sm:w-[96vw] sm:!max-w-none"
          footer={
            <>
              {task && (
                <Button variant="secondary" disabled={busy} onClick={() => void write(null)}>
                  Remove link
                </Button>
              )}
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                Close
              </Button>
            </>
          }
        >
          {error && <Banner tone="error">{error}</Banner>}
          <ScheduleView
            jobId={jobId}
            initialMode="12w"
            highlightTaskId={task?.id}
            onPick={({ bar }) => {
              if (busy) return;
              if (bar.task.id === task?.id) return setOpen(false);
              void write({ id: bar.task.id, name: bar.task.name });
            }}
          />
        </Dialog>
      )}
    </>
  );
}
