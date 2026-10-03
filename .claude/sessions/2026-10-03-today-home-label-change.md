---
slug: today-home-label-change
repo: ascent-companion
branch: claude/today-home-label-change-cem6l4
status: shipped
started: 2026-10-03T13:11:46Z
updated: 2026-10-03T13:45:48Z
goal: 
next: owner: check /job-board on a phone and iPad; decide if Prospective jobs belong on it
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-03 13:11 · `ed56d20` companion: rename Today to Home in the menu, bar and home masthead
  src/components/HomeMasthead.tsx, src/lib/help.ts, src/lib/workspaces.test.ts, src/lib/workspaces.ts
- 2026-10-03 13:18 · `6f81268` companion: rename Month Close to Invoicing and drop its tab strip
  CLAUDE.md, src/components/TabBar.tsx, src/components/WorkspaceTabs.tsx, src/lib/copy.ts, src/lib/help.ts, src/lib/workspaces.ts
- 2026-10-03 13:32 · `2e43b17` companion: add jobs page under clients and put it on the bar in place of incoming bills
  CODEBASE_MAP.md, src/app/api/job-board/route.ts, src/app/job-board/JobBoardPage.tsx, src/app/job-board/page.tsx, src/components/HomeLeadBoard.tsx, src/components/TabBar.tsx, +6 more
- 2026-10-03 13:38 · `bf43de1` companion: fix jobs page 413 by dropping to-do assignees from the paged read
  src/app/job-board/JobBoardPage.tsx, src/lib/jobBoard.test.ts, src/lib/jobBoard.ts, src/lib/jobtread.ts
- 2026-10-03 13:43 · `7d7e4dd` companion: read jobs page to-do assignees in a second by-id pass
  src/app/job-board/JobBoardPage.tsx, src/lib/jobBoard.test.ts, src/lib/jobBoard.ts, src/lib/jobtread.ts
- 2026-10-03 13:45 · `a330b80` companion: give the jobs bar slot a hammer icon
  src/components/TabBar.tsx

## Notes
