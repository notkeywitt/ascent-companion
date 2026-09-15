---
slug: time-entry-jt-sync
repo: ascent-companion
branch: claude/time-entry-jt-sync-6q3257
status: in-progress
started: 2026-09-15T21:16:24Z
updated: 2026-09-15T21:44:11Z
goal: 
next: Verify view-as-employee live: open /employee-time as admin, tap 'View another employee's time', pick Dan, confirm his clock + timesheet load and an edit saves with Logged By = the admin.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-15 21:16 · `2a3914a` companion: catch time entries jobtread has with the wrong hours
  CODEBASE_MAP.md, src/app/api/time-sync/retry/route.ts, src/app/api/time-sync/route.ts, src/app/more/page.tsx, src/app/page.tsx, src/app/time-sync/page.tsx, +12 more
- 2026-09-15 21:16 · `c551741` companion: set session next step
- 2026-09-15 21:17 · `f7a8ed3` companion: log the ledger commit row
- 2026-09-15 21:24 · `a8cb261` companion: only offer cost lines jobtread will take an hour on
  src/app/api/employee-time/route.ts, src/app/employee-time/EmployeeTimeClient.tsx, src/app/time-sync/page.tsx, src/lib/jobtread.test.ts, src/lib/jobtread.ts, src/lib/timeSync.ts
- 2026-09-15 21:44 · `392a4e4` companion: let an admin open employee time as another employee
  CODEBASE_MAP.md, src/app/api/employee-time/clock/route.ts, src/app/api/employee-time/history/route.ts, src/app/api/employee-time/route.ts, src/app/employee-time/EmployeeTimeClient.tsx, src/app/employee-time/page.tsx, +5 more

## Notes
- 2026-09-15 21:27 — JobTread gates time tracking on costType.isTimeTrackable (the cost ITEM), not the cost code. The /employee-time picker offered every budget line under a code and labelled each with the CODE's name, which is identical across its lines — so a field pick could be refused at write time. Tracking Sheets already filtered via laborOptions/budgetCodeMaps; the phone path never did.
