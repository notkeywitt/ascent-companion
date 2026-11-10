---
slug: tool-tracker-gantt
repo: ascent-companion
branch: claude/tool-tracker-gantt-x7gelq
status: shipped
started: 2026-11-10T06:16:53Z
updated: 2026-11-10T18:53:39Z
goal: 
next: Office: in Edit Tool Schedule > Tools, assign tools and types to phases; fix blank ToolTypes with Set its type; leave out Studio PreCon on Jobs; confirm the first requisition prompt files correctly.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-11-10 06:30 · `96b2b15` companion: start tool schedule session ledger
- 2026-11-10 06:36 · `5183823` companion: add tool schedule reads and rules (stage 1)
  CODEBASE_MAP.md, docs/plans/TOOL_SCHEDULE_PLAN.md, src/lib/jobtread.ts, src/lib/jobtread/costCodes.ts, src/lib/jobtread/tasks.ts, src/lib/toolSchedule.test.ts, +1 more
- 2026-11-10 06:59 · `e7c272e` companion: add tool schedule page and catalogue editor
  CODEBASE_MAP.md, docs/plans/TOOL_SCHEDULE_PLAN.md, src/app/api/tool-schedule/catalog/route.ts, src/app/api/tool-schedule/holds/route.ts, src/app/api/tool-schedule/jobs/route.ts, src/app/api/tool-schedule/route.ts, +20 more
- 2026-11-10 14:46 · `94a2389` companion: tool schedule job filter, searchable code pickers, sorting
  CODEBASE_MAP.md, docs/plans/TOOL_SCHEDULE_PLAN.md, src/app/tool-schedule/ToolSchedule.tsx, src/app/tool-schedule/edit/ToolCatalogEditor.tsx, src/components/CostCodeSelect.tsx, src/lib/searchWords.ts, +2 more
- 2026-11-10 18:49 · `9940afc` companion: tool schedule catalogue is the tool tracker
  CODEBASE_MAP.md, docs/plans/TOOL_SCHEDULE_PLAN.md, src/app/api/tool-schedule/availability/route.ts, src/app/api/tool-schedule/catalog/route.ts, src/app/api/tool-schedule/holds/route.ts, src/app/api/tool-schedule/rules/route.ts, +16 more

## Notes
