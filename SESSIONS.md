# SESSIONS — ascent-companion

What each Claude session was doing, and where it stopped. **Generated —
do not hand-edit.** Run `node scripts/session.mjs board --write`, or let
`ship` do it. The record for one session is its own file under
`.claude/sessions/`; this page is only the index over them.

## In flight

| Session | Branch | Last active | Commits | Next step |
|---|---|---|---|---|
| [allbills-vendor-collapsed](.claude/sessions/2026-09-14-allbills-vendor-collapsed.md) | `claude/allbills-vendor-collapsed` | 6d ago | 40 | Watch the first monthly review after 77bbb2a: confirm email-bill-amount-mismatc… |
| [time-entry-jt-sync](.claude/sessions/2026-09-15-time-entry-jt-sync.md) | `claude/time-entry-jt-sync-6q3257` | 14d ago | 5 | Verify view-as-employee live: open /employee-time as admin, tap 'View another e… |
| [monthly-invoicing-summary](.claude/sessions/2026-09-10-monthly-invoicing-summary.md) | `claude/monthly-invoicing-summary-mfpunx` | 20d ago | 3 | Deploy the appscript side (./deploy.sh), then open /invoicing-summary and confi… |
| [billing-month-selector](.claude/sessions/2026-09-10-billing-month-selector.md) | `claude/billing-month-selector-o8rbtx` | 20d ago | 3 | after ./deploy.sh lands on appscript: push this to main, then set a month on ho… |
| [gemini-claude-transition-status](.claude/sessions/2026-09-09-gemini-claude-transition-status.md) | `claude/gemini-claude-transition-status-cib68c` | 21d ago | 1 | owner: delete GEMINI_KEY + GEMINI_MODEL from Vercel; decide whether ANTHROPIC_M… |
| [trip-recording-persistence](.claude/sessions/2026-09-08-trip-recording-persistence.md) | `claude/trip-recording-persistence-evilps` | 21d ago | 3 | verify on the phone: start a trip, force-quit the app, reopen — the trip should… |
| [ci-verify-job-failures](.claude/sessions/2026-09-06-ci-verify-job-failures.md) | `claude/ci-verify-job-failures-wcfpyk` | 23d ago | 1 | push this branch to remote main — main is still red until the Link fix lands th… |
| [ascent-building-theme](.claude/sessions/2026-09-06-ascent-building-theme.md) | `claude/ascent-building-theme-rz1o6h` | 24d ago | 6 | Tune the palettes in /theme on the phone, then paste the Copy CSS output back s… |
| [header-layout-redesign](.claude/sessions/2026-09-05-header-layout-redesign.md) | `claude/header-layout-redesign-xid33s` | 24d ago | 15 | rearrange the tracking-sheet action buttons for mobile and desktop — they read … |
| [timesheet-month-selection](.claude/sessions/2026-09-04-timesheet-month-selection.md) | `claude/timesheet-month-selection-2hih55` | 25d ago | 3 | none — month picker shipped; verify on the phone that the dropdown reads well n… |

## Parked

| Session | Branch | Parked | Picks up at |
|---|---|---|---|
| [ascent-security-analysis](.claude/sessions/2026-09-14-ascent-security-analysis.md) | `claude/ascent-security-analysis-m8fjif` | 16d ago | Owner merges PR #7 (git push origin origin/claude/ascent-security-analysis-m8fj… |

## Shipped

| Session | Shipped | Commits | What it did |
|---|---|---|---|
| [board-split](.claude/sessions/2026-09-29-board-split.md) | 2026-09-30 | 14 | Audit finding 01: split src/app/trackingsheet/Board.tsx by job, one block per p… |
| [bill-expense-save](.claude/sessions/2026-09-29-bill-expense-save.md) | 2026-09-29 | 1 | Bill/Expense toggle stages until Save on the tracking sheet; Push as Expense se… |
| [navigation-stage-3](.claude/sessions/2026-09-29-navigation-stage-3.md) | 2026-09-29 | 5 | NAVIGATION_PLAN.md Stage 3: Not in JobTread merge, Code this bill on Email Invo… |
| [navigation-stage-1](.claude/sessions/2026-09-29-navigation-stage-1.md) | 2026-09-29 | 11 | NAVIGATION_PLAN.md Stage 1: one workspace list feeding bar, menu, search; tab s… |
| [tracking-bill](.claude/sessions/2026-09-29-tracking-bill.md) | 2026-09-29 | 1 | Tracking Sheets job view: open a bill's coding card beside its row instead of s… |
| [specs](.claude/sessions/2026-09-29-specs.md) | 2026-09-29 | 3 | Specifications: import an architect's spec selection list PDF per job, show it … |
| [navigation-stage-0](.claude/sessions/2026-09-29-navigation-stage-0.md) | 2026-09-29 | 3 | NAVIGATION_PLAN.md Stage 0: gate /api/time-off/import and /api/labor-report, re… |
| [ascent-app-simplify](.claude/sessions/2026-09-29-ascent-app-simplify.md) | 2026-09-29 | 1 | Evaluate the app's pages, menus and names; propose a simpler navigation (fewer … |
| [budget](.claude/sessions/2026-09-24-budget.md) | 2026-09-28 | 27 | Tracking sheet estimate to JobTread budget import CSV: /budget-import page over… |
| [lopezrocks-mobile-accessibility](.claude/sessions/2026-09-27-lopezrocks-mobile-accessibility.md) | 2026-09-27 | 2 | LopezRocks, the island community board, as a phone reader page in the app |
| [ascent-companion-ci-failure](.claude/sessions/2026-09-12-ascent-companion-ci-failure.md) | 2026-09-14 | 3 | fix the red CI lint error in trackingsheet/Board.tsx |
| [vendor-bills-group-by](.claude/sessions/2026-09-11-vendor-bills-group-by.md) | 2026-09-11 | 1 | group the tracking sheet's month of vendor bills by vendor |
| [billing-month](.claude/sessions/2026-09-10-billing-month.md) | 2026-09-11 | 43 | — |
| [jobtread-qbo-sales-tax](.claude/sessions/2026-09-05-jobtread-qbo-sales-tax.md) | 2026-09-10 | 64 | bill move: background + Drive re-file + real error; buyback picker dialog; appr… |
| [tracking-sheet-donut-charts](.claude/sessions/2026-09-10-tracking-sheet-donut-charts.md) | 2026-09-10 | 2 | — |
