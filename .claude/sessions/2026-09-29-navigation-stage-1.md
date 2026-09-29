---
slug: navigation-stage-1
repo: ascent-companion
branch: claude/navigation-stage-1
status: shipped
started: 2026-09-29T18:14:02Z
updated: 2026-09-29T19:25:29Z
goal: NAVIGATION_PLAN.md Stage 1: one workspace list feeding bar, menu, search; tab strips; remove the other menus; label renames
next: Stage 1 remainder needs owner go: iPad left rail + desktop sidebar (touches #app-shell and 5 fixed bottom bars), Help sections by workspace, per-person pinned bar slot. Then stage 2 (Today queue).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-29 11:14 · `357b9f9` companion: give every role app feedback, record owner answers
  NAVIGATION_PLAN.md, src/app/api/feature-requests/[id]/route.ts, src/app/requests/page.tsx, src/lib/views.ts
- 2026-09-29 12:11 · `9a19abe` companion: one workspace list for the menu, bar and search
  CLAUDE.md, CODEBASE_MAP.md, next.config.mjs, src/app/api/admin/home-layout/route.ts, src/app/api/admin/pages-menu/route.ts, src/app/layout.tsx, +28 more
- 2026-09-29 12:16 · `ec3e41d` companion: tab strip that carries the job and month
  CODEBASE_MAP.md, src/app/invoice-review/InvoiceReview.tsx, src/app/invoice-review/page.tsx, src/app/invoicing-summary/page.tsx, src/app/labor-review/LaborReview.tsx, src/app/layout.tsx, +6 more
- 2026-09-29 12:19 · `1ef7de4` companion: rename pages to the navigation plan's names
  src/app/clients/ClientsBrowser.tsx, src/app/expenditure-history/ExpenditureBrowser.tsx, src/app/expenditure-history/page.tsx, src/app/global-error.tsx, src/app/help/HelpBrowser.tsx, src/app/jobs/JobsBrowser.tsx, +13 more
- 2026-09-29 12:21 · `a1bb8df` companion: record stage 1 status in the navigation plan
  NAVIGATION_PLAN.md
- 2026-09-29 12:25 · `cfb19fc` companion: pin one page to the bottom bar
  src/components/AppMenu.tsx, src/components/TabBar.tsx, src/lib/help.ts, src/lib/workspaces.test.ts, src/lib/workspaces.ts

## Notes
- 2026-09-29 19:21 — Stage 1 shipped in 4 slices: app feedback for all roles, workspaces.ts + menu + bar, tab strip with ym/jobId, renames. Headless Chrome screenshots of dev pages hang (live-data fetches); chrome-devtools MCP held by another session, so layout is unverified visually.
