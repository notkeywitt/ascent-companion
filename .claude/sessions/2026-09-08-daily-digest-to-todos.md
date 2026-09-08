---
slug: daily-digest-to-todos
repo: ascent-companion
branch: claude/daily-digest-to-todos-kosc2a
status: in-progress
started: 2026-09-08T05:31:42Z
updated: 2026-09-08T05:32:10Z
goal: 
next: on the phone: add a to-do from the card and confirm it lands on the right job in JobTread; then decide whether digest_todos (Reminders) and /api/digest/reply get retired
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-08 05:32 · `42f2879` companion: turn the daily digest card into To Dos, on JobTread's own to-dos
  CODEBASE_MAP.md, src/app/api/todos/route.ts, src/app/page.tsx, src/components/DailyDigest.tsx, src/components/HomeTodos.tsx, src/components/TileLauncher.tsx, +3 more

## Notes
- 2026-09-08 05:31 — The Daily Digest card is now To Dos: live JobTread to-dos + a create form on top, the digest's other categories under. Dropped the written brief and the reply/reminder box.
- 2026-09-08 05:31 — createTask input shape confirmed by introspecting root.createTask.$ (2026-09-08). The WRITE itself is not live-probed — the create+delete probe was blocked in this environment.
- 2026-09-08 05:31 — The stored jobtread-todos check still RUNS each morning but is no longer drawn (HIDDEN_CHECKS) — the live list above is the same data, fresh. Turning the check off in digest settings is a separate owner decision.
