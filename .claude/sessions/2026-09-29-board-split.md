---
slug: board-split
repo: ascent-companion
branch: claude/board-split
status: shipped
started: 2026-09-29T23:22:27Z
updated: 2026-10-01T17:08:49Z
goal: Audit finding 01: split src/app/trackingsheet/Board.tsx by job, one block per push, starting with time coding; then NAVIGATION_PLAN.md stage 4
next: Board.tsx split continues: bill-coding state, renderBillCard, labor lane, modals out of Board. Then NAVIGATION_PLAN.md stage 4.
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
- 2026-09-29 21:22 · `4627f34` companion: move the open bill's review flag out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useBillReview.ts
- 2026-09-29 21:24 · `3c59939` companion: move the open bill's line actions out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useLineEdits.ts
- 2026-09-29 21:27 · `8126864` companion: move the open bill's files out of Board, drop unused imports
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useBillFiles.ts
- 2026-09-29 21:30 · `d1d6076` companion: move the code drill-down and drag and drop out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useCodeDrill.ts, src/app/trackingsheet/useLineDrag.ts
- 2026-09-29 21:38 · `748bbce` companion: move the budget rail and drill-down sheet markup out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/BudgetRail.tsx, src/app/trackingsheet/CodeDrillSheet.tsx
- 2026-09-29 21:43 · `e1a30f8` companion: move the board's By bill, By cost code and Summary views out of Board
  CODEBASE_MAP.md, SIMPLICITY_AUDIT.md, src/app/trackingsheet/BillListView.tsx, src/app/trackingsheet/BillingSummaryView.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/CodeLanesView.tsx
- 2026-10-01 10:08 · `3de92f7` companion: open time entry card beside its row on tracking sheet
  src/app/trackingsheet/Board.tsx, src/components/TimeEntryList.tsx

## Notes
- 2026-09-30 04:44 — Split tools live in the session scratchpad: extract.py (hook blocks) and jsx_extract.py (JSX regions to components), both driven by types.cjs (TS compiler dump of Board's top-level types). Verify each move with a difflib removed-lines check and tsc --noUnusedLocals --noUnusedParameters.
