# OVERHAUL_PLAN.md — development platform, performance, design, workflow

Status: in progress — 2026-11-13

Seven phases. Each phase fits one session unless marked. Phase 1 comes first
because it makes every later phase cheaper. Phases 2 and 3 can then run in
parallel. Read 2026-11-13 against the working tree; every figure below was
measured that day.

## What the review found

| Area | Finding | Evidence |
|---|---|---|
| Dev process | 61% of commits are session-ledger commits | 1013 of 1659 commits in 60 days |
| Dev process | Parallel sessions share one folder and block each other | 11 of 24 active days overlapped; 33 of 59 sessions hit a rejected push or ref lock; 31 hit a conflict |
| Dev process | Shipping costs more tool calls than editing | edit 15%, verify 29%, git and ship 56% |
| Dev process | Every tweak is its own production deploy | 100 Vercel deployments in under 4 days, 76 to production, 39 within 5 minutes of the one before |
| Dev process | Each push builds three times | local pre-push hook, GitHub CI, Vercel |
| Tokens | Opus writes 94% of messages; sessions run long | median 8.8M tokens per session, p90 48.6M |
| Performance | Home is the heaviest page | 466 KB first load; 25 to 30 requests on mount |
| Performance | 57 of 61 pages show nothing until the browser fetches | no shared client cache; no per-page loading skeletons |
| Performance | Field staff download Home, then get redirected | three steps before the clock shows |
| Performance | Apps Script calls have no cache | 2 to 10 seconds on every job open, Leads open, Home load |
| Navigation | 61 pages; `/trackingsheet` and the Jobs Hub link into each other | about 30 links still point at the old page |
| Navigation | 13 different menu and dropdown builds | no shared menu, popover or sheet primitive |
| Notices | about 24 notice surfaces, 5 dismissal stores, 6 looks | `Banner` has no dismiss and no action slot |
| Invoice check | 43 finding kinds; fixes live in about 6 places | none can be fixed from the findings list |
| EOM | 14 to 18 taps per job per month; 6 to 8 carry no decision | most duplicate a timer that already runs |
| Touch and type | Inputs are 14px (iOS zooms); small buttons are 36px; toggle is 20px | targets: 16px, 44px, 24px |
| Metrics | Vercel Web Analytics is off. The app logs visits to `usage_events` (Admin → Activity), but only in the production database | not readable from a dev machine |

## Rules for every phase

- One phase, one session, one worktree (a private copy of the repo folder).
- Start each session with: "Read docs/plans/OVERHAUL_PLAN.md, do phase N."
- A step marked **sign-off** touches auth, a write gate or a JobTread write
  path. Stop and ask before that step.
- No new JobTread write path without the owner's ok. Never delete a bill.
- Tick the checklist in this file as steps land. Delete this file when all
  phases are done; move surviving rules to the doc that owns the topic.

## Model guide

| Work | Model |
|---|---|
| Small tweaks, link fixes, primitive rollout, mechanical refactors | Sonnet 5.5 |
| Design decisions, schema design, the lander script, anything marked sign-off | Opus 5.5 |
| Search and inventory subagents | Haiku 5.5 |

Set Sonnet as the default model in `.claude/settings.json`. Switch to Opus only
for the phases marked Opus below.

---

## Phase 1 — Development platform (Opus, 1 session, do first)

Goal: the owner never sees git. Tweaks queue up. One deploy carries many tweaks.

### 1.1 Retire the committed session ledger

- [x] Remove `.githooks/post-commit`, the Stop hook, and the ledger steps in `scripts/ship.sh`.
- [x] Remove `SESSIONS.md`, `.claude/sessions/`, `scripts/session.mjs`, `src/lib/sessionLog.generated.json`.
- [x] `src/app/changelog/page.tsx` reads the generated log. Feed it from `git log` at build time instead.
- [x] "Where did I leave off" comes from the release queue (1.4) and `git log`.

This removes the "dirty tree" and "post-commit hook appended a row" messages at
the source. It also removes 61% of commits.

### 1.2 One worktree per session

- [x] SessionStart hook: when the session starts in the main folder, create a worktree and work there.
- [x] `scripts/dev.sh`: start the dev server on a free port and print the URL.
- [x] The main folder stays the owner's own. No session edits it.

Two sessions can then change the same file at the same time. They meet only in
the lander (1.4), which is the one place built to handle it.

### 1.3 `npm run ship` puts work in a queue

- [x] `ship` runs typecheck and tests (seconds), commits, and pushes the branch to `ready/<name>`.
- [x] `ship` never rebases and never pushes `main`.
- [x] The local pre-push hook keeps one job: refuse a direct push to `main`.

