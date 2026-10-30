---
slug: ascentbot-knowledge-sources
repo: ascent-companion
branch: claude/ascentbot-knowledge-sources-ad9sio
status: shipped
started: 2026-10-30T15:05:09Z
updated: 2026-10-30T22:21:27Z
goal: 
next: Say '@AscentBot gold star for <name>' in a space and check the star keeps its shape.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-30 15:05 · `238b820` companion: ascentbot answers money questions, with roles and an access page
  CODEBASE_MAP.md, src/app/api/ascentbot/route.ts, src/app/api/google-chat/route.ts, src/app/ascentbot/AscentBotAccess.tsx, src/app/ascentbot/page.tsx, src/db/index.ts, +11 more
- 2026-10-30 17:54 · `1e09266` companion: log what each chat space message carries, to test email forwards
  src/lib/chatSync.ts
- 2026-10-30 18:34 · `9c65fcc` companion: ascentbot reads a pdf attached to an office email
  src/lib/botAccess.ts, src/lib/chatTools.ts, src/lib/fileReader.test.ts, src/lib/fileReader.ts, src/lib/googleChat.test.ts
- 2026-10-30 22:17 · `fcd88fd` companion: ascentbot answers "gold star" with a star
  src/app/api/google-chat/route.ts, src/lib/googleChat.test.ts, src/lib/googleChat.ts
- 2026-10-30 22:21 · `8deddc6` companion: make ascentbot's gold star a shooting star
  src/lib/googleChat.ts

## Notes
- 2026-10-30 15:05 — Financials, staff records and the office mailbox are bot areas; job knowledge is the base. Enforced by the tool set, not the prompt.
