# SESSIONS — ascent-companion

What each Claude session was doing, and where it stopped. **Generated —
do not hand-edit.** Run `node scripts/session.mjs board --write`, or let
`ship` do it. The record for one session is its own file under
`.claude/sessions/`; this page is only the index over them.

## In flight

| Session | Branch | Last active | Commits | Next step |
|---|---|---|---|---|
| [main](.claude/sessions/2026-10-02-main.md) | `(detached)` | 5d ago | 4 | — |
| [allbills-vendor-collapsed](.claude/sessions/2026-09-14-allbills-vendor-collapsed.md) | `claude/allbills-vendor-collapsed` | 14d ago | 40 | Watch the first monthly review after 77bbb2a: confirm email-bill-amount-mismatc… |
| [time-entry-jt-sync](.claude/sessions/2026-09-15-time-entry-jt-sync.md) | `claude/time-entry-jt-sync-6q3257` | 22d ago | 5 | Verify view-as-employee live: open /employee-time as admin, tap 'View another e… |
| [monthly-invoicing-summary](.claude/sessions/2026-09-10-monthly-invoicing-summary.md) | `claude/monthly-invoicing-summary-mfpunx` | 28d ago | 3 | Deploy the appscript side (./deploy.sh), then open /invoicing-summary and confi… |
| [billing-month-selector](.claude/sessions/2026-09-10-billing-month-selector.md) | `claude/billing-month-selector-o8rbtx` | 28d ago | 3 | after ./deploy.sh lands on appscript: push this to main, then set a month on ho… |
| [gemini-claude-transition-status](.claude/sessions/2026-09-09-gemini-claude-transition-status.md) | `claude/gemini-claude-transition-status-cib68c` | 29d ago | 1 | owner: delete GEMINI_KEY + GEMINI_MODEL from Vercel; decide whether ANTHROPIC_M… |
| [trip-recording-persistence](.claude/sessions/2026-09-08-trip-recording-persistence.md) | `claude/trip-recording-persistence-evilps` | 29d ago | 3 | verify on the phone: start a trip, force-quit the app, reopen — the trip should… |
| [ci-verify-job-failures](.claude/sessions/2026-09-06-ci-verify-job-failures.md) | `claude/ci-verify-job-failures-wcfpyk` | 31d ago | 1 | push this branch to remote main — main is still red until the Link fix lands th… |
| [ascent-building-theme](.claude/sessions/2026-09-06-ascent-building-theme.md) | `claude/ascent-building-theme-rz1o6h` | 32d ago | 6 | Tune the palettes in /theme on the phone, then paste the Copy CSS output back s… |
| [header-layout-redesign](.claude/sessions/2026-09-05-header-layout-redesign.md) | `claude/header-layout-redesign-xid33s` | 32d ago | 15 | rearrange the tracking-sheet action buttons for mobile and desktop — they read … |
| [timesheet-month-selection](.claude/sessions/2026-09-04-timesheet-month-selection.md) | `claude/timesheet-month-selection-2hih55` | 33d ago | 3 | none — month picker shipped; verify on the phone that the dropdown reads well n… |

## Parked

| Session | Branch | Parked | Picks up at |
|---|---|---|---|
| [ascent-security-analysis](.claude/sessions/2026-09-14-ascent-security-analysis.md) | `claude/ascent-security-analysis-m8fjif` | 24d ago | Owner merges PR #7 (git push origin origin/claude/ascent-security-analysis-m8fj… |

## Shipped

| Session | Shipped | Commits | What it did |
|---|---|---|---|
| [finding-row](.claude/sessions/2026-10-08-finding-row.md) | 2026-10-08 | 1 | Job check results (Check this job / Check all Jobs): each finding links to its … |
| [desktop-icon-iphone-chrome](.claude/sessions/2026-10-07-desktop-icon-iphone-chrome.md) | 2026-10-07 | 2 | — |
| [alljobs](.claude/sessions/2026-10-07-alljobs.md) | 2026-10-07 | 1 | Tracking Sheets all-jobs view: a top row of buttons — Sync to Tracking Sheets (… |
| [labor-import-code-rates](.claude/sessions/2026-10-07-labor-import-code-rates.md) | 2026-10-07 | 1 | Labor Import: pick pay type per worker x job x cost code, with the time entries… |
| [ascent-clock-out-issue](.claude/sessions/2026-10-07-ascent-clock-out-issue.md) | 2026-10-07 | 2 | stop a clock-in from closing a running JobTread clock |
| [labor-report](.claude/sessions/2026-10-05-labor-report.md) | 2026-10-05 | 1 | Tracking Sheets job workbench: Create Labor Report in Drive in the save bar's c… |
| [month-total-no-tax](.claude/sessions/2026-10-05-month-total-no-tax.md) | 2026-10-05 | 1 | Tracking Sheets job card month total excludes 88 80 00 sales tax |
| [bills-donut-no-tax](.claude/sessions/2026-10-05-bills-donut-no-tax.md) | 2026-10-05 | 1 | Tracking Sheets bills ring excludes 88 80 00 sales tax |
| [jobtread-deposits-payments](.claude/sessions/2026-10-05-jobtread-deposits-payments.md) | 2026-10-05 | 5 | Deposits and client payments (DEPOSITS_PLAN.md): Stages 1, 2 and half of 1b shi… |
| [today-home-label-change](.claude/sessions/2026-10-03-today-home-label-change.md) | 2026-10-03 | 6 | — |
| [time-card-autostage](.claude/sessions/2026-10-02-time-card-autostage.md) | 2026-10-02 | 6 | Tracking Sheets time card: stage edits as they are made (like bills), remove th… |
| [bill-void](.claude/sessions/2026-10-02-bill-void.md) | 2026-10-02 | 1 | Delete button on the bill card: void in JobTread, remove sheet rows, trash PDF … |
| [vendor-billtype-fix](.claude/sessions/2026-10-02-vendor-billtype-fix.md) | 2026-10-02 | 1 | Fix vendor Bill Type default write: updateAccount read-back needs its id |
| [cost-code](.claude/sessions/2026-10-02-cost-code.md) | 2026-10-02 | 2 | Default cost code per employee + job, set on Pay Rates, selected when a job is … |
| [pay-type](.claude/sessions/2026-10-02-pay-type.md) | 2026-10-02 | 1 | Default pay type per employee + job + cost code: table edited on Pay Rates, app… |
