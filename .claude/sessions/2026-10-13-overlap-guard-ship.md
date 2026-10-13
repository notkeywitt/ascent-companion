---
slug: overlap-guard-ship
repo: ov-wt
branch: claude/overlap-guard-ship
status: done
started: 2026-10-13T11:14:40Z
updated: 2026-10-13T11:15:43Z
goal: 
next: Clean up the Seth 9/16 and Wyatt 9/14 duplicate time entries in JobTread (the guard stops new ones, it does not remove these).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-12 11:22 · `d45f4e8` companion: refuse a time entry that overlaps one the employee already has
  src/app/api/time-entry/create/route.ts, src/lib/timeProblems.test.ts, src/lib/timeProblems.ts, src/lib/timeSync.ts

## Notes
