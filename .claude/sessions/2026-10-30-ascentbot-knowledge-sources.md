---
slug: ascentbot-knowledge-sources
repo: ascent-companion
branch: claude/ascentbot-knowledge-sources-ad9sio
status: shipped
started: 2026-10-30T15:05:09Z
updated: 2026-10-30T15:05:31Z
goal: 
next: Ask the bot a money question in a job space as a Full-access user, and add a test person on Jobs only to confirm the bot declines money.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-30 15:05 · `238b820` companion: ascentbot answers money questions, with roles and an access page
  CODEBASE_MAP.md, src/app/api/ascentbot/route.ts, src/app/api/google-chat/route.ts, src/app/ascentbot/AscentBotAccess.tsx, src/app/ascentbot/page.tsx, src/db/index.ts, +11 more

## Notes
- 2026-10-30 15:05 — Financials, staff records and the office mailbox are bot areas; job knowledge is the base. Enforced by the tool set, not the prompt.
