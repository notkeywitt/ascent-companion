import { ToolCatalogEditor, type EditorTab } from "./ToolCatalogEditor";

/**
 * Edit Tool Schedule — the tool catalogue, the task → tool rules, bookings and
 * left-out jobs (docs/plans/TOOL_SCHEDULE_PLAN.md). Gated by the
 * "tool-schedule-edit" view (office + admin). `?tab=tasks` opens Tasks, `?tab=bookings` Bookings.
 */
const TABS: EditorTab[] = ["catalogue", "tasks", "bookings", "jobs"];

export default async function ToolScheduleEditPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initialTab = TABS.includes(tab as EditorTab) ? (tab as EditorTab) : "catalogue";
  return <ToolCatalogEditor initialTab={initialTab} />;
}
