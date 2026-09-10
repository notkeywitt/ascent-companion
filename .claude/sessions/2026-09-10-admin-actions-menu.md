---
slug: admin-actions-menu
repo: ascent-companion
branch: claude/admin-actions-menu-oltvr7
status: shipped
started: 2026-09-10T13:48:49Z
updated: 2026-09-10T13:49:16Z
goal: 
next: Watch for the office's read on the All Pages grouping — the two pages AREAS never listed (Jobs, Tracking Sheet) are new to that list and may want different groups.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-10 13:49 · `95c9eb2` companion: replace admin actions with an all-pages menu
  CODEBASE_MAP.md, src/app/api/admin/pages-menu/route.ts, src/app/layout.tsx, src/app/page.tsx, src/components/AdminActionBar.tsx, src/components/AllPagesMenu.tsx, +5 more

## Notes
- 2026-09-10 13:48 — Replaced the home page's Admin Actions bar with an All Pages menu: one collapsible list of every page, grouped by function, office+admin. Script jobs stay on /actions.
- 2026-09-10 13:48 — Catalog is DERIVED (AREAS + every remaining view with a real page) so a new page joins the menu on its own; a saved layout stores view ids only and cannot hide a page.
