---
slug: alljobs-card
repo: ascent-alljobs
branch: claude/alljobs-card-actions
status: in-progress
started: 2026-10-15T11:06:45Z
updated: 2026-10-15T11:06:45Z
goal: 
next: Owner OK to push (document-access route now stamps runs). Then on /trackingsheet pick a month, run each card action, confirm its stamp updates.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-15 07:06 · `8ced74c` companion: tracking sheets all-jobs view puts the billing month up top, and each job card gives document access, files the labor report and syncs its sheet, stamped with the month's last run
  src/app/api/document-access/route.ts, src/app/api/labor-report/route.ts, src/app/api/month-actions/route.ts, src/app/api/tracking-sheet/route.ts, src/app/trackingsheet/AllBills.tsx, src/app/trackingsheet/AllJobs.tsx, +10 more

## Notes
