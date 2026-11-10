# TOOL_SCHEDULE_PLAN.md — tools allocated from the JobTread schedules

Status: in progress — 2026-11-10

The staged plan for a tool schedule: which generic tools (table saw, compressor)
each open job needs, on which days, built from the JobTread Gantt schedules. It
flags conflicts and missing tools up to 6 months ahead.

Read 2026-11-10 against the live JobTread org and the Pave schema.
The owner approved a clickable sample of the layouts the same day.

## Status

- Stage 0 (sample layouts): done, approved 2026-11-10.
- Stage 1 (reads + rules): done — `getUpcomingScheduleTasks`, `getCostCodes`, `src/lib/toolSchedule.ts`.
- Stages 2–4: done 2026-11-10 — tables, editor, schedule page, moves, left-out jobs, chat tool.
- Round 2 done 2026-11-10 — help text trimmed, searchable cost-code pickers, a job filter on the schedule page, sortable catalogue and task-code lists.
- Next: the office fills the catalogue and maps task names; then watch whether
  the move list is useful (it depends on Tools-sheet labels matching job names).

## 1. What JobTread offers

| Question | Answer |
|---|---|
| Equipment, resource or inventory object? | None in the Pave schema. |
| Task → cost code link? | None. `task` has no `costCode`, `costItem` or `customFieldValues`. |
| Custom field on a task or cost code? | No. Targets are costItem, customer, customerContact, dailyLog, job, location, vendor, vendorContact. |
| `createTasksFromBudget` | Makes tasks from the budget, keeps no link back. |
| `taskType` | 36 types exist. Almost every live task has none set. |
| Task names | Repeat across jobs, from 2 task templates ("Footings", "Wall Framing & Sheathing"). |

So JobTread can't hold the plan. The companion holds it and only reads the schedule.
No JobTread write. No Apps Script change.

## 2. The model

- A **tool type** (table saw) is needed for one or more cost codes.
- A **schedule task** resolves to a cost code by rule, first hit wins:
  task override → task name → task type → phase name. A rule may say
  "needs no tools". Owner decision 2026-11-10: the main path is the task name,
  mapped once and reused on every job. Unmapped names go to a "needs a code"
  list with suggested codes (`suggestCodes`); a suggestion counts for nothing
  until confirmed.
- A **physical tool** from the Tools sheet is tagged with its tool type. Supply
  is the usable ones (not broken, in repair or lost).
- **Demand** per tool type per day is the number of jobs with a task needing
  it. A job counts once a day. A **hold** reserves a tool for a job by hand, with
  a quantity.
- **Shortfall**: demand > owned. **Missing**: needed and none owned.

## 3. Decisions for the owner (made 2026-11-10)

- Everyone sees the schedule. Office and admin edit the catalogue, rules and holds.
- Default range 6 months; 1 and 3 months also offered.

## 4. Stages

### Stage 1 — reads and rules (no DB, no UI) — done
- `getUpcomingScheduleTasks(cfg, from, to)` in `jobtread/tasks.ts`: open leaf
  tasks overlapping the range, no nested connection, cached 5 min.
- `getCostCodes(cfg)` in `jobtread/costCodes.ts`: active codes, cached 1 h.
- `src/lib/toolSchedule.ts` + tests: resolve, suggest, demand, shortfalls.

### Stage 2 — data and the editing page
- Tables in `src/db/index.ts` `applySchema` + `schema.ts`: `tool_kinds`,
  `tool_kind_codes`, `tool_kind_members` (sheet tool id → tool type),
  `task_code_rules` (match, key, cost_code_id nullable), `tool_holds`. Bump
  `SCHEMA_FINGERPRINT`.
- Routes `/api/tool-schedule/catalog`, `/rules`, `/holds` (office + admin; the
  write methods also check the role).
- Page `/tool-schedule/edit`: Catalogue · Task codes · Holds tabs.

### Stage 3 — the schedule page
- `GET /api/tool-schedule?from&to`: tasks + rules + catalogue + `toolsBootstrap`
  supply → `buildDemand` + `scheduleByKind`.
- Page `/tool-schedule`: Gantt | Calendar | List, summary chips, detail dialog.
  List first. Reuse `barPct`/`axisTicks` (`jobBoard.ts`), `calendarWeeks`
  (`timeEntryDates.ts`), `Segmented`.
- Views: `tool-schedule` (all roles), `tool-schedule-edit` (office + admin).
  Tab next to Tools in `workspaces.ts`; help entry.

### Stage 4 — extras — done
- "Moves coming up" (`findMoves`): a job needs a tool type and no usable one
  sits there. The Tools sheet's location is a Project Database row, not a
  JobTread id, so `matchJobByLabel` matches its "Customer - Project" label to a
  job name; an unmatched location (the Shop) counts as "not at the job".
- "Schedule ends before <date>" line under the schedule.
- Left-out jobs (`tool_job_excludes`, editor's Jobs tab) — the Studio PreCon fix.
- Chat tool `get_tool_schedule` (a new tool, beside `find_tools`, which stays
  "where is it now").

## 5. Risks

- A renamed task drops out until re-mapped. The "needs a code" list shows it.
- A 6-month view is only as good as the schedules. Holds cover known needs early.
- Two jobs can carry the same schedule: "Studio" and "Studio PreCon" both hold
  the full Studio Gantt today. Both count until the office leaves one out on
  the editor's Jobs tab.

## 6. Files this plan touches

`src/lib/jobtread/tasks.ts`, `src/lib/jobtread/costCodes.ts`, `src/lib/jobtread.ts`,
`src/lib/toolSchedule.ts`; later `src/db/*`, `src/app/api/tool-schedule/**`,
`src/app/tool-schedule/**`, `src/lib/views.ts`, `src/lib/workspaces.ts`, `src/lib/help.ts`.
