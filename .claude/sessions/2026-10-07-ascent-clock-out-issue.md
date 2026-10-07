---
slug: ascent-clock-out-issue
repo: ascent-companion
branch: claude/ascent-clock-out-issue-yslhbe
status: in-progress
started: 2026-10-07T02:25:33Z
updated: 2026-10-07T02:25:33Z
goal: stop a clock-in from closing a running JobTread clock
next: 
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->

## Notes
- 2026-10-07 02:25 — Cause: JobTread closes a person's running entry when a new open entry is created. A stale /employee-time screen offered Clock in; 6 silent closes 9/08-10/05 (JT event log, grant 'Sunset Invoce Automation', non-.000 ms endedAt). Vercel logs unreadable: connector token lacks the 'keywitt' scope.