### 1.4 The lander (a GitHub Action that merges the queue)

- [x] One run at a time. A push to `ready/**` starts it. Pushes that arrive during a run wait for the next run, so they batch on their own.
- [x] Each run: take every `ready/*` branch, oldest first. Merge each onto `main`. Run typecheck, tests, build and lint once. Push `main` once.
- [x] A branch that conflicts or fails moves to `stuck/<name>` with the reason. The rest still land.
- [x] SessionStart reports stuck branches. That session rebases and re-queues them.
- [x] Remove the CI run on `main` pushes; the lander already verified that commit.
- [x] Vercel "Ignored Build Step": build only `main` and `preview`.

Result: one build in CI and one on Vercel per batch, instead of three per tweak.

GitHub's own merge queue needs pull requests and is likely unavailable on a
private personal repo. The lander is about 60 lines of shell.

### 1.5 Phone review before production — **sign-off**

- [x] One stable preview address on a `preview` branch. "Show me on my phone" pushes the session's branch there.
- [ ] Google sign-in needs that address registered. This changes auth config.
- [x] Confirm in Vercel that the Preview environment has `COMPANION_WRITES_ENABLED` off.

Desktop review stays on localhost. Limit: one branch on the phone at a time.

### 1.6 Tweak inbox in the app

- [x] `/requests` (App Feedback) becomes the intake. The owner types tweaks there from any device.
- [x] New skill `/queue`: read open requests, group them by the files they touch, do each group in its own worktree, ship each to the queue, write the result back on the request.
- [x] The owner runs `/queue` by hand. It is not scheduled.
- [x] The owner chooses what runs: `/queue` with no argument lists the open requests and asks which to do; `/queue 12 15` does only those.
- [x] A "Push through" mark on a request is the express lane. `/queue` does that request first, and the lander deploys it alone, at once, ahead of the batch.

### 1.7 Releases card (Admin) — build only if 1.4 is not enough

- [ ] Lists queued, stuck and landed branches.
- [ ] A Hold switch the lander reads, to stop deploys during field hours.

### 1.8 Token habits

- [x] Default model Sonnet; see the model guide.
- [x] One task per session. Start a new session instead of continuing a long one.
- [x] `CODEBASE_MAP.md` is 35k tokens. Keep the task-to-file table as the must-read. Move the directory map to a second file read on demand.
- [x] New skill `/tweak`: worktree, edit, typecheck, ship. No doc reading beyond the task-to-file table and `THEME.md` rules.
- [x] Rewrite the "Shipping" and "session ledger" sections of `CLAUDE.md` to match this phase.

Done when: two sessions edit the same file in parallel, both land in one
production deploy, and neither prints a git message to the owner.

Built 2026-11-13. Not yet run: the two-session test above. 1.7 is not built;
build it only if the lander is not enough.

1.5: `npm run preview` puts a branch on
`ascent-companion-git-preview-keywitt.vercel.app`. The shared Vercel write
switch covers Production and Preview with one value, so Preview was not off. A
second value, `false`, now applies to the branch `preview` only. The owner
still registers the address with Google sign-in. Open: the preview uses the
production companion database.

In
1.2 the hook tells the session to call `EnterWorktree`; a hook cannot move a
session into a worktree by itself.

---

## Phase 2 — Measure, then quick performance wins (Sonnet, 1 session)

- [x] Turn on Vercel Web Analytics and Speed Insights. (Code mounted in `layout.tsx`. The owner still enables both in the Vercel project.)
- [x] Add a per-route count (views, distinct users, 30 days) to Admin → Activity from `usage_events`. Phase 7 uses it to pick which pages to fold.
- [x] Lazy-load the Jobs Hub tabs (`JobsHub.tsx:19-29`). Cuts about 150 to 200 KB from Home.
- [x] Redirect field and lead users on the server in `src/app/page.tsx`. Not in middleware.
- [x] Cache `listTrackingSheetJobs` (`api/tracking-sheet/route.ts:42`). Removes a 2 to 10 second call from every job open.
- [x] Remove the Home month waterfall (`JobsHub.tsx:149`, `MonthJobDonuts.tsx:187`).
- [x] `my-todos` route: use `session.user.jtUserId`; cache the open to-dos for 60 seconds.
- [x] Run the layout's reads in parallel (`layout.tsx:82-121`). Do not change `auth()`.
- [x] Add `loading.tsx` skeletons for `employee-time`, `trackingsheet`, `jobs-hub`.
- [ ] Move the Leads ingest off page open to a cron. **Sign-off:** the cron needs a path that skips sign-in, so it edits `src/middleware.ts`.
- [ ] **Sign-off, measure first:** move hot in-memory caches to the shared cache with tags (ARCHITECTURE_REVIEW item 9). It touches the cache-bust calls on write paths.

