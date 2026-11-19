import { ScheduleClient } from "./ScheduleClient";

/**
 * Schedule — a Gantt of every open JobTread schedule task, a job per band.
 * Stage 1 of the plan in docs/plans/SCHEDULE_PLAN.md: read-only. Data from
 * /api/schedule. Gated by the "schedule" view in src/lib/views.ts.
 */
export const dynamic = "force-dynamic";

export default function SchedulePage() {
  return <ScheduleClient />;
}
