---
slug: ascent-app-simplify
repo: ascent-companion
branch: claude/ascent-app-simplify-w613c1
status: in-progress
started: 2026-09-29T15:13:06Z
updated: 2026-09-30T12:50:46Z
goal: Fix the Tracking Sheets sales-tax crash, then the loose ends from the 2026-09-30 progress check of NAVIGATION_PLAN.md stages 0-3
next: Owner answers the 10 decisions in NAVIGATION_PLAN.md; then Stage 0: gate /api/time-off/import on time-off-admin and /api/labor-report, re-gate + Add bill on recode, add npm test to pre-push.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-29 15:13 · `4be25ab` companion: add navigation plan — ten workspaces, a today queue, one menu list
  CODEBASE_MAP.md, NAVIGATION_PLAN.md
- 2026-09-30 12:50 · `4373647` companion: stop tracking sheets crashing when a sales-tax figure is staged
  src/app/trackingsheet/Board.tsx

## Notes
- 2026-09-29 15:13 — Plan: regroup 58 routes into 10 workspaces with tab strips carrying jobId+ym; Home becomes Today (queue); one list (src/lib/workspaces.ts) feeds bar, rail, menu, search. Routes and view ids stay. Full plan NAVIGATION_PLAN.md; web version https://claude.ai/artifact/2RBRreUQTJFzexsFHQyGL1
- 2026-09-29 15:13 — Found: POST /api/time-off/import and POST /api/labor-report are callable by any signed-in user. Stage 0 gates them, pending owner ok.
