---
slug: board-split
repo: ascent-companion
branch: claude/board-split
status: shipped
started: 2026-09-29T23:22:27Z
updated: 2026-09-30T04:20:00Z
goal: Audit finding 01: split src/app/trackingsheet/Board.tsx by job, one block per push, starting with time coding; then NAVIGATION_PLAN.md stage 4
next: Board.tsx split: 9 blocks shipped (5,112 -> 4,286 lines; 15 new tests). Left: the bill editor's handlers (delete/add/buyback line, billing month, due date, bill number, review flag, combine, drag and drop) and the JSX. Then stage 4 features (iPad bill side sheet — needs owner ok, labor lane, done/open counts).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-29 20:11 · `cc5bd2f` companion: move the Tracking Sheets budget math out of Board, with tests
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/headroom.test.ts, src/app/trackingsheet/headroom.ts
- 2026-09-29 20:18 · `c01e8bc` companion: move Tracking Sheets time coding into its own hook
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useTimeCoding.ts
- 2026-09-29 20:21 · `fd983d8` companion: move the sheet push and pre-send check out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/usePreSendCheck.ts, src/app/trackingsheet/useTrackingPush.ts
- 2026-09-29 20:23 · `e948ed5` companion: move the budget column's screen state out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useRailView.ts
- 2026-09-29 20:49 · `c2662b9` companion: move bill approval out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useBillApproval.ts
- 2026-09-29 20:54 · `aaeccf3` companion: move the coding draft autosave and restore out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useCodingDraft.ts
- 2026-09-29 20:59 · `2f978a8` companion: move the Tracking Sheets month load out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useMonthLoad.ts
- 2026-09-29 21:04 · `8ced181` companion: move Tracking Sheets Save out of Board, with tests
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/saveCoding.test.ts, src/app/trackingsheet/saveCoding.ts
- 2026-09-29 21:19 · `9e06dc8` companion: move the open bill's own fields out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useBillFields.ts

## Notes
