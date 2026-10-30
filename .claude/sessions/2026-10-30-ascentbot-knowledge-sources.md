---
slug: ascentbot-knowledge-sources
repo: ascent-companion
branch: claude/ascentbot-knowledge-sources-ad9sio
status: shipped
started: 2026-10-30T15:05:09Z
updated: 2026-10-30T18:34:36Z
goal: 
next: Ask AscentBot about a PDF attached to an office email (e.g. the Sea Glass window washing estimate) and confirm it reads it.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-30 15:05 · `238b820` companion: ascentbot answers money questions, with roles and an access page
  CODEBASE_MAP.md, src/app/api/ascentbot/route.ts, src/app/api/google-chat/route.ts, src/app/ascentbot/AscentBotAccess.tsx, src/app/ascentbot/page.tsx, src/db/index.ts, +11 more
- 2026-10-30 17:54 · `1e09266` companion: log what each chat space message carries, to test email forwards
  src/lib/chatSync.ts
- 2026-10-30 18:34 · `9c65fcc` companion: ascentbot reads a pdf attached to an office email
  src/lib/botAccess.ts, src/lib/chatTools.ts, src/lib/fileReader.test.ts, src/lib/fileReader.ts, src/lib/googleChat.test.ts

## Notes
- 2026-10-30 15:05 — Financials, staff records and the office mailbox are bot areas; job knowledge is the base. Enforced by the tool set, not the prompt.
