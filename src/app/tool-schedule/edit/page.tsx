import { ToolCatalogEditor, type EditorTab } from "./ToolCatalogEditor";

/**
 * Edit Tool Schedule — the tool tracker's tools and the tasks each is assigned to, the task → tool rules, bookings and
 * left-out jobs (docs/plans/TOOL_SCHEDULE_PLAN.md). Gated by the
 * "tool-schedule-edit" view (office + admin). `?tab=tasks` opens Tasks, `?tab=bookings` Bookings.
 */
const TABS: EditorTab[] = ["tools", "tasks", "bookings", "jobs"];

export default async function ToolScheduleEditPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initialTab = TABS.includes(tab as EditorTab) ? (tab as EditorTab) : "tools";
  return <ToolCatalogEditor initialTab={initialTab} />;
}
