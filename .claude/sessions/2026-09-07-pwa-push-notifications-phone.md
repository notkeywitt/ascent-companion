---
slug: pwa-push-notifications-phone
repo: ascent-companion
branch: claude/pwa-push-notifications-phone-sxpzzj
status: in-progress
started: 2026-09-07T21:25:15Z
updated: 2026-09-07T21:25:55Z
goal: in-app banner notice system: office+admin authoring, scheduled windows, group + person targeting
next: Owner check: post one banner to Everyone from /notices and confirm it lands on a phone. Then decide whether office should be able to reach a whole role's phones via push (held this session).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->

## Notes
- 2026-09-07 21:25 — Held the PWA push work: no service worker, no VAPID keys, no push_subscriptions table shipped. Answered the question in chat instead.
- 2026-09-07 21:25 — Extended the existing notices system rather than building a second one: same table, same per-user read marks, same popup, plus a banner surface.
- 2026-09-07 21:25 — Legacy audience_type role/user rows are folded into the new role/email lists by src/lib/notices.ts, so no data migration. Existing rows are pinned display='popup' in the ALTER so no live notice changes surface.
- 2026-09-07 21:25 — Probed the ALTER path on a temp libSQL file (old shape -> migrated -> re-run no-op) and ran a 27-check end-to-end pass against next dev with minted Auth.js cookies: gate, targeting, schedule edges, dismiss, read counts.
