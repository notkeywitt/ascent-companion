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
- Next: Stage 2.

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

### Stage 4 — extras
- "Move coming up": a tool sits at another job when the next job needs it.
  Needs the Tools sheet's ProjectID matched to a JobTread job id.
- "Jobs with no schedule past <date>" line.
- `find_tools` chat answer adds "needed next at".

## 5. Risks

- A renamed task drops out until re-mapped. The "needs a code" list shows it.
- A 6-month view is only as good as the schedules. Holds cover known needs early.
- Two jobs can carry the same schedule: "Studio" and "Studio PreCon" both hold
  the full Studio Gantt today. Both count, so demand doubles. Stage 3 needs a
  way to leave a job out (a per-job exclude, or skip PreCon-phase jobs).

## 6. Files this plan touches

`src/lib/jobtread/tasks.ts`, `src/lib/jobtread/costCodes.ts`, `src/lib/jobtread.ts`,
`src/lib/toolSchedule.ts`; later `src/db/*`, `src/app/api/tool-schedule/**`,
`src/app/tool-schedule/**`, `src/lib/views.ts`, `src/lib/workspaces.ts`, `src/lib/help.ts`.
