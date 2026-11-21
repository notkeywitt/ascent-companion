"use client";

import { useState } from "react";

import { JobGantt } from "@/components/JobGantt";
import { ScheduleView } from "./ScheduleView";
import { TaskDialog, useTaskLinks, type TaskPick } from "./TaskDialog";

/**
 * One job's schedule, in the Schedule page's design: the same Gantt, the same
 * task dialog with its bills and estimates. Used by the job overview (Jobs Hub
 * Schedule tab and Home's job card). A role without the `schedule` view cannot
 * read the tasks; it gets the older phase chart instead of an error.
 */
export function JobSchedule({ jobId }: { jobId: string }) {
  const [pick, setPick] = useState<TaskPick | null>(null);
  const { links, refresh } = useTaskLinks();
  return (
    <>
      <ScheduleView
        jobId={jobId}
        links={links}
        onPick={setPick}
        fallback={<JobGantt jobId={jobId} />}
      />
      {pick && <TaskDialog pick={pick} links={links} onChanged={refresh} onClose={() => setPick(null)} />}
    </>
  );
}
