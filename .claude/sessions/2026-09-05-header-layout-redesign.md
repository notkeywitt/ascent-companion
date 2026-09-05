---
slug: header-layout-redesign
repo: ascent-companion
branch: claude/header-layout-redesign-xid33s
status: in-progress
started: 2026-09-05T06:17:43Z
updated: 2026-09-05T19:56:08Z
goal: 
next: rearrange the tracking-sheet action buttons for mobile and desktop — they read as scattered right now
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-05 06:17 · `d453024` companion: move search into the header row, job picker onto the tracking sheet
  CLAUDE.md, CODEBASE_MAP.md, USER_MANUAL.md, src/app/globals.css, src/app/trackingsheet/AllJobs.tsx, src/app/trackingsheet/Board.tsx, +6 more
- 2026-09-05 06:18 · `07e414a` companion: record session ledger for the header layout redesign
- 2026-09-05 06:18 · `ea79706` companion: log the ledger commit row
- 2026-09-05 13:14 · `0bede08` Merge remote-tracking branch 'origin/main' into claude/header-layout-redesign-xid33s
  CODEBASE_MAP.md, SESSIONS.md, src/app/globals.css, src/lib/sessionLog.generated.json
- 2026-09-05 13:53 · `cdec68d` companion: logo is the theme switch, Sync moves to the tracking sheet's closing row
  CODEBASE_MAP.md, USER_MANUAL.md, src/app/globals.css, src/app/trackingsheet/Board.tsx, src/components/AppHeader.tsx, src/components/SyncNowButton.tsx, +1 more
- 2026-09-05 14:04 · `61b7a12` companion: make the Tracking Sheets title a job picker when no job is selected
  src/app/trackingsheet/AllJobs.tsx, src/app/trackingsheet/Board.tsx, src/components/JobPicker.tsx
- 2026-09-05 14:17 · `d9f961d` companion: gather the tracking sheet's closing actions into one row
  USER_MANUAL.md, src/app/trackingsheet/AllJobs.tsx, src/app/trackingsheet/Board.tsx, src/components/JobPicker.tsx, src/components/SyncNowButton.tsx, src/components/ui.tsx
- 2026-09-05 14:47 · `d93a987` companion: tighten the budget expander's heading row on mobile
  src/app/trackingsheet/Board.tsx
- 2026-09-05 15:08 · `e4a7854` companion: put the billing month on the title line on mobile
  src/app/trackingsheet/Board.tsx
- 2026-09-05 16:14 · `ce3dbcd` companion: drop the budget rail's formula footnote
  src/app/trackingsheet/Board.tsx
- 2026-09-05 16:21 · `db2e745` companion: drop the to-be-invoiced footnote, move Edit home page under the menus
  src/app/page.tsx, src/app/trackingsheet/Board.tsx
- 2026-09-05 16:26 · `7371a4d` companion: fold the launcher's menus away
  src/app/page.tsx, src/components/ui.tsx
- 2026-09-05 17:06 · `6ea671a` companion: rank budget headroom by dollars, not percent of budget
  src/app/trackingsheet/Board.tsx
- 2026-09-05 18:07 · `0b53e0e` companion: fold and flip the phone's budget headroom row
  src/app/trackingsheet/Board.tsx
- 2026-09-05 19:56 · `e6a7e55` companion: on a phone, lead with the month's figure and fold the budget under it
  src/app/trackingsheet/Board.tsx

## Notes
