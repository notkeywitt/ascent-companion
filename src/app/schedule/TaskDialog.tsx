"use client";

import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Checkbox, Dialog, Input, Label, Textarea } from "@/components/ui";
import type { TaskDocument } from "@/lib/jobtread/taskDocuments";
import type { GanttBar } from "@/lib/scheduleGantt";
import { TaskDocuments } from "./TaskDocuments";
import { patchTask } from "./patchTask";

const dayLabel = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });

export type TaskPick = { bar: GanttBar; hue: string; label: string };

/**
 * The bills and estimates on each task, by task id. null = this person may not
 * see them (or the read failed): the Gantt then shows no money at all. `refresh`
 * re-reads after an attach or a remove.
 */
export function useTaskLinks() {
  const [links, setLinks] = useState<Record<string, TaskDocument[]> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const stop = new AbortController();
    fetch("/api/schedule/links", { signal: stop.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) =>
        setLinks(ok && j.links ? (j.links as Record<string, TaskDocument[]>) : null),
      )
      .catch(() => {});
    return () => stop.abort();
  }, [tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { links, refresh };
}

/** The task dialog: its details, then its bills and estimates. One design on every page that draws the Gantt. */
export function TaskDialog({
  pick,
  links,
  onChanged,
  onClose,
  onSaved,
}: {
  pick: TaskPick;
  links: Record<string, TaskDocument[]> | null;
  onChanged: () => void;
  onClose: () => void;
  /** Set to show Edit. Called after the task is saved to JobTread; the caller re-reads the tasks. */
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Dialog onClose={onClose} title={pick.bar.task.name} description={pick.label} size="lg">
      {editing && onSaved ? (
        <EditForm
          pick={pick}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            onSaved();
            onClose();
          }}
        />
      ) : (
        <>
          <dl className="space-y-2 text-sm">
            {pick.bar.task.phase && <Row k="Phase" v={pick.bar.task.phase} />}
            <Row
              k="Dates"
              v={`${dayLabel(pick.bar.task.startDate)} – ${dayLabel(pick.bar.task.endDate)}`}
            />
            {(pick.bar.task.startTime || pick.bar.task.endTime) && (
              <Row
                k="Time"
                v={[pick.bar.task.startTime, pick.bar.task.endTime].filter(Boolean).join(" – ")}
              />
            )}
            {pick.bar.task.taskTypeName && <Row k="Type" v={pick.bar.task.taskTypeName} />}
            <Row
              k="Progress"
              v={
                pick.bar.task.progress === null
                  ? "Not started"
                  : `${Math.round(pick.bar.task.progress * 100)}%`
              }
            />
            {pick.bar.task.description && <Row k="Notes" v={pick.bar.task.description} />}
          </dl>
          {onSaved && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Edit task
              </Button>
            </div>
          )}
        </>
      )}
      {links && !editing && (
        <TaskDocuments
          key={pick.bar.task.id}
          taskId={pick.bar.task.id}
          jobId={pick.bar.task.jobId}
          docs={links[pick.bar.task.id] ?? []}
          onChanged={onChanged}
        />
      )}
    </Dialog>
  );
}

/** Name, dates, notes and done, written to JobTread through the week's edit route. */
function EditForm({
  pick,
  onCancel,
  onSaved,
}: {
  pick: TaskPick;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = pick.bar.task;
  const [name, setName] = useState(t.name);
  const [start, setStart] = useState(t.startDate);
  const [end, setEnd] = useState(t.endDate);
  const [description, setDescription] = useState(t.description ?? "");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("It needs a name.");
    if (start > end) return setError("The start is after the end.");
    setBusy(true);
    setError("");
    const patch: Parameters<typeof patchTask>[1] = {};
    if (name.trim() !== t.name) patch.name = name.trim();
    if (start !== t.startDate || end !== t.endDate) Object.assign(patch, { start, end });
    if (description !== (t.description ?? "")) patch.description = description;
    if (done) patch.done = true;
    if (Object.keys(patch).length === 0) {
      setBusy(false);
      return onCancel();
    }
    const r = await patchTask(t.id, patch);
    setBusy(false);
    if (r.error) return setError(r.error);
    if (r.previewed) return setError("Writes are off. Nothing was saved.");
    onSaved();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div>
        <Label htmlFor="task-name">Name</Label>
        <Input
          id="task-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="task-start">Start</Label>
          <Input
            id="task-start"
            type="date"
            value={start}
            required
            onChange={(e) => setStart(e.target.value)}
            disabled={busy}
          />
        </div>
        <div>
          <Label htmlFor="task-end">End</Label>
          <Input
            id="task-end"
            type="date"
            value={end}
            min={start}
            required
            onChange={(e) => setEnd(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="task-desc">Notes</Label>
        <Textarea
          id="task-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
        />
      </div>
      <Checkbox
        label="Mark done (it leaves the schedule)"
        checked={done}
        onChange={(e) => setDone(e.target.checked)}
        disabled={busy}
      />
      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save to JobTread"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-neutral-500">{k}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap">{v}</dd>
    </div>
  );
}
