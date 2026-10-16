# SESSIONS — ascent-companion

What each Claude session was doing, and where it stopped. **Generated —
do not hand-edit.** Run `node scripts/session.mjs board --write`, or let
`ship` do it. The record for one session is its own file under
`.claude/sessions/`; this page is only the index over them.

## In flight

| Session | Branch | Last active | Commits | Next step |
|---|---|---|---|---|
| [main](.claude/sessions/2026-10-11-main.md) | `(detached)` | 4d ago | 2 | — |
| [main](.claude/sessions/2026-10-02-main.md) | `(detached)` | 14d ago | 4 | — |
| [allbills-vendor-collapsed](.claude/sessions/2026-09-14-allbills-vendor-collapsed.md) | `claude/allbills-vendor-collapsed` | 23d ago | 40 | Watch the first monthly review after 77bbb2a: confirm email-bill-amount-mismatc… |
| [time-entry-jt-sync](.claude/sessions/2026-09-15-time-entry-jt-sync.md) | `claude/time-entry-jt-sync-6q3257` | 31d ago | 5 | Verify view-as-employee live: open /employee-time as admin, tap 'View another e… |
| [monthly-invoicing-summary](.claude/sessions/2026-09-10-monthly-invoicing-summary.md) | `claude/monthly-invoicing-summary-mfpunx` | 36d ago | 3 | Deploy the appscript side (./deploy.sh), then open /invoicing-summary and confi… |
| [billing-month-selector](.claude/sessions/2026-09-10-billing-month-selector.md) | `claude/billing-month-selector-o8rbtx` | 36d ago | 3 | after ./deploy.sh lands on appscript: push this to main, then set a month on ho… |
| [gemini-claude-transition-status](.claude/sessions/2026-09-09-gemini-claude-transition-status.md) | `claude/gemini-claude-transition-status-cib68c` | 37d ago | 1 | owner: delete GEMINI_KEY + GEMINI_MODEL from Vercel; decide whether ANTHROPIC_M… |
| [trip-recording-persistence](.claude/sessions/2026-09-08-trip-recording-persistence.md) | `claude/trip-recording-persistence-evilps` | 38d ago | 3 | verify on the phone: start a trip, force-quit the app, reopen — the trip should… |
| [ci-verify-job-failures](.claude/sessions/2026-09-06-ci-verify-job-failures.md) | `claude/ci-verify-job-failures-wcfpyk` | 40d ago | 1 | push this branch to remote main — main is still red until the Link fix lands th… |
| [ascent-building-theme](.claude/sessions/2026-09-06-ascent-building-theme.md) | `claude/ascent-building-theme-rz1o6h` | 40d ago | 6 | Tune the palettes in /theme on the phone, then paste the Copy CSS output back s… |
| [header-layout-redesign](.claude/sessions/2026-09-05-header-layout-redesign.md) | `claude/header-layout-redesign-xid33s` | 41d ago | 15 | rearrange the tracking-sheet action buttons for mobile and desktop — they read … |
| [timesheet-month-selection](.claude/sessions/2026-09-04-timesheet-month-selection.md) | `claude/timesheet-month-selection-2hih55` | 42d ago | 3 | none — month picker shipped; verify on the phone that the dropdown reads well n… |

## Parked

| Session | Branch | Parked | Picks up at |
|---|---|---|---|
| [ascent-security-analysis](.claude/sessions/2026-09-14-ascent-security-analysis.md) | `claude/ascent-security-analysis-m8fjif` | 32d ago | Owner merges PR #7 (git push origin origin/claude/ascent-security-analysis-m8fj… |

## Shipped

| Session | Shipped | Commits | What it did |
|---|---|---|---|
| [main](.claude/sessions/2026-09-03-main.md) | 2026-10-16 | 43 | — |
| [invoicing-email](.claude/sessions/2026-10-15-invoicing-email.md) | 2026-10-15 | 7 | One button on Tracking Sheets all-jobs that drafts the monthly Invoicing Packag… |
| [vendor-link](.claude/sessions/2026-10-15-vendor-link.md) | 2026-10-15 | 1 | Stuck vendor: link a bill's unmatched vendor name to an existing JobTread vendo… |
| [alljobs-card](.claude/sessions/2026-10-15-alljobs-card.md) | 2026-10-15 | 1 | — |
| [deploy-stamp](.claude/sessions/2026-10-15-deploy-stamp.md) | 2026-10-15 | 1 | — |
| [doc-access](.claude/sessions/2026-10-15-doc-access.md) | 2026-10-15 | 1 | — |
| [copy](.claude/sessions/2026-10-13-copy.md) | 2026-10-14 | 1 | — |
| [rail](.claude/sessions/2026-10-13-rail.md) | 2026-10-14 | 1 | — |
| [invoicing-rail](.claude/sessions/2026-10-13-invoicing-rail.md) | 2026-10-14 | 1 | — |
| [invoicing-menu](.claude/sessions/2026-10-13-invoicing-menu.md) | 2026-10-14 | 1 | — |
| [jobcard](.claude/sessions/2026-10-13-jobcard.md) | 2026-10-14 | 1 | — |
| [deposit-card](.claude/sessions/2026-10-12-deposit-card.md) | 2026-10-12 | 1 | Move the deposit card to the foot of the Tracking Sheets page |
| [deposit-parse](.claude/sessions/2026-10-11-deposit-parse.md) | 2026-10-12 | 1 | Deposit form: accept typed dollar figures with commas and $ |
| [unbilled](.claude/sessions/2026-10-11-unbilled.md) | 2026-10-12 | 1 | Ship the /unbilled rebuild: unbilled = bills and time on no client invoice |
| [deposit](.claude/sessions/2026-10-11-deposit.md) | 2026-10-12 | 2 | Simplify job deposits: Deposit (JobTread deposit invoice, or entered by hand) m… |
