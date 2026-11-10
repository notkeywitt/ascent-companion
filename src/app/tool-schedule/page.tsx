import { toolScheduleUser } from "@/lib/toolScheduleAccess";
import { ToolSchedule } from "./ToolSchedule";

/**
 * Tool Schedule — which tool types each job needs, and when, from the JobTread
 * schedules (docs/plans/TOOL_SCHEDULE_PLAN.md). Data from /api/tool-schedule.
 * Gated by the "tool-schedule" view (every role); the Edit link shows only to
 * a person with "tool-schedule-edit".
 */
export const dynamic = "force-dynamic";

export default async function ToolSchedulePage() {
  const { canEdit } = await toolScheduleUser();
  return <ToolSchedule canEdit={canEdit} />;
}
