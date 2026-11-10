---
slug: tool-tracker-gantt
repo: ascent-companion
branch: claude/tool-tracker-gantt-x7gelq
status: shipped
started: 2026-11-10T06:16:53Z
updated: 2026-11-10T15:17:11Z
goal: 
next: Office adds tool types, ticks tools on each phase in Edit Tool Schedule > Tasks, gives exceptions their own tools, and leaves out Studio PreCon on the Jobs tab.
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
- 2026-11-10 14:52 · `7537c11` companion: update tool schedule session ledger
- 2026-11-10 15:17 · `ce20a8b` companion: map tools straight to phases and tasks, book tools by hand
  CODEBASE_MAP.md, docs/plans/TOOL_SCHEDULE_PLAN.md, src/app/api/tool-schedule/catalog/route.ts, src/app/api/tool-schedule/holds/route.ts, src/app/api/tool-schedule/rules/route.ts, src/app/tool-schedule/BookingForm.tsx, +15 more

## Notes
