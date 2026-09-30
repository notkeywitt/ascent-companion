---
slug: ascent-app-simplify
repo: ascent-companion
branch: claude/ascent-app-simplify-w613c1
status: shipped
started: 2026-09-29T15:13:06Z
updated: 2026-09-30T13:42:44Z
goal: Fix the Tracking Sheets sales-tax crash, then the loose ends from the 2026-09-30 progress check of NAVIGATION_PLAN.md stages 0-3
next: Ship claude/ascent-app-simplify-w613c1 to main (npm run ship) once the labels-help and layout-docs review lenses report clean. Owner still to answer: Push as Expense account (always 271 Capital One Sparks). Owner: ./deploy.sh in ascent-appscript for Code this bill.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-29 15:13 · `4be25ab` companion: add navigation plan — ten workspaces, a today queue, one menu list
  CODEBASE_MAP.md, NAVIGATION_PLAN.md
- 2026-09-30 12:50 · `4373647` companion: stop tracking sheets crashing when a sales-tax figure is staged
  src/app/trackingsheet/Board.tsx
- 2026-09-30 13:05 · `ba1e0c4` companion: keep a staged bill/expense type in the coding draft, carry finalize's job, drive the side panel from today's drafts
  src/app/tracking-sheet/page.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/useCodingDraft.ts, src/components/TodayQueue.tsx, src/lib/codingDraft.test.ts, src/lib/codingDraft.ts
- 2026-09-30 13:05 · `60e69cd` companion: gate the coding queue on tracking sheets, test the specs write route
  src/lib/billEditAccess.test.ts, src/lib/views.ts
- 2026-09-30 13:05 · `15c71b6` companion: one label per page — time, miles, requisitions, access, office dashboard; drop the rfi help topic
  src/app/admin/page.tsx, src/app/employee-time/EmployeeTimeClient.tsx, src/app/mileage-tracker/page.tsx, src/app/office/page.tsx, src/lib/copy.ts, src/lib/help.ts, +2 more
- 2026-09-30 13:05 · `d922dc1` companion: delete the inert refresh provider and digest-instructions route, fix stale comments
  src/app/invoice-review/InvoiceReview.tsx, src/app/layout.tsx, src/components/HomeMasthead.tsx, src/lib/digest/instructions.ts
- 2026-09-30 13:05 · `b259ac1` companion: bring the docs up to the workspace navigation, tick audit 09 and 10
  ARCHITECTURE_REVIEW.md, CLAUDE.md, CODEBASE_MAP.md, NAVIGATION_PLAN.md, README.md, SIMPLICITY_AUDIT.md, +2 more
- 2026-09-30 13:05 · `6db3068` companion: delete the refresh provider and digest-instructions route files
  src/app/api/admin/digest-instructions/route.ts, src/components/RefreshProvider.tsx
- 2026-09-30 13:18 · `0373e79` companion: no tab strip for field and lead, leads open on time, lift the help mark off the bar
  USER_MANUAL.md, src/app/page.tsx, src/components/PageGuide.tsx, src/components/WorkspaceTabs.tsx
- 2026-09-30 13:18 · `2b80a25` companion: log session 2026-09-29-ascent-app-simplify
- 2026-09-30 13:42 · `dd1a6fb` companion: miles records the signed-in person, new description, buttons for manual and history
  src/app/mileage-tracker/page.tsx

## Notes
- 2026-09-29 15:13 — Plan: regroup 58 routes into 10 workspaces with tab strips carrying jobId+ym; Home becomes Today (queue); one list (src/lib/workspaces.ts) feeds bar, rail, menu, search. Routes and view ids stay. Full plan NAVIGATION_PLAN.md; web version https://claude.ai/artifact/2RBRreUQTJFzexsFHQyGL1
- 2026-09-29 15:13 — Found: POST /api/time-off/import and POST /api/labor-report are callable by any signed-in user. Stage 0 gates them, pending owner ok.
