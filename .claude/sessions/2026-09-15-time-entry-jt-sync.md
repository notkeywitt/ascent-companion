---
slug: time-entry-jt-sync
repo: ascent-companion
branch: claude/time-entry-jt-sync-6q3257
status: in-progress
started: 2026-09-15T21:16:24Z
updated: 2026-09-15T21:27:54Z
goal: 
next: Shipped to main. Open /time-sync, retry Dan's 2026-09-14 rows — they should post with status 'pushed (retry, moved to the Labor line)'. Then confirm the /employee-time cost-code picker shows only Labor lines, each with its own line name.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-15 21:16 · `2a3914a` companion: catch time entries jobtread has with the wrong hours
  CODEBASE_MAP.md, src/app/api/time-sync/retry/route.ts, src/app/api/time-sync/route.ts, src/app/more/page.tsx, src/app/page.tsx, src/app/time-sync/page.tsx, +12 more
- 2026-09-15 21:16 · `c551741` companion: set session next step
- 2026-09-15 21:17 · `f7a8ed3` companion: log the ledger commit row
- 2026-09-15 21:24 · `a8cb261` companion: only offer cost lines jobtread will take an hour on
  src/app/api/employee-time/route.ts, src/app/employee-time/EmployeeTimeClient.tsx, src/app/time-sync/page.tsx, src/lib/jobtread.test.ts, src/lib/jobtread.ts, src/lib/timeSync.ts

## Notes
- 2026-09-15 21:27 — JobTread gates time tracking on costType.isTimeTrackable (the cost ITEM), not the cost code. The /employee-time picker offered every budget line under a code and labelled each with the CODE's name, which is identical across its lines — so a field pick could be refused at write time. Tracking Sheets already filtered via laborOptions/budgetCodeMaps; the phone path never did.
