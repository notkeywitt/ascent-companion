---
slug: board-split
repo: ascent-companion
branch: claude/board-split
status: shipped
started: 2026-09-29T23:22:27Z
updated: 2026-09-30T03:50:31Z
goal: Audit finding 01: split src/app/trackingsheet/Board.tsx by job, one block per push, starting with time coding; then NAVIGATION_PLAN.md stage 4
next: Board.tsx split: 4 blocks shipped (budget math + tests, time coding, sheet push + pre-send, rail view). Left: month load, bill coding, tax panel, invoice approval — all JobTread write paths; owner ok needed per CLAUDE.md before moving them.
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

## Notes
