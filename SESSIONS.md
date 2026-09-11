# SESSIONS — ascent-companion

What each Claude session was doing, and where it stopped. **Generated —
do not hand-edit.** Run `node scripts/session.mjs board --write`, or let
`ship` do it. The record for one session is its own file under
`.claude/sessions/`; this page is only the index over them.

## In flight

| Session | Branch | Last active | Commits | Next step |
|---|---|---|---|---|
| [monthly-invoicing-summary](.claude/sessions/2026-09-10-monthly-invoicing-summary.md) | `claude/monthly-invoicing-summary-mfpunx` | 32h ago | 3 | Deploy the appscript side (./deploy.sh), then open /invoicing-summary and confi… |
| [billing-month-selector](.claude/sessions/2026-09-10-billing-month-selector.md) | `claude/billing-month-selector-o8rbtx` | 34h ago | 3 | after ./deploy.sh lands on appscript: push this to main, then set a month on ho… |
| [gemini-claude-transition-status](.claude/sessions/2026-09-09-gemini-claude-transition-status.md) | `claude/gemini-claude-transition-status-cib68c` | 3d ago | 1 | owner: delete GEMINI_KEY + GEMINI_MODEL from Vercel; decide whether ANTHROPIC_M… |
| [trip-recording-persistence](.claude/sessions/2026-09-08-trip-recording-persistence.md) | `claude/trip-recording-persistence-evilps` | 3d ago | 3 | verify on the phone: start a trip, force-quit the app, reopen — the trip should… |
| [ci-verify-job-failures](.claude/sessions/2026-09-06-ci-verify-job-failures.md) | `claude/ci-verify-job-failures-wcfpyk` | 5d ago | 1 | push this branch to remote main — main is still red until the Link fix lands th… |
| [ascent-building-theme](.claude/sessions/2026-09-06-ascent-building-theme.md) | `claude/ascent-building-theme-rz1o6h` | 5d ago | 6 | Tune the palettes in /theme on the phone, then paste the Copy CSS output back s… |
| [header-layout-redesign](.claude/sessions/2026-09-05-header-layout-redesign.md) | `claude/header-layout-redesign-xid33s` | 6d ago | 15 | rearrange the tracking-sheet action buttons for mobile and desktop — they read … |
| [timesheet-month-selection](.claude/sessions/2026-09-04-timesheet-month-selection.md) | `claude/timesheet-month-selection-2hih55` | 7d ago | 3 | none — month picker shipped; verify on the phone that the dropdown reads well n… |

## Shipped

| Session | Shipped | Commits | What it did |
|---|---|---|---|
| [vendor-bills-group-by](.claude/sessions/2026-09-11-vendor-bills-group-by.md) | 2026-09-11 | 1 | group the tracking sheet's month of vendor bills by vendor |
| [billing-month](.claude/sessions/2026-09-10-billing-month.md) | 2026-09-11 | 43 | — |
| [jobtread-qbo-sales-tax](.claude/sessions/2026-09-05-jobtread-qbo-sales-tax.md) | 2026-09-10 | 64 | bill move: background + Drive re-file + real error; buyback picker dialog; appr… |
| [tracking-sheet-donut-charts](.claude/sessions/2026-09-10-tracking-sheet-donut-charts.md) | 2026-09-10 | 2 | — |
| [admin-actions-menu](.claude/sessions/2026-09-10-admin-actions-menu.md) | 2026-09-10 | 1 | — |
| [bill-due-date-selector](.claude/sessions/2026-09-09-bill-due-date-selector.md) | 2026-09-09 | 2 | — |
| [ipad-vertical-admin-home](.claude/sessions/2026-09-09-ipad-vertical-admin-home.md) | 2026-09-09 | 1 | A vertical iPad layout for the admin and office home screen. |
| [lead-email-capture-tagging](.claude/sessions/2026-09-08-lead-email-capture-tagging.md) | 2026-09-08 | 3 | — |
| [time-entry-notes-persist](.claude/sessions/2026-09-08-time-entry-notes-persist.md) | 2026-09-08 | 1 | — |
| [daily-digest-to-todos](.claude/sessions/2026-09-08-daily-digest-to-todos.md) | 2026-09-08 | 2 | — |
| [help-page-ste-100](.claude/sessions/2026-09-08-help-page-ste-100.md) | 2026-09-08 | 2 | — |
| [leads-panel-admin-home](.claude/sessions/2026-09-08-leads-panel-admin-home.md) | 2026-09-08 | 5 | — |
| [pwa-push-notifications-phone](.claude/sessions/2026-09-07-pwa-push-notifications-phone.md) | 2026-09-07 | 3 | in-app banner notice system: office+admin authoring, scheduled windows, group +… |
| [pwa-dock-homescreen-logo](.claude/sessions/2026-09-07-pwa-dock-homescreen-logo.md) | 2026-09-07 | 3 | — |
| [tracking-sheet-button-audit](.claude/sessions/2026-09-06-tracking-sheet-button-audit.md) | 2026-09-06 | 7 | audit the tracking sheet page's buttons and re-lay them out for desktop workflow |
