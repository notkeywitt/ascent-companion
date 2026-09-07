---
slug: pwa-push-notifications-phone
repo: ascent-companion
branch: claude/pwa-push-notifications-phone-sxpzzj
status: shipped
started: 2026-09-07T21:25:15Z
updated: 2026-09-07T21:57:24Z
goal: in-app banner notice system: office+admin authoring, scheduled windows, group + person targeting
next: Owner check on a desktop: Home -> Desktop alerts -> Turn on -> Send a test, then post a notice from another device and confirm the toast lands while the tab is in the background.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-07 21:26 · `22da358` companion: in-app notice banners, scheduled and targeted
  CODEBASE_MAP.md, USER_MANUAL.md, src/app/admin/NoticesPanel.tsx, src/app/admin/page.tsx, src/app/api/admin/notices/route.ts, src/app/api/notices/route.ts, +11 more
- 2026-09-07 21:26 · `21cd8fe` companion: log session 2026-09-07-pwa-push-notifications-phone

## Notes
- 2026-09-07 21:25 — Held the PWA push work: no service worker, no VAPID keys, no push_subscriptions table shipped. Answered the question in chat instead.
- 2026-09-07 21:25 — Extended the existing notices system rather than building a second one: same table, same per-user read marks, same popup, plus a banner surface.
- 2026-09-07 21:25 — Legacy audience_type role/user rows are folded into the new role/email lists by src/lib/notices.ts, so no data migration. Existing rows are pinned display='popup' in the ALTER so no live notice changes surface.
- 2026-09-07 21:25 — Probed the ALTER path on a temp libSQL file (old shape -> migrated -> re-run no-op) and ran a 27-check end-to-end pass against next dev with minted Auth.js cookies: gate, targeting, schedule edges, dismiss, read counts.
- 2026-09-07 21:57 — Desktop: banners already rendered there, but max-w-2xl centred over home's xl full-bleed launcher looked like an island. Banner stack now mirrors the home container (xl:max-w-none xl:px-8) with the content capped at 5xl so the dismiss stays near its sentence.
- 2026-09-07 21:57 — Added OS toasts via the browser Notification API (no service worker, no VAPID): only for notices arriving while the app is a background tab, per-device opt-in on Home, self-hiding where the API is absent (every iPhone). planToasts is pure and tested; verified in Chromium end to end.