Done when: Home first load is under 300 KB and the field clock shows in one step.

Built 2026-11-13. Home first load is 275 KB (was 466); Jobs Hub is 266 KB. Not
yet run on a phone: the field redirect. It fires on an app open only (a request
without the RSC header), so a refresh on Today lands on Time, and a menu tap to
Today does not redirect. `/` and `/jobs-hub` now pass the billing month from the
server, so the month's figures fetch at once. Open: the Leads cron, and the
shared-cache move.

---

## Phase 3 — Design foundation and navigation (Opus for 3.1 and 3.3, Sonnet for the rest; 1 to 2 sessions)

### 3.1 Missing primitives in `ui.tsx`

- [x] `Sheet`: bottom sheet on phones, side panel on desktop. Grabber, two heights, `overscroll-behavior: contain`.
- [x] `Menu` and `Popover`: one build, replaces the 6 custom popovers. Use Base UI or the native Popover API; pick one in this step and record why in `THEME.md`.
- [x] `Notice`: `Banner` plus severity, dismiss, snooze and one action button.
- [x] `Toast`: one way to confirm a save.

Built 2026-11-13 on Base UI 1.9.0 (THEME.md says why). Converted: the Tools
title menu, the Job board card's details drop-down, the Tool Schedule job
filter, and the Page Text save confirmation. The inventory found 3 real
popovers, not 6: CopyInPlace and NotesPanel are panels, RailWidgetButton is a
notice, Donut is a tooltip. The 4 typeahead pickers (CostCodeSelect,
JobPicker, GlobalSearch, PlaceInput) are comboboxes, out of 3.1's scope. 10
other files clear a "Saved" or "Copied" flag on a timer; move them to `toast`
as each page is touched. `Sheet` has no caller yet; 3.3 puts the phone drawer
on it. The toast host adds 1 KB to every page. Found while measuring: Home's
first load on `main` after Phase 2 landed is 329 KB, not 275, before any 3.1
change. Phase 2's 300 KB target needs a second look.

### 3.2 Token fixes (mechanical)

- [x] Inputs 16px on phones. Small buttons and segmented controls 44px on touch screens. Toggle at least 24px tall.
- [x] Quiet text on dark to 4.5:1 (about 390 sites; change the token, not the sites).
- [x] Add a `prefers-reduced-motion` rule.

Built 2026-11-13, all in `globals.css` plus the `Toggle` size; no page edited.
"Touch screen" is `(pointer: coarse)`, so an iPad gets the touch sizes too.
Bare `text-neutral-500` in dark was already lifted (2026-10); the 8 sites that
asked for `dark:text-neutral-500` now get the same lift. The worst dark
surface (`--ink-overlay`) reads 4.58:1. Checked in a phone-sized browser:
buttons and segments 44px, fields 16px, motion off under reduced motion.

### 3.3 Navigation

- [ ] Rebuild the phone drawer on `Sheet`: 3 columns, 24px icons, 13px labels, opens to half height, drags to full.
- [ ] Regroup the rail and the drawer from one ordered list by frequency of use. Use the Phase 2 counts once they exist; use the owner's order until then.
- [ ] Repoint the roughly 30 `/trackingsheet` links at the Jobs Hub. Bill page Back returns to where the user came from.
- [ ] Fold `/tracking-sheet` (hyphen) into the hub's sheet tab. Give `/unbilled`, `/jobs` and `/vendor-mail/index` a way back.
- [ ] Replace native and custom dropdowns with `Select` or `Menu`, page by page.

Done when: no page links to a page that the hub replaced, and one menu build remains.

---

## Phase 4 — Home redesign (Opus, 1 session; needs Phase 3.1)

Shared by phone and desktop:

- [ ] **Today**: office calendar and JobTread schedule in one strip. Reuse `getUpcomingScheduleTasks` and the digest calendar check.
- [ ] **To-dos**: one list sorted by urgency, then importance. Merges `HomeTodos`, `HubMyTodos`, `TodayOfficeTodos`.
- [ ] **Needs attention**: one count that opens the inbox (Phase 5). Replaces the banners and `TodayQueue`.

Phone only:

- [ ] Four large action buttons: Deposit check, Add bill, Scan tool, Record miles.
- [ ] Each button is itself the camera or start control. A browser opens the camera only on a tap, so a page cannot open it on load.
- [ ] Record miles starts the trip; a "Enter miles by hand" link sits under it.

Desktop only:

