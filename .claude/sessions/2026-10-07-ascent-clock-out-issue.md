---
slug: ascent-clock-out-issue
repo: ascent-companion
branch: claude/ascent-clock-out-issue-yslhbe
status: shipped
started: 2026-10-07T02:25:33Z
updated: 2026-10-07T02:58:23Z
goal: stop a clock-in from closing a running JobTread clock
next: watch the first clock-ins after deploy; follow-up: pause/switch/clock-out still write endedAt onto an entry already closed elsewhere
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-07 02:28 · `cc4a738` companion: refuse a clock-in while jobtread holds a running clock
  src/app/api/employee-time/clock/route.ts, src/app/employee-time/EmployeeTimeClient.tsx, src/app/employee-time/page.tsx, src/lib/employeeClock.test.ts, src/lib/employeeClock.ts, src/lib/help.ts, +1 more
- 2026-10-07 02:58 · `7e67f05` companion: let only a fresh jobtread read clear the running clock
  src/app/employee-time/EmployeeTimeClient.tsx, src/app/employee-time/page.tsx

## Notes
- 2026-10-07 02:25 — Cause: JobTread closes a person's running entry when a new open entry is created. A stale /employee-time screen offered Clock in; 6 silent closes 9/08-10/05 (JT event log, grant 'Sunset Invoce Automation', non-.000 ms endedAt). Vercel logs unreadable: connector token lacks the 'keywitt' scope.
- 2026-10-07 02:58 — Vercel request data (observability, not runtime logs) on 10/05: the time page mounted at 12:31 and 12:39 with NO server render (only the cost-code fetch hit JobTread; at 12:39:10 no /employee-time request at all). Next.js replayed the 7:57 AM payload (before the clock-in), whose 'no clock, linked' answer made reconcile wipe the phone's clock. Fix: shell answer paints only; a fresh GET decides.
