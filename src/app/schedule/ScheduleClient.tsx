"use client";

import { useEffect, useState } from "react";

import { Dialog, PageHeader } from "@/components/ui";
import type { TaskDocument } from "@/lib/jobtread/taskDocuments";
import type { GanttBar } from "@/lib/scheduleGantt";
import { ScheduleView } from "./ScheduleView";
import { TaskDocuments } from "./TaskDocuments";

const dayLabel = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

export function ScheduleClient() {
  const [pick, setPick] = useState<{ bar: GanttBar; hue: string; label: string } | null>(null);
  // The bills and estimates on each task, by task id. null = this person may not
  // see them (or the read failed): the page then shows no money at all.
  const [links, setLinks] = useState<Record<string, TaskDocument[]> | null>(null);
  const [linksTick, setLinksTick] = useState(0);

  useEffect(() => {
    const stop = new AbortController();
    fetch("/api/schedule/links", { signal: stop.signal })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => setLinks(ok && j.links ? (j.links as Record<string, TaskDocument[]>) : null))
      .catch(() => {});
    return () => stop.abort();
  }, [linksTick]);

  return (
    <main className="w-full px-4 pad:px-7 pb-24 pt-6">
      <PageHeader
        title="Schedule"
        description="Every open task on every job, from JobTread. Tap a bar for its details."
        className="!mb-3"
      />

      <ScheduleView links={links} onPick={setPick} />

      {pick && (
        <Dialog onClose={() => setPick(null)} title={pick.bar.task.name} description={pick.label} size="lg">
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
              onChanged={() => setLinksTick((n) => n + 1)}
            />
          )}
        </Dialog>
      )}
    </main>
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

