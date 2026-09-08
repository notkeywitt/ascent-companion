---
slug: daily-digest-to-todos
repo: ascent-companion
branch: claude/daily-digest-to-todos-kosc2a
status: shipped
started: 2026-09-08T05:31:42Z
updated: 2026-09-08T12:52:03Z
goal: 
next: on the phone: confirm the To Dos list is your own and a row opens the right to-do in JobTread
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-08 05:32 · `42f2879` companion: turn the daily digest card into To Dos, on JobTread's own to-dos
  CODEBASE_MAP.md, src/app/api/todos/route.ts, src/app/page.tsx, src/components/DailyDigest.tsx, src/components/HomeTodos.tsx, src/components/TileLauncher.tsx, +3 more
- 2026-09-08 12:52 · `6aa95a4` companion: fix whose to-dos the card shows, and where a to-do links
  src/app/api/todos/route.ts, src/components/HomeTodos.tsx, src/lib/digest/checks/jobtreadTodos.ts, src/lib/jobtread.ts, src/lib/jtLinks.ts

## Notes
- 2026-09-08 05:31 — The Daily Digest card is now To Dos: live JobTread to-dos + a create form on top, the digest's other categories under. Dropped the written brief and the reply/reminder box.
- 2026-09-08 05:31 — createTask input shape confirmed by introspecting root.createTask.$ (2026-09-08). The WRITE itself is not live-probed — the create+delete probe was blocked in this environment.
- 2026-09-08 05:31 — The stored jobtread-todos check still RUNS each morning but is no longer drawn (HIDDEN_CHECKS) — the live list above is the same data, fresh. Turning the check off in digest settings is a separate owner decision.
- 2026-09-08 12:51 — To-do links now go to /to-dos?taskId= (the to-do list, opened on that to-do) — jtToDoUrl in lib/jtLinks.ts. The job home page was the wrong destination, in the card AND in the digest's jobtread-todos check.
- 2026-09-08 12:51 — The 'mine' match failed because it trusted the Employee roster link; an unlinked account matched nobody and the card showed unassigned work. Identity is now the signed-in EMAIL matched against JobTread memberships (findMemberByEmail), roster link as fallback. Mine and unclaimed are separate, labelled lists.
