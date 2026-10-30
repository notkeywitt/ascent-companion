---
slug: ascentbot-architecture
repo: ascent-companion
branch: claude/ascentbot-architecture-08o3ez
status: shipped
started: 2026-10-28T05:54:35Z
updated: 2026-10-30T17:22:46Z
goal: 
next: REMIND OWNER — AscentBot phase 2: read every message in a job space (service account, admin-approved chat.app.messages.readonly, spaces.messages.list; chat_turns.thread already kept). Also: check [chat:google-chat] timing logs after the first job-space answers.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-28 05:54 · `7bd0eaa` companion: time each claude round and tool, run a round's tools in parallel
  src/app/api/google-chat/route.ts, src/lib/anthropic.ts
- 2026-10-28 14:29 · `a74b87a` companion: ascentbot answers job decisions and schedule, remembers each job space
  CODEBASE_MAP.md, src/app/api/google-chat/route.ts, src/db/index.ts, src/db/schema.ts, src/lib/anthropic.ts, src/lib/chatMemory.ts, +4 more
- 2026-10-28 17:05 · `9a6d477` companion: ascentbot finds a job when the name comes with "job" or extra words
  src/lib/googleChat.test.ts, src/lib/googleChat.ts
- 2026-10-29 20:30 · `72ef214` companion: ascentbot searches employees, vendors, projects and other office records
  src/lib/chatTools.ts, src/lib/googleChat.ts
- 2026-10-29 22:16 · `fc11393` companion: ascentbot looks up staff details instead of refusing them
  src/lib/googleChat.ts
- 2026-10-30 14:08 · `e72aa39` companion: ascentbot lists calendar days in order, drops preamble, retries refusals
  src/app/api/google-chat/route.ts, src/lib/chatTools.ts, src/lib/googleChat.test.ts, src/lib/googleChat.ts
- 2026-10-30 14:21 · `a25a84e` companion: ascentbot "start over", and retry any answer that looked nothing up
  src/app/api/google-chat/route.ts, src/lib/anthropic.test.ts, src/lib/anthropic.ts, src/lib/chatMemory.ts, src/lib/googleChat.test.ts, src/lib/googleChat.ts
- 2026-10-30 17:22 · `6791246` companion: ascentbot splits lists joined by any bullet dot, and logs what it sent
  src/app/api/google-chat/route.ts, src/lib/googleChat.test.ts, src/lib/googleChat.ts

## Notes
- 2026-10-28 14:29 — Owner (2026-10-28): AscentBot is for job decisions and details (tile, plumber date), not money. Team uses plain language, no slash commands. Phase 2 the owner wants later: read EVERY message in a job space, not only @mentions — needs a Chat service account + Workspace-admin approval of chat.app.messages.readonly + Chat API spaces.messages.list. Remind the owner.
