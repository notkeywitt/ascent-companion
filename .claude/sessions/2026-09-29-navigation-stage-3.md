---
slug: navigation-stage-3
repo: ascent-companion
branch: claude/navigation-stage-3
status: shipped
started: 2026-09-29T20:14:05Z
updated: 2026-09-29T20:30:13Z
goal: NAVIGATION_PLAN.md Stage 3: Not in JobTread merge, Code this bill on Email Invoices, Time Off office console path, Labor Report on People, drop the /admin Notices tab, bill History link
next: Owner: run ./deploy.sh in ascent-appscript (ba91749) so Email Invoices shows Code this bill. Next: stage 4 (Month Close in depth) after audit 01's Board split, or decision 7 (read-only Sunset bill view for leads).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-29 13:17 · `bca7ad2` companion: stage 3 small moves — notices, bill history, labor report
  CODEBASE_MAP.md, src/app/admin/page.tsx, src/app/journal/page.tsx, src/app/labor-import/page.tsx, src/app/notices/page.tsx, src/app/trackingsheet/BillCodingCard.tsx, +1 more
- 2026-09-29 13:21 · `2b356ad` companion: Time Off office console on its own page
  CODEBASE_MAP.md, src/app/time-off/TimeOff.tsx, src/app/time-off/office/page.tsx, src/app/time-off/page.tsx, src/components/TodayQueue.tsx, src/lib/help.ts, +2 more
- 2026-09-29 13:26 · `d2b40ce` companion: Code this bill link after logging an email invoice
  src/app/email/page.tsx
- 2026-09-29 13:29 · `343360e` companion: Not in JobTread holds all three missing-bill queues
  src/app/needs-project/page.tsx
- 2026-09-29 13:30 · `f5fb7fd` companion: record stage 3 status in the navigation plan
  NAVIGATION_PLAN.md

## Notes
