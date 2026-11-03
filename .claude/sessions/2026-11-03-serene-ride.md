---
slug: serene-ride
repo: ascent-companion
branch: claude/serene-ride-r8v8me
status: shipped
started: 2026-11-03T00:09:24Z
updated: 2026-11-03T00:29:01Z
goal: 
next: confirm Turso call rate drops after deploy (Vercel outgoing_request to turso.io)
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-11-03 00:09 · `930f2e6` companion: stop edge and node fighting over the db schema marker
  src/auth.ts, src/db/index.ts, src/db/schemaFingerprint.test.ts
- 2026-11-03 00:29 · `3eb5b03` companion: say "just updated" on the loading screen after a deploy
  src/components/LoadingScreen.tsx, src/components/UpdateNotice.tsx

## Notes
