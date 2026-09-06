---
slug: time-entry-job-thread-links
repo: ascent-companion
branch: claude/time-entry-job-thread-links-3b94si
status: shipped
started: 2026-09-06T05:34:43Z
updated: 2026-09-06T05:39:42Z
goal: 
next: verify on a phone that the ↗ from a time entry opens JobTread's time page on the right person and day; if a job filter turns out to exist, add it to jtTimeUrl
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-06 05:34 · `7996de3` companion: carry the jobtread user id on a time entry
  src/components/TimeEntryList.tsx, src/lib/jobtread.ts
- 2026-09-06 05:39 · `3665fc9` companion: point time-entry links at the filtered jobtread time page
  src/app/api/employee-time/history/route.ts, src/app/labor-review/LaborReview.tsx, src/app/trackingsheet/Board.tsx, src/components/JtLink.tsx, src/components/TimeEntryList.tsx, src/lib/jtLinks.test.ts, +1 more

## Notes
