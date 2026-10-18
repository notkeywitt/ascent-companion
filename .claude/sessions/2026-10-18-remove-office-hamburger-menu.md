---
slug: remove-office-hamburger-menu
repo: ascent-companion
branch: claude/remove-office-hamburger-menu-8cquxy
status: shipped
started: 2026-10-18T16:14:41Z
updated: 2026-10-18T17:20:03Z
goal: 
next: owner to confirm office view-only time is enough, or whether office should also edit as others
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-18 16:14 · `1e2362f` companion: drop the ☰ menu for the office role, keep the account item
  src/components/AppHeader.tsx
- 2026-10-18 16:25 · `f980657` companion: let the office view another employee's time, read only
  src/app/api/employee-time/clock/route.ts, src/app/api/employee-time/route.ts, src/app/employee-time/EmployeeTimeClient.tsx, src/app/employee-time/page.tsx, src/lib/actingAs.ts
- 2026-10-18 16:54 · `1f3b4eb` companion: let the office log and edit time as another employee
  src/app/api/employee-time/clock/route.ts, src/app/api/employee-time/history/route.ts, src/app/api/employee-time/jobs/route.ts, src/app/api/employee-time/pay-rules/route.ts, src/app/api/employee-time/route.ts, src/app/employee-time/EmployeeTimeClient.tsx, +4 more

## Notes
