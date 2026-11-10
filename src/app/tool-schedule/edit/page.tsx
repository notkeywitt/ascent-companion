import { ToolCatalogEditor, type EditorTab } from "./ToolCatalogEditor";

/**
 * Edit Tool Schedule — the tool catalogue, the task → cost code rules, holds and
 * left-out jobs (docs/plans/TOOL_SCHEDULE_PLAN.md). Gated by the
 * "tool-schedule-edit" view (office + admin). `?tab=tasks` opens Task codes.
 */
const TABS: EditorTab[] = ["catalogue", "tasks", "holds", "jobs"];

export default async function ToolScheduleEditPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const initialTab = TABS.includes(tab as EditorTab) ? (tab as EditorTab) : "catalogue";
  return <ToolCatalogEditor initialTab={initialTab} />;
}
