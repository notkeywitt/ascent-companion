"use client";

import { useState } from "react";

import { PageHeader } from "@/components/ui";
import { ScheduleView } from "./ScheduleView";
import { TaskDialog, useTaskLinks, type TaskPick } from "./TaskDialog";

export function ScheduleClient() {
  const [pick, setPick] = useState<TaskPick | null>(null);
  const { links, refresh } = useTaskLinks();
  const [reload, setReload] = useState(0);

  return (
    <main className="w-full px-4 pad:px-7 pb-24 pt-6">
      <PageHeader
        title="Schedule"
        description="Every open task on every job, from JobTread. Tap a bar for its details. Drag a bar to move the task in JobTread."
        className="!mb-3"
      />

      <ScheduleView links={links} onPick={setPick} canMove reloadKey={reload} />

      {pick && (
        <TaskDialog
          pick={pick}
          links={links}
          onChanged={refresh}
          onClose={() => setPick(null)}
          onSaved={() => setReload((n) => n + 1)}
        />
      )}
    </main>
  );
}
