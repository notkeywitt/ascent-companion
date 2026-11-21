"use client";

import { useCallback, useEffect, useState } from "react";

import { Dialog } from "@/components/ui";
import type { TaskDocument } from "@/lib/jobtread/taskDocuments";
import type { GanttBar } from "@/lib/scheduleGantt";
import { TaskDocuments } from "./TaskDocuments";

const dayLabel = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

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
      .then(({ ok, j }) => setLinks(ok && j.links ? (j.links as Record<string, TaskDocument[]>) : null))
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
}: {
  pick: TaskPick;
  links: Record<string, TaskDocument[]> | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog onClose={onClose} title={pick.bar.task.name} description={pick.label} size="lg">
      <dl className="space-y-2 text-sm">
        {pick.bar.task.phase && <Row k="Phase" v={pick.bar.task.phase} />}
        <Row k="Dates" v={`${dayLabel(pick.bar.task.startDate)} – ${dayLabel(pick.bar.task.endDate)}`} />
        {(pick.bar.task.startTime || pick.bar.task.endTime) && (
          <Row k="Time" v={[pick.bar.task.startTime, pick.bar.task.endTime].filter(Boolean).join(" – ")} />
        )}
        {pick.bar.task.taskTypeName && <Row k="Type" v={pick.bar.task.taskTypeName} />}
        <Row
          k="Progress"
          v={pick.bar.task.progress === null ? "Not started" : `${Math.round(pick.bar.task.progress * 100)}%`}
        />
        {pick.bar.task.description && <Row k="Notes" v={pick.bar.task.description} />}
      </dl>
      {links && (
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-neutral-500">{k}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-wrap">{v}</dd>
    </div>
  );
}
