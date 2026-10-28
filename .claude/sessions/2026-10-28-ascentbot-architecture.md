---
slug: ascentbot-architecture
repo: ascent-companion
branch: claude/ascentbot-architecture-08o3ez
status: parked
started: 2026-10-28T05:54:35Z
updated: 2026-10-28T14:29:57Z
goal: 
next: REMIND OWNER — AscentBot phase 2: read every message in a job space (service account, admin-approved chat.app.messages.readonly, spaces.messages.list; chat_turns.thread already kept). Also: check [chat:google-chat] timing logs after the first job-space answers.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-28 05:54 · `7bd0eaa` companion: time each claude round and tool, run a round's tools in parallel
  src/app/api/google-chat/route.ts, src/lib/anthropic.ts
- 2026-10-28 14:29 · `a74b87a` companion: ascentbot answers job decisions and schedule, remembers each job space
  CODEBASE_MAP.md, src/app/api/google-chat/route.ts, src/db/index.ts, src/db/schema.ts, src/lib/anthropic.ts, src/lib/chatMemory.ts, +4 more

## Notes
- 2026-10-28 14:29 — Owner (2026-10-28): AscentBot is for job decisions and details (tile, plumber date), not money. Team uses plain language, no slash commands. Phase 2 the owner wants later: read EVERY message in a job space, not only @mentions — needs a Chat service account + Workspace-admin approval of chat.app.messages.readonly + Chat API spaces.messages.list. Remind the owner.