- [ ] Monthly invoicing widget: per-job status and month totals. Extract it from `/invoicing-summary`.
- [ ] Leads widget: reuse `HubLeadsCard`.
- [ ] Widget settings: show, hide, reorder, and two sizes per widget. Saved per user.

Cut from the request: free drag-to-resize on a pixel grid. It needs a grid
library and touch support that the review could not verify. Add it only if
show, hide, reorder and two sizes prove too little.

Done when: Home fires under 10 requests and nothing on it repeats another card.

---

## Phase 5 — One inbox for every warning (Opus for the schema, Sonnet for the rollout; 1 to 2 sessions)

- [ ] One `findings` store. Generalize `invoice_review_finding_state`: kind, severity, subject, first seen, last seen, resolved, snoozed until, dismissed by.
- [ ] One dismissal mechanism replaces the five in use.
- [ ] One "Needs attention" page built on `Notice`. Each row has: what is wrong, the fix button, snooze, dismiss.
- [ ] Each source writes into the store: stuck vendors, needs project, uncaptured bills, flagged bills, time sync, pre-send check, Sunset duplicates, invoice review.
- [ ] Inline fixes for the finding kinds that occur most. Count them from `invoice_review_finding_state` first. Each fix reuses an existing write route. **Sign-off** per fix.
- [ ] Show the Mac check's verdicts (`invoice_review_dispositions`) on each finding. Today they change nothing on screen.
- [ ] Show when the Mac check last ran (`monthly_check_runs`) and warn when it is late.
- [ ] Replace the 28 hand-rolled amber and red boxes with `Notice`.

The Mac check already runs unattended (launchd, headless Opus on the Claude
subscription, posting to `/api/invoice-review/agent`). The missing part is the
surface, not the runner.

Done when: every warning in the app is a row in one list, and the most common
finding kinds clear from that list.

---

## Phase 6 — EOM automation and one save model (Opus, 1 session; every step **sign-off**)

- [ ] Labor report: regenerate after any labor write, debounced, with `after()` (runs after the response is sent). Show "updated 3 min ago" in place of the button.
- [ ] Job check: run on open and after each save. Remove "Check this job".
- [ ] Replace "Check for Bills", "Sync to Tracking Sheet", "Sync Drive", "Refresh" and "Run now" with a last-run time and a small retry link. Their timers already run every 15, 30 or 60 minutes.
- [ ] Document access: grant on bill approval when the job has one customer contact.
- [ ] One save rule, shown in the UI: an edit that changes money stages behind "Save Changes"; anything else saves at once with a `Toast`. Move approve, void and line add or delete under that rule.
- [ ] One "Close month" step per job: finalize the sheet, grant access, open the JobTread invoice.

Do not add a write that races the hourly mirror.

Done when: one job, one month takes under 8 taps on the happy path.

---

## Phase 7 — Fold pages into hubs; inventory (Sonnet, 1 to 2 sessions)

Use the Phase 2 route counts to order this work. Two patterns already exist:
hub tabs with embedded pages (Jobs Hub), and `?section=` strips (Inbox, Payroll).

- [ ] Bills hub: `/bills`, `/email`, `/payments`, `/lswdd`, `/amazon-import`, `/add-bill`.
- [ ] Find: `/vendors`, `/bill-search`, `/expenditure-history`, `/vendor-mail/index`.
- [ ] People: `/employees`, `/labor-rates`, `/onboarding/office`, `/payroll`, `/time-off`.
- [ ] Admin: `/admin`, `/ascentbot`, `/admin/copy`, `/theme`, `/logs`, `/journal`, `/ai-cost`.
- [ ] Old routes redirect to the new section. Each section keeps its own view gate.
- [ ] Tools and inventory: a "Supplies" tab on `/tools`. New `supplies` table in the companion database: name, unit, quantity on hand, reorder level, location. Plus and minus buttons, no QR. A row under its reorder level becomes a finding in the inbox and can open a requisition.

Target: about 61 pages to about 35 routes behind 8 hubs.

---

## Decisions (owner, 2026-11-13)

| # | Decision | Answer |
|---|---|---|
| 1 | Does the queue deploy by itself, or wait for a tap? | By itself, in batches. Add the Hold switch (1.7) only if needed |
| 2 | Phone preview address (changes Google sign-in config) | Yes, one stable address |
| 3 | Remove the session ledger completely | Yes |
| 4 | Widget scope: show, hide, reorder, two sizes | Yes; no free resize |
| 5 | May the `/queue` agent work without the owner present? | No. By hand, and the owner picks which requests run and which push through (1.6) |

Menu primitive: Base UI (owner, 2026-11-13). The reasons are in `THEME.md`.
