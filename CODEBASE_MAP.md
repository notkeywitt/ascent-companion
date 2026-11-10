# CODEBASE_MAP.md — Ascent Assistant (companion)

**Start here.** This is the orientation index for the companion repo: what each
doc is for, a task → files jump table, and a directory-by-directory map of
`src/`. The goal is that a new session can find the right file WITHOUT
re-searching the whole tree. If you change where something lives, update the
matching row here.

> **Keeping this honest:** run `npm run check:map` (script:
> `scripts/check-codebase-map.mjs`). It walks both repos and flags any source
> file, route, or table that's on disk but missing from the map — and any map row
> whose file is gone. It never rewrites the map: the one-line descriptions are
> yours to write. Exit 1 on drift, so it fits a pre-commit hook or CI.

> Companion = the Next.js/Vercel phone UI over JobTread ("Pave" API) plus a small
> companion DB. The sibling repo `ascent-appscript` is the automated back end
> (Gmail→Claude ingestion, the hourly JobTread↔Sheet↔Drive mirror) and the
> Sheets/Drive data layer the companion reaches over a shared secret.

## Which doc answers what

| You need… | Read |
|---|---|
| Working rules, the mobile build loop, write-safety gates | `CLAUDE.md` |
| The Pave/JobTread schema + query grammar + gotchas | `JT_API_REFERENCE.md` |
| Why the gateway exists, where new views belong | `FRONTEND_ARCHITECTURE.md` |
| The colour palettes — every value, and the reasoning that fixed it | `THEME.md` |
| Standing structural review, agreed cleanup checklist | `ARCHITECTURE_REVIEW.md` |
| Where the app is more complex than the job it does, and how to undo it | `docs/plans/SIMPLICITY_AUDIT.md` |
| How pages are grouped, named and reached, and the staged plan to regroup them into workspaces | `docs/plans/NAVIGATION_PLAN.md` |
| Which pages merge into which hub (month, job, inbox, pay period, person), and the staged plan (proposed 2026-10-18) | `docs/plans/CONSOLIDATION_PLAN.md` |
| The staged plan for ending client invoicing mistakes | `docs/plans/INVOICE_ACCURACY_PLAN.md` |
| Job deposits and client payments: what Pave offers, what each job does today, and the staged plan to show and apply deposits (stages 1, 2 and 4 built; 3 and 5 open) | `docs/plans/DEPOSITS_PLAN.md` |
| What each screen does, for the owner (end-user manual) | `USER_MANUAL.md` |
| **The instructions the staff read INSIDE the app** — "how do I clock in?" | `src/lib/help.ts` (the topics) → the `/help` page |
| How to deploy / env vars / Vercel | `DEPLOY.md` |
| **Where a given file/feature lives (this doc)** | `CODEBASE_MAP.md` |
| A guided course through the whole system, for the owner | `docs/course/README.md` |
| The outside template AscentBot was modelled on (Aforma's Slack + Mac mini setup kit, Oct 2026). AscentBot follows its rules, not its machinery: Vercel + Google Chat instead of a Mac mini + Slack | `docs/ascentbot-setup-kit.md` |
| What each session did and where it stopped | `SESSIONS.md` (generated index) → `.claude/sessions/*.md` |
| Session-to-session handoff notes | `HANDOFF.md` — **do NOT read unless asked** |

## Task → where to look

| To work on… | Start in |
|---|---|
| A **new read-only page** over JobTread | copy `src/app/jobs/` (`page.tsx` → `JobsBrowser.tsx`), compose query per `JT_API_REFERENCE.md`, add the read to `src/lib/jobtread.ts` and a purpose-built `src/app/api/<name>/route.ts` (there is no generic gateway) |
| **A customer's or job's JobTread RECORD** (name, number, phase, address, contact, price type) | `src/lib/clientDirectory.ts` (reads + the write allowlist) → routes `src/app/api/clients/*` → page `src/app/clients/`. Editing lives HERE; `/jobs` reports a job's cost and changes nothing |
| **A job's invoice capture email tag** (the `_JT Invoice <Customer> - <Job>` Gmail label) | button on `src/app/clients/` → `src/app/clients/InvoiceTagCard.tsx` → `/api/clients/invoice-tag` → appscript `EmailToJtInvoice.js` (`listInvoiceTags`/`createInvoiceTag`). The label TEXT is always composed on the Apps Script side |
| **Gating / who sees what** | `src/lib/views.ts` (the single source of truth: `VIEWS`, `ROLE_VIEWS`), enforced by `src/middleware.ts` |
| **Nav: the workspaces, the ☰ menu, the bottom bar** | `src/lib/workspaces.ts` (`WORKSPACES` — every page by workspace; `BARS` — each role's bar; `OUTSIDE_WORKSPACES` — pages on none, with why), `src/components/AppMenu.tsx` (the ☰ drawer, every role and width), `src/components/TabBar.tsx`, `src/components/WorkspaceTabs.tsx` (the tab strip under the header, carrying `jobId` + `ym`; a close page writes `?ym` when the month is picked, via `src/lib/urlParam.ts`). The retired launchers' saved layouts sit untouched in the `nav_layout` table |
| **TODAY's queue** ("Needs you" — one row and a count per queue, gated by each page's own view; "Bills to code" opens the draft list in place) | `src/components/TodayQueue.tsx` (`QUEUES` — add a row there), cached per tab by `cached` in `src/lib/homeFacts.ts`. The Requisitions row's "N new" mark: `src/lib/requisitionsSeen.ts` (per device; `/requisitions` clears it) |
| **Today's to-dos** (your own, admin-only, and the Office job's, under the `office` view) | `src/components/HomeTodos.tsx` → `/api/todos`; `src/components/TodayOfficeTodos.tsx` → GET `/api/office/todos` → `readOfficeTodos` in `src/app/office/readOfficeTodos.ts` (shared with the Office dashboard), drawn by `src/app/office/OfficeTodos.tsx` |
| **Home REMINDERS** (dated to-dos under "Today" — Import Amazon, Import LSWDD, Pay LSWDD) | `src/components/HomeReminders.tsx` (`REMINDERS` — add one there); the facts both reminders and card counts read, cached per tab: `src/lib/homeFacts.ts`. Sunset's green test: `src/lib/sunsetReconcile.ts` (shared with `/payments`). Pay LSWDD also pops up app-wide: `src/components/LswddPayReminder.tsx` |
| **The IPAD (tablet) layout** — home console, the rail, the wide shape of anything | the `pad` breakpoint in `tailwind.config.ts` (744px, "an iPad in portrait and up"; declared in sorted position so `lg:`/`xl:` still win over it). Home: `src/app/page.tsx` + `src/components/HomeMasthead.tsx`. From `pad` up the bottom bar is a left RAIL, and from `2xl` a sidebar listing the current workspace's pages (`src/components/TabBar.tsx`, `railFor` in `src/lib/workspaces.ts`); its width is `--rail-w` (`globals.css`), which `#app-shell` and every `fixed inset-x-0` bar (`left: var(--rail-w)`) move right by |
| **The global search box** | `src/components/GlobalSearch.tsx` (the wide item in `AppHeader`'s one row) — matches pages via `src/lib/workspaces.ts`, help topics via `src/lib/help.ts`, vendors via `/api/vendors`, bills/line items via `/api/bill-search` |
| **The in-app instructions** (a wrong step, a new "how do I…") | `src/lib/help.ts` — the topics as data, written to ASD-STE100 (its header carries the rules, `help.test.ts` enforces the countable ones). Page: `src/app/help/` |
| **What counts as a JobTread write** (`findMutations`; `pave()` never retries one) | `src/lib/paveGateway.ts`. The generic `/api/pave` gateway was removed 2026-11-08; its per-role allowlist there gates no route now. |
| **Verified JobTread reads/writes** (not the generic gateway) | `src/lib/jobtread.ts` |
| **Billing period / bill-date rules** | `src/lib/billing.ts` (keep in lockstep with appscript `Config.js`); the month the office SET, overriding the 10th cutoff — `src/lib/billingMonth.ts`, route `/api/billing-month`, control in `HomeMasthead`. The route sets BOTH sides (here + the appscript Script Property) and refuses the change if the push fails. |
| **Bill line money math** (edit/save a bill's lines) | `src/lib/billLineMath.ts` |
| **Sales tax on a vendor bill** (where it lives, whether it's recoverable) | `src/lib/salesTax.ts` |
| **Keeping sales tax OUT of what the client is billed** | It is dropped from the tracking-sheet sync (appscript `TrackingSheets.js`), netted out of every TO BE INVOICED figure (`getSalesTaxByDoc` in `src/lib/jobtread.ts`, used by `getAllBillsForMonth` + `getInvoiceReconciliation`), and flagged if it ever reaches a client invoice (`invoiceReview/checks/salesTaxLine.ts`) |
| **Unsynced coding surviving a page you left** | `src/lib/codingDraft.ts` (autosave + reconciled restore) + `src/app/api/coding-draft`; wired into `Board.tsx` through `src/app/trackingsheet/useCodingDraft.ts` (scoped per job-month) and, scoped per BILL, `DraftWorkbench.tsx` + `src/app/bill/[docId]/page.tsx` — the same scope key, so a bill started on a phone is waiting at the desk |
| **"Where did I leave off"** | `src/app/trackingsheet/UnsyncedDrafts.tsx` — the unfinished-coding list on the Tracking Sheets landing, from `listDrafts()` (this device merged with the companion DB, so work left on another device is visible too) |
| **Tracking Sheets budget math** (the rail's budget / spent / drafts / labor per cost code, "budget left", the cost rings) | `src/app/trackingsheet/headroom.ts` — plain functions, pinned by `headroom.test.ts`; `Board.tsx` passes in the month and its staged-aware `codeOf` / `timeCodeOf` |
| **Tracking Sheets board's other money math** (sales tax per bill and its staged edit, the to-be-invoiced headline, bill and Sunset totals, the rail's division sums and phone headroom list, the cost-code lanes, the All Time rings, hours label) | `src/app/trackingsheet/boardMath.ts` — plain functions moved verbatim out of `Board.tsx`, pinned by `boardMath.test.ts` |
| **Tracking Sheets time coding** (the open entry, the selection, staged recodes and corrections, flags, approvals) | `src/app/trackingsheet/useTimeCoding.ts`, called once by `Board.tsx` |
| **Tracking Sheets: the budget column's screen state** (search, folded divisions, hide) | `src/app/trackingsheet/useRailView.ts` |
| **Tracking Sheets: approving bills** (one, or every draft on screen → `/api/bill-status`) | `src/app/trackingsheet/useBillApproval.ts` |
| **Tracking Sheets: loading the month** (one read of `/api/trackingsheet`, and what a load does to staged work) | `src/app/trackingsheet/useMonthLoad.ts` |
| **Tracking Sheets: Save** (every staged change to JobTread, in a fixed order: lines, labor, entry fixes, bill type, tax, then the merge) | `src/app/trackingsheet/saveCoding.ts`, pinned by `saveCoding.test.ts` |
| **Tracking Sheets: the open bill's own fields** (billing month, due date, Bill/Expense type, bill number, move to another job) | `src/app/trackingsheet/useBillFields.ts` |
| **Tracking Sheets: the open bill's Needs review flag** (companion-local, with its note) | `src/app/trackingsheet/useBillReview.ts` |
| **Tracking Sheets: the open bill's line actions** (code all, merge, delete / add / buy back a line) | `src/app/trackingsheet/useLineEdits.ts` |
| **Tracking Sheets: the open bill's scanned invoice** (read-only, cached per bill) | `src/app/trackingsheet/useBillFiles.ts` |
| **Tracking Sheets: what makes up a code's total** (the rail's drill-down, the rings' hover cards) | `src/app/trackingsheet/useCodeDrill.ts` |
| **Tracking Sheets: drag a line or bill onto a cost code** | `src/app/trackingsheet/useLineDrag.ts` |
| **Tracking Sheets: the budget rail's markup** (cost codes by division, drop targets) | `src/app/trackingsheet/BudgetRail.tsx` |
| **Tracking Sheets: the drill-down sheet's markup** | `src/app/trackingsheet/CodeDrillSheet.tsx` |
| **Tracking Sheets: the job's deposit and client payments** (balance, draws, the hand-entered deposit form) | `src/app/trackingsheet/DepositCard.tsx` → `/api/deposits` |
| **Tracking Sheets: the centre column's views** (By bill, By cost code, Summary) | `src/app/trackingsheet/BillListView.tsx`, `CodeLanesView.tsx`, `BillingSummaryView.tsx` |
| **Tracking Sheets: the job's sheet push and "Check this job"** | `src/app/trackingsheet/useTrackingPush.ts` (which sheet, the last push) and `usePreSendCheck.ts` (`useJobChecks` — the invoice review's checks on one job or many, each run laid over the last) |
| **A job check's findings: open, Re-check, Clear** | rows `JobFindings` in `src/app/trackingsheet/PreSendCheck.tsx`; what a finding is about is `Finding.target` (`src/lib/invoiceReview/types.ts`, set by the bill and labor checks); fixed / cleared memory per job+month on this device `preSendMemory.ts` (pinned by `preSendMemory.test.ts`); a bill opens in `BillPopup.tsx` (or the board's coding column at xl); a labor finding opens the board's labor list narrowed and ticked (`focusLabor` in `Board.tsx`, carried from the all-jobs view by `findingFocus.ts`) |
| **Tracking Sheets all-jobs actions** (Sync to Tracking Sheets = every sheet's bill push + the month's Labor Report; Check all Jobs; Import Labor) | `src/app/trackingsheet/AllJobs.tsx` (the row), `SyncAllTrackingSheetsFor` in `src/components/TrackingSheetSync.tsx`, `src/app/trackingsheet/CheckAllJobs.tsx` (the workbench's check, once per job with cost; shares `useJobChecks` and its memory with "Check this job") |
| **Tracking Sheets all-jobs labor list** (the month's time entries, every job, above the bills; Group = Job by default; Show / Group filters drive it too) | `src/app/trackingsheet/AllLabor.tsx` (renders the shared `TimeEntryList`; a row opens the entry on its job's board via `findingFocus.ts`) → `src/app/api/trackingsheet/all-time` (`getOrgTimeEntriesForMonth`); the filters and Job grouping live in `AllBills.tsx` |
| **Coding / Tracking Sheets workflow** | `src/app/trackingsheet/*` (Board, BillCodingCard, TimeCodingCard, ClientInvoicing, DraftWorkbench,
  AllJobs) + `src/app/api/trackingsheet/*`, `src/app/api/code` |
| **Editing ONE time entry** (code / hours / day / job) | `src/app/trackingsheet/TimeCodingCard.tsx` + `src/app/api/time-entry` — reached from the ✎ on a row |
| **The month's time-entry list** (either page) | `src/components/TimeEntryList.tsx` — rows, filters, grouping, selection and the recode drawer, shared by `labor-review` and the board's Time & labor panel; date maths in `src/lib/timeEntryDates.ts` |
| **Recoding several time entries at once** | select rows in that list → `TimeRecodeCard` → staged, then written by the page's Sync (`POST /api/labor-review`) |
| **The monthly Labor Report** (the Drive sheet payroll reads) | button: `src/components/LaborReportButton.tsx` (on BOTH Labor Review and the board's Time & labor card); `src/lib/qbLaborCsv.ts` (the 23-column QuickBooks Time shape + the `"July '26 Labor"` file name) → `POST /api/labor-report` (org-wide month via `getOrgTimeEntriesForMonth`) → appscript `LaborReport.js` files it. Launched from the Labor Review button; covers EVERY job, not the one on screen |
| **Org-timezone wall clocks in the browser** | `src/lib/orgTime.ts` (read half; the server's is in `src/lib/jobtread.ts`) |
| **A single bill page** | `src/app/bill/[docId]/page.tsx` + `src/app/api/bill/*`. Every bill link lands on the Jobs Hub: the page sends a reader with the `jobs-hub` view to `/jobs-hub?bill=<id>`, which opens the bill in its job's Tracking sheet for its billing month (`linkedBill` in `JobsHub.tsx`). `?page=1` keeps the bill page (a bill with no open job) |
| **PTO / sick accrual** | pure math `src/lib/leave.ts`; server orchestration `src/lib/leaveService.ts`; UI `src/app/time-off/` + `src/app/api/time-off/*` |
| **New-hire paperwork** (invite a hire, their profile, the W-4 / I-9 / Direct Deposit filled and signed in the app, the packet for the bookkeeper) | the hire's page `src/app/onboarding/` → `/api/onboarding/me` (+ `me/forms/[id]`, every read keyed on the signed-in email); the office's page `src/app/onboarding/office/` (`OnboardingOffice.tsx`, `FormEditor.tsx`) → `/api/onboarding/office` (+ `forms`, `file`). Field rules `src/lib/onboarding/fields.ts` (pure — the guess, the presets, the prefills), the PDF fill `pdf.ts` (pdf-lib), the DB and roster calls `store.ts`. An invite adds the Employee tab row (appscript `Employees.js` `addEmployee`), a `field` sign-in and the paperwork; the profile step writes back with `updateEmployee`. No SSN is stored; "Sent to bookkeeper" deletes the signed PDFs |
| **Employee time / clock** | `src/app/employee-time/` + `src/app/api/employee-time/*`; back end is appscript `EmployeeTime.js` |
| **The time card** (desktop Time Clock tab's TSheets-style week: job + cost code rows, hours typed per day, notes below) | `src/app/employee-time/TimeCard.tsx`, toggled by the Clock / Time card switch in `EmployeeTimeClient.tsx` (1024px and up, own time only). Row and start-time math in `weekGrid.ts` (`buildCardRows`, `stackStart`, tested). Writes are Split View's: Log-a-range POST, `op: "edit"`, `op: "delete"` |
| **Split View calendar mode** (beta: several people's weeks on one time-of-day calendar, tap an entry for its note below) | `src/app/employee-time/WeekCalendar.tsx`, opened by "Try Beta calendar mode" on the Split View tab (`EmployeeTimeClient.tsx`). Layout math in `weekGrid.ts` (`entrySpan`, `placeBlocks`, `hourRange`, tested). Reads `/api/employee-time/history` per person; edits your own entries with Split View's `EntryEditor`; adds time for anyone (tap an empty spot in a person's lane, or "+ Add time" and pick the person and job) with Split View's `NewEntry` — the Log-a-range POST with that person's `userId`; their pay rules load from `/api/employee-time/pay-rules?actingAs=` |
| **The time bug** (the floating clock on desktop: Job, Work, Notes, Switch, Clock out) | `src/components/TimeBug.tsx`, mounted in `src/app/layout.tsx`; 1024px and up, `employee-time` view only. Calls the same `/api/employee-time/clock` ops as the Time page (`switch`, `out`, `note`). Its pop-out (Chrome/Edge Document Picture-in-Picture) draws the same component into an always-on-top window through a portal. What it shares with the Time page (the device's clock and note, the just-closed entries, the change events, the bug's corner and dismissal) is `src/lib/timeClockShared.ts`. The note in progress is saved to the running JobTread entry as it is typed (op `note`), so it follows the crew member to another device: `src/lib/clockNoteSync.ts` |
| **Which jobs the time clock offers** (jobs the employee is added to in JobTread, phase Active / PreCon / Ascent) | rule `src/lib/timeClockJobs.ts`; membership read `getUserJobIds` (`src/lib/jobtread.ts`); joined in `getTimeClockJobs` (`src/lib/jobsCache.ts`); shell preload `src/app/employee-time/page.tsx`, reload for act-as `/api/employee-time/jobs`. Split View keeps every open job |
| **The pay-period time entries email** (every employee's half month as JobTread's CSV, drafted to Casey, Ty and Sara) | button `src/app/employee-time/TimeEntriesEmailButton.tsx` (Timesheets tab, admin + office) → `/api/employee-time/email`; read `getTimeEntriesForExport` (`src/lib/jobtread.ts`); CSV + wording `src/lib/timeEntriesEmail.ts`; draft appscript `EmployeeTime.js` `_companionDraftTimeEntriesEmail` |
| **Default pay type per employee + job + cost code**, and **default cost code per employee + job** | tables `pay_type_rules` and `cost_code_defaults`; match `src/lib/payTypeMatch.ts` (exact code, then job-wide); DB `src/lib/payTypeRules.ts`; editor `src/app/labor-rates/PayTypeRules.tsx` → `/api/labor-rates/rules`; read by `/employee-time` (shell preload + `/api/employee-time/pay-rules`) on clock-in, Log a range, switch and Split View |
| **Jobs page** (`/jobs-hub`, desktop: the title is Tracking Sheets' `JobPicker` ("All Jobs" until a job is picked); one header card — the job's links and Bills / Schedule switch over the rings (every job in a picked month, or the job by cost code with a month / all-time switch) beside the map with the job's details under it and an Edit link; under it the main window — Bills (default: the job's Tracking Sheet bills/labor column and a wide coding drawer, embedded) or Schedule (`JobOverview`)) | page `src/app/jobs-hub/` — composes `JobPicker`, `monthJobRows`/`useMonthJobs` (`MonthJobDonuts.tsx`), `buildColorMap`/`withoutSalesTax` (`CostDonuts.tsx`), `Donut` (`legend={false}`), `JobOverview`, `LopezMap` (`legend={false}`) and `Board` (`embed`: draws its bills column and coding drawer into the page's two slots); reads `/api/jobs?withPhase=1`, `/api/jobs/to-be-invoiced`, `/api/jobs/cost-detail`, `/api/trackingsheet/month-donuts` and `/api/job-board`. Its Punch List tab (`PunchList.tsx`, the final inspection checklist per job) is its own route, `src/app/api/punch-list/` (companion DB table `punch_lists`, one row per job; template and ops in `src/lib/punchList.ts`) |
| **Notes** (a note tagged with job, date, billing month, author and who it involves; edited in place with every edit kept; kept forever, no delete) | rules `src/lib/notes.ts` (pure, pinned by `notes.test.ts`); route `/api/notes` (GET by `jobId`, `ym`, `docId` (a bill's notes) or `history`; POST; PATCH with a stale-save check — there is NO DELETE); a note links to bills (JobTread document ids + a saved label, column `bills`), picked in a pop-up that is the Tracking Sheet's own month bill list — `AllBills` in pick mode (`pick` prop, `src/app/trackingsheet/AllBills.tsx`) — for the note's billing month and job, read through `/api/notes/month-bills` (the same handler as `/api/trackingsheet/all-bills`, under the Jobs view's gate); tables `job_notes` + `job_note_edits` (append-only, never trimmed); the one panel every notes area draws, `src/components/NotesPanel.tsx` (`jobId` set → that job's notes; `jobId` null → a billing month's). First area: the Jobs page (`/jobs-hub`), beside the month rings (no job) and beside the job card (a job). Gated by the `jobs-hub` view. A new area passes its own filter to the panel and adds the filter to GET |
| **The Jobs page** (Active jobs, PreCon jobs and leads as kanban rows — schedule now, newest 3 open to-dos) | page `src/app/job-board/` → `/api/job-board`; card shape, `PRECON_PHASES` and the to-do grouping in `src/lib/jobBoard.ts`; the to-do read is `getRecentJobToDos` in `src/lib/jobtread.ts`; the leads row is `HomeLeadBoard` (`storeAs="jobs"`) |
| **Leads / lead board** | read `src/lib/leads.ts`; the one write `src/lib/leadPush.ts`; UI `src/app/leads/` + `src/app/api/leads/*`; the home page's Leads panel `src/components/HomeLeadBoard.tsx` + `src/lib/leadBoard.ts`; the org's amber/red thresholds `src/lib/leadSettings.ts` + `/api/leads/settings` |
| **The chat assistant** | engine `src/lib/anthropic.ts`, tools `src/lib/chatTools.ts`, UI `src/app/chat/` + `src/app/api/chat` |
| **The Google Chat bot (AscentBot)** | Job decisions and details, plus money for a person whose role allows it: one Google Chat space per job. `src/app/api/google-chat/route.ts` (verifies Google's signed token, reads the asker's access, monthly Claude cap, loads the space's job and history, saves each turn) + `src/lib/googleChat.ts` (`companyRecordsTool` — the records search narrowed to the asker's record types, `buildHistory`, the `link_space_to_job` / `save_note` tools Claude calls from plain language, Chat formatting rules, the phase-2 note) + `src/lib/chatMemory.ts` (tables `chat_space_jobs`, `chat_turns`). Job-knowledge tools in `chatTools.ts`: `get_job_selections`, `search_job_documents`, `search_job_bills` (what a bill bought — product names, no amounts; read by `getBoughtLines` in `jobtread.ts`), `read_file` (opens ONE Drive file or JobTread PDF and reads it a few pages at a time, or finds the pages mentioning some words — `src/lib/fileReader.ts`; a short scan is read by AI; the text is kept in table `file_texts`; a Drive file must sit under `JOB_FOLDERS_DRIVE_ID`, checked on the Apps Script side), `find_tools` (the Tools tab via Apps Script `listTools`: where each tool was last scanned), `get_todos` (open JobTread to-dos company-wide, overdue first — `getOpenToDos`), the bot-only `get_mileage` (Apps Script `listMileage` called with the asker's email, so the office and owners see every trip and others only their own; `summarizeMileage` drops coordinates), `search_job_scope` (proposals, selections and change orders: each option marked chosen or not, the group note that records the decision, no prices — `getJobScopeLines` in `jobtread.ts`), `get_job_time` (who worked on a job, when, on which code, hours only — `getJobTimeLines` in `jobtread.ts`, summarised by `summarizeJobTime`), `get_job_schedule`, `get_job_notes`, `search_job_memory`, `search_team_chat` (the team's Signal groups, sent every hour by `scripts/signal-sync/` on the office Mac mini — `src/lib/signalImport.ts`), `get_job_files`, `get_calendar`. `report_gap` emails the office a question the bot could not answer; when Claude skips it, the route sends it after the reply if the answer reads as "found nothing" (`looksUnanswered`). An answer that runs past 25 s is posted later in its thread by `src/lib/googleChatPost.ts` (the Chat app's service account through Workload Identity Federation — Vercel's OIDC token, no key file; env `GCP_PROJECT_NUMBER`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`, `GCP_SERVICE_ACCOUNT_EMAIL`; unset = the 25 s answer), and gives the file reader longer scans (`readerTime`). Every message in a job space, not only @mentions, reaches memory through `src/lib/chatSync.ts` (Chat API read with the admin-approved `chat.app.messages.readonly` scope, before each question and daily via `/api/google-chat/sync`; tables `chat_space_sync`, `chat_users`; off until `GOOGLE_CHAT_READ_SPACES=on`). Hard questions move to a larger model (`runChat`'s `escalate`: rounds after the second, or a rewrite when Haiku's answer gives up; env `GOOGLE_CHAT_HARD_MODEL`, default Sonnet 5.5). Reuses `runChat` on Haiku (`tools` / `extraTools` options), spend logged as feature `google-chat` |
| **The Tool Schedule** (which tool types each job needs when, from the JobTread schedules; conflicts, missing tools, moves) | page `src/app/tool-schedule/` (Gantt / Calendar / List, `ToolSchedule.tsx`) → `/api/tool-schedule` → `buildToolSchedule` in `src/lib/toolScheduleData.ts`; editor `src/app/tool-schedule/edit/` (Tools · Tasks · Bookings · Jobs; shared pickers and the requisition prompt in `src/app/tool-schedule/ToolPickers.tsx`) → `/api/tool-schedule/{catalog,rules,holds,jobs,availability}`; rules `src/lib/toolSchedule.ts`, layout `src/lib/toolScheduleView.ts`, storage `src/lib/toolScheduleStore.ts`; chat tool `get_tool_schedule`. Plan: `docs/plans/TOOL_SCHEDULE_PLAN.md` |
| **Anything Sheets/Drive-backed** (employees, tools, mileage, safety, requisitions, Sunset, tracking sheets, audit log) | `src/lib/appsScript.ts` (the one client over the shared secret) → the matching appscript `.js` file |
| **Invoice/Amazon extraction (Claude)** | `src/lib/claudeExtract.ts`, `src/lib/amazonImport.ts` |
| **Auth / session / roles** | `src/auth.ts`, `src/middleware.ts`, `src/lib/auth.ts` |
| **Env, gates, Pave config** | `src/lib/config.ts` |
| **Companion DB tables** | `src/db/schema.ts` |
| **The design system** | `src/components/ui.tsx` (build every UI on these primitives). Client-side parts it re-exports: `src/components/Dialog.tsx` (the one modal — bottom sheet on a phone, centred from `sm`), `src/components/FileDrop.tsx` (the file picker), `src/components/StickyActionBar.tsx` |
| **Per-element help on a page** (the ? mark, bottom-left) | `src/components/PageGuide.tsx` (the overlay: the live page scaled into a stage, the element list, the arrow) → `src/lib/pageGuide.ts` (the topic type, the path key, the selector builder) → `/api/page-guide` → table `page_guides`. An admin writes the topics IN the overlay: Edit → Add element → tap the thing |
| **Page scroll in the installed app** (the page scrolls inside `#app-shell`, not the window, so iPhone cannot drag the tab bar up) | `globals.css` (the `display-mode: standalone` block) → `src/lib/appScroll.ts` (read or set the page scroll through this, never `window.scrollY`) → `src/components/AppScrollKeeper.tsx` (top on a new page, back to where you were; mounted in `layout.tsx`) |
| **Pull down to reload** (installed app only) | `src/components/PullToRefresh.tsx` (touch handling, the indicator; mounted in `layout.tsx`) → `src/lib/pullToRefresh.ts` (distance and threshold). `data-no-pull` opts an element out |
| **Swipe right to go back** (installed app only; replaced the header's back button) | `src/components/SwipeBack.tsx` (touch handling, the indicator; mounted in `layout.tsx`) → `src/lib/swipeBack.ts` (edge, threshold, direction). `data-no-swipe` opts an element out |
| **Who may ask AscentBot, and what each role sees** (financials, staff records, the office mailbox) | `/ascentbot` (admin only) → `src/app/ascentbot/AscentBotAccess.tsx` → `src/app/api/ascentbot/route.ts`. Rules in `src/lib/botAccess.ts` (areas, `botToolNames`, `accessSystem` prompt lines, the seed); rows in `src/lib/botUsers.ts` (tables `bot_roles`, `bot_users`, seeded once with the five pilot askers on Full access). An area that is off hands the model no tool for it. Money tools in `chatTools.ts`: `get_job_financials`, `get_job_cost_lines`, `get_client_documents` (reads `getJobClientDocuments`), `get_open_invoices`, `get_vendor_bills`, shaped by `src/lib/botFinancials.ts` |
| **Which Signal chats AscentBot reads, and which job each belongs to** | `/ascentbot` → `src/app/ascentbot/SignalChats.tsx` → `src/app/api/ascentbot/signal/route.ts` → `src/lib/signalChats.ts`. The office Mac mini (`scripts/signal-sync/`) reports the chats and sends their messages through `src/lib/signalImport.ts` |
| **Editable on-screen text** (office reword, no deploy) | add a key to `src/lib/copy.ts`, render it via `useCopy()`; edited at `/admin/copy` → `src/app/api/admin/copy/route.ts` |
| **Which build is running** (after a deploy) | the footer at the bottom of `/admin` — `src/app/admin/BuildFooter.tsx`. The Assistant's own commit/branch/time are frozen into the bundle by the `env` block in `next.config.mjs` (no request); the Apps Script back end's stamp is fetched on demand from its anonymous `doGet` health check via `src/app/api/admin/build/route.ts` |
| **The Admin To Dos card** (JobTread to-dos + the morning report on Home) | UI `src/components/HomeTodos.tsx`; the live to-do read + create is `src/app/api/todos/route.ts` → `createToDo` in `src/lib/jobtread.ts`. The report under it is the digest: `src/lib/digest/` — `settings.ts` (EVERY threshold/exclusion), `registry.ts` (the check list), `checks/*` (one file per check), `run.ts` (aggregator); routes `src/app/api/digest/*`; Google data via appscript `DailyDigest.js` |
| **The Office dashboard's to-dos** (create, edit, tick done, delete — Office job only) | UI `src/app/office/OfficeTodos.tsx` (list read server-side in `src/app/office/page.tsx`); writes `src/app/api/office/todos/route.ts` → `createToDo` / `updateToDo` / `deleteToDo` in `src/lib/jobtread.ts`. Edit and delete read the to-do's job first and refuse any job but `OFFICE_JOB_ID` |
| **Reviewing a month's client invoices** | `src/lib/invoiceReview/` — `checks/*` (one file per check, pure + tested), `settings.ts` (EVERY threshold), `registry.ts` (the check list + the runner), `evidence.ts` (JobTread + Drive + Gmail), `rulings.ts` (the memory), `runs.ts` (the history), `brief.ts` (the no-API-key hand-off); page `src/app/invoice-review/` ("Checks" — also hosts the Flagged bills section, `src/app/needs-review/FlaggedBills.tsx`, and the Taxable lines section, `src/app/taxable-lines/TaxableLinesBrowser.tsx`; `/needs-review` and `/taxable-lines` redirect there, `next.config.mjs`); the Invoicing tab row is `src/components/InvoicingTabs.tsx`; routes `src/app/api/invoice-review` (+ `/run`, callable manually — NOT on a Vercel cron; see the incident note in `docs/plans/INVOICE_ACCURACY_PLAN.md`); Drive + Gmail reads via appscript `ClientInvoiceReview.js`; skill `.claude/skills/invoice-review/` |
| **An architect's spec selection list (finish schedule)** | page `src/app/specs/`, route `src/app/api/specs/` (companion DB table `spec_lists`, one row per import; the PDF itself in `spec_files`, served inline by `src/app/api/specs/pdf/` for the page's PDF view). The PDF's links come from `src/lib/pdfLinks.ts` (pdf.js), its rows from `extractSpecListWithClaude` in `src/lib/claudeExtract.ts`, joined by `resolveSpecList` in `src/lib/specList.ts` — the model names link ids, never URLs. "Save to JobTread" is ONE row at a time: `src/app/api/specs/jobtread/` flags the chosen budget line `isSpecification` (approval required) and adds the row to its description via `mergeSpecEntry`, journalled. "Documents for AscentBot" (`src/app/specs/JobDocuments.tsx` → `src/app/api/specs/docs/`) takes a Drive file or folder link and keeps every file's PDF text layer and links in table `spec_docs` (`src/lib/specDocs.ts`, no model call; a scan of up to 10 pages is read by `ocrScanWithClaude`, cost feature `spec-doc-ocr`); AscentBot reads it with `search_job_documents`. The Drive links themselves are table `job_sources`, ONE list per job shared with House Manual's Job files |
| **A job's homeowner's manual (the Squarespace page)** | page `src/app/house-manual/`, route `src/app/api/house-manual/` (companion DB table `house_manuals`, one row per job). The draft and the paste-ready HTML block are `src/lib/houseManual.ts`; contacts come from `getJobVendors`, the fallback sections from `getJobSpecifications` (both `src/lib/jobtread.ts`). Squarespace has no page-content API, so the Squarespace page reads the app instead: Publish (POST on the route) stores the rendered block, and `src/app/m/[token]/route.ts` serves it PUBLICLY by an unguessable token to a one-time embed snippet (`embedSnippet`) in a Code Block. `/m` is on `PUBLIC` in `src/middleware.ts`. Copy HTML stays as the by-hand fallback. Job files (`src/app/house-manual/JobFiles.tsx` → `src/app/api/house-manual/drive/`) links the job's Drive folders and reads a file in as a spec list through appscript `JobFiles.js` (`listDriveFolder`, `getDriveFilePdf`). Its linked files are the shared `job_sources` list (same as /specs; NOT stored in the manual JSON), and it offers every `spec_lists` import to add as sections |
| **A new job's budget from its tracking sheet** | page `src/app/budget-import/`, route `src/app/api/budget-import/` → appscript `BudgetImport.js` (the bucket → cost type mapping, checked by its `scripts/check-budget-import.mjs`). Two outputs: a CSV (costs plus one markup), or "Import into JT" — `JtImport.tsx` → `src/app/api/budget-import/jobtread/` → `src/lib/budgetImport.ts`, which updates the job's live budget IN PLACE (items keep their ids, so time entries and bill lines stay attached), creates what is missing, never deletes, and journals every write. Probe: `scripts/probe-budget-write.mjs` |
| **Invoice Status** (a month's client invoices: paid or open, emailed or opened) and the Invoicing Package doc | page `src/app/invoicing-summary/`, route `src/app/api/invoicing-summary/`; every figure and the doc come from appscript `MonthlyInvoicingSummary.js`, which the 30-minute tracking-sheet push also calls; the payment and email state is read live from JobTread (`getInvoiceStatuses` in `src/lib/jobtread.ts`, classified in `src/lib/invoiceStatus.ts`) |
| **Adding an invoice-review check** | write `src/lib/invoiceReview/checks/<id>.ts`, add its config block to `settings.ts`, add one line to `registry.ts` — the runner, the route, the history and the page are untouched |
| **Why the review missed something / making it learn** | file it via the page's "Something this missed?" box → `src/lib/invoiceReview/misses.ts`; `POST /api/invoice-review/learn` asks Claude what check would have caught it (`learn.ts`) — the answer is a proposal a person implements |
| **Is a check any good?** | `GET /api/invoice-review/accuracy` — precision derived in `src/lib/invoiceReview/lifecycle.ts` from what the office did next, not from anyone scoring anything |
| **Checking one job before its invoice goes out** | the "Before you send" card on `/trackingsheet?jobId=…` → `src/app/trackingsheet/PreSendCheck.tsx` → `GET /api/invoice-review/job` → `src/lib/invoiceReview/preSend.ts` |
| **The same vendor bill captured twice** | `checks/duplicateDraft.ts` (a draft copying another bill — runs in "Check this job") vs `checks/duplicateBill.ts` (one finalized bill on two client invoices) vs `checks/duplicateWide.ts` (two bills for one vendor invoice, across months, finalized or not). Different questions; none sees the others' case |
| **A job's deposit and client payments** (the balance, what drew it down, which payments paid which invoices) | Deposit left = Deposit − Previously applied − Draws. Rules `src/lib/deposits.ts` (pure, pinned to real jobs by `deposits.test.ts`), JobTread read `getJobDepositInputs` in `src/lib/jobtread.ts` (CD lines + client payments), the deposit entered by hand for a pre-JobTread deposit in table `deposit_links` (`src/lib/depositLinks.ts`), route `/api/deposits` (shared read `src/lib/depositRead.ts`), card `src/app/trackingsheet/DepositCard.tsx` beside the board's invoice panel. THE one JobTread write: `/api/deposits/apply` sets a DRAFT invoice's single Deposit line (rules `planDepositDraw`, write `writeDepositDraw` — verified, undone on a mismatch, journalled). Deposit lines are kept out of every work total: the review's cost and markup figures (`depositPart` in `invoiceReview/checks/shared.ts`), the job board (`NOT_DEPOSIT_LINE`) and the board rail. The write's probe is `scripts/probe-deposit-line.mjs` (dry by default); the staged plan is `docs/plans/DEPOSITS_PLAN.md` |
| **Deposit checks** (Home's Actions button: photograph the checks, file them on the Office job in folder Checks, mark the client invoices paid, draft the email to Sara and Casey) | button `src/components/HomeActions.tsx` (the Actions panel on Today; opens the camera from the tap) → page `src/app/deposit-tracker/` (`DepositTracker.tsx`; `pendingPhotos.ts` carries Home's photos across and shrinks each to a JPEG) → routes `/api/deposit-tracker/photo` (`uploadFileToJobFolder`), `/invoices` (`getOpenCustomerInvoices`), `/record` (`getInvoicesForPayment` + `recordInvoicePayments` — one payment per customer account, idempotent on the deposit key, journalled), `/email` → appscript `DepositEmail.js` (`draftDepositEmail`). Rules + email wording `src/lib/depositTracker.ts` (pure, tested). View `deposit-tracker`, admin-only |
| **What a client owes, and how late** | `src/lib/arAging.ts` (the buckets, pure + tested), route `/api/ar-aging` (one org-wide `getOpenCustomerInvoices` walk), page `/ar-aging` |
| **Who changed this bill / line / time entry** | `src/lib/financialJournal.ts` (the recorder + reader), `src/lib/billJournal.ts` (the bill-header wrapper), page `/journal`, route `/api/journal`, table `financial_events`. Append-only and never trimmed |
| **A captured cost that never reached QuickBooks** | `checks/qboPush.ts` — QBO is the general ledger, and `qboIsIgnored` turns the push off in one tap. Also runs in "Check this job", which is the useful moment: the fix is one tap before the invoice goes out |
| **A month's labor total not reconciling** | `checks/laborRate.ts` — runs inside "Check this job". The usual cause is JobTread's rate snapshot: a pay rate changed after the entries were written, so the month keeps the old rate with nothing on screen to say so |
| **Having Claude chase the findings** | Claude Code on the office Mac: skill `.claude/skills/monthly-check/SKILL.md`, scheduled by `scripts/monthly-check/` (`install.sh` → launchd → `run.sh`, review days only; `agent.mjs` holds the token). It reads and files runs and posts verdicts + its reading through `src/app/api/invoice-review/agent/route.ts` (bearer `REVIEW_AGENT_TOKEN`); verdicts stored by `dispositions.ts`, status by `investigations.ts`, read by the page via `GET /api/invoice-review/investigate` |
| **Adding a digest check** | write `src/lib/digest/checks/<id>.ts`, add its config block to `src/lib/digest/settings.ts`, add one line to `src/lib/digest/registry.ts` — the aggregator, the cron route and the UI are untouched |
| **What Claude costs** (per call, per feature, per month) | `src/lib/aiUsage.ts` (`trackClaudeUsage`, called after every Claude call; `MODEL_PRICES`; table `ai_usage`), page `src/app/ai-cost/` (Audit's AI Cost tab, admin) → `/api/ai-usage`. A review's own cost rides on its payload (`aiCost`) and shows on Checks. The Apps Script invoice reader logs its own calls (`AiUsage.js` there, WebApp action `aiUsage`) and `/api/ai-usage` merges and prices them |
| **LopezRocks** (the island's community board, re-drawn for a phone) | page `src/app/lopezrocks/` (`page.tsx` picks the shape, `LopezRocksViews.tsx` draws it), the fetch + cache `src/lib/lopezrocks.ts`, reading a page `src/lib/lopezrocksParse.ts`. Every role; the link is at the bottom of Home. Read-only — posting and sign-in open the site itself |

## `src/lib/` — shared logic (the most-reused code)

Pure modules (no DB/Node/React) are marked ⟂ — safe to import anywhere,
including edge middleware.

| File | Purpose |
|---|---|
| `jobtread.ts` | The typed Pave client + the verified read/write calls behind the app. Every call was confirmed live; TODO fields are unverified (probe-first). Since 2026-11-08 this file only re-exports the parts below; import from `@/lib/jobtread`, never from a part. The parts follow the file's old section headers, and several hold more than their name says — the rows below list what each really holds. |
| `jobtread/core.ts` | `pave()` (retry, timeout; never retries a write), `PaveConfig`, the reference-data cache, `pageAll`/`pageEach`, and every value another part reads at load time. Imports no other part — `jobtread/load.test.ts` holds that rule. |
| `jobtread/unbilled.ts` | Two helpers: is a bill or time entry on a client invoice yet (`_isInvoicedToClient`, `_isOnAnyInvoice`). |
| `jobtread/codingQueue.ts` | Draft bills and bill detail; bill field writes (dates, number, tax, status); bill and job files; job budget and cost-to-complete; time-trackable cost codes; sales tax and warranty by document. |
| `jobtread/jobCostDetail.ts` | The `/jobs` cost tree (`getJobCostDetail`, contributors); untaxed lines; job bills, time and lines for a month; the job list, a user's jobs, job phases. |
| `jobtread/homeJobBoard.ts` | Home job board and Gantt; vendors (list, addresses, emails, detail, bills, contacts); house-manual specs; org users and pay rates; bill LINE writes (`updateLine`, `createLine`, `deleteLine` with its journal snapshot, `combineLines`). |
| `jobtread/invoiceStaging.ts` | `getMonthlyBills` only. |
| `jobtread/billIngestion.ts` | Bill creation (`createVendorBill`, `replaceBillLines`); Sunset credits and expense accounts; the externalId lookups that stop a duplicate bill; the shop job and buybacks. |
| `jobtread/sunsetStatements.ts` | Sunset statement bills; buyback lines; document file attach/delete; month invoicing reads (`getAllBillsForMonth`, `getUninvoicedBills`, `getInvoiceReconciliation`, open client invoices). |
| `jobtread/timeEntries.ts` | Time entries: org-timezone conversion, create/update/delete with journal snapshots, and the user/org/export reads. |
| `jobtread/tasks.ts` | Schedule tasks and to-dos (create/update/delete); members by email; job notes; bought lines and scope lines; `getUpcomingScheduleTasks` (open leaf schedule tasks in a date range, for the tool schedule). |
| `jobtread/jobAccess.ts` | Job access: the people listed on a job. |
| `jobtread/documentAccess.ts` | Document access: the people listed on a document. |
| `jobtread/jobDeposits.ts` | Job deposits (read only): `getJobDepositInputs`. Rules in `deposits.ts`. |
| `jobtread/depositDraws.ts` | Deposit draws (write): a draft invoice's single Deposit line. |
| `jobtread/clientInvoiceRefs.ts` | Client invoice references: the Invoicing Package email's QBO links and PDFs. |
| `jobtread/depositChecks.ts` | Deposit checks (Home → Deposit checks): file upload to a job folder, invoices for a payment, recording invoice payments. |
| `jobsCache.ts` | The org's open jobs in Next's Data Cache (5-min TTL), shared by `/api/jobs` AND any server component that wants to preload the list into its HTML (e.g. `/employee-time`). Also `getTimeClockJobs`, the time clock's per-employee list. |
| `jtUserLink.ts` | **email → JobTread identity, cached in the DB** (`jt_user_links`). The roster answer costs a ~3 s Apps Script round trip, so read it here: `readJtUserLink` (DB only, safe on a render path) / `resolveJtUserLink` (falls back to Apps Script and writes back). `readJtUserLinkByJtUserId` is the reverse, for naming the person an admin is filing time for. |
| `actingAs.ts` | **Whose time is this /employee-time request about?** Applies the rule below to a real request: reads the session, resolves the caller's own JobTread user, and checks any other subject against the live org roster before it reaches a write. Acting swaps the SUBJECT, never the attribution — `email` and `role` stay the signed-in admin's, so the log's Logged By and the financial journal both name who really did it. |
| `timeSubject.ts` ⟂ | The rule itself, with no imports so it is testable without a session: your own JobTread user always, someone else's only as admin, and an UNLINKED person may still identify themselves (the reason `userId` was ever loose in a request body). |
| `employeeClock.ts` | The running clock (`readOpenClock`) and the last job/cost/pay a person used (`readLastUsed`), shared by `/employee-time`'s server shell and its clock route. |
| `paveGateway.ts` ⟂ | Read/write classification of a Pave query (`findMutations`), used by `pave()`. Also the per-role mutation allowlist left from the removed `/api/pave` gateway; it gates no route now. |
| `config.ts` | Server-side Pave config from env (`getPaveConfig`) + write gates. Never import into client code. |
| `copy.ts` ⟂ | **Registry of editable on-screen text** — every string the office can reword from Admin → Page Text. English lives here as the shipped default; the DB only overrides. |
| `copyService.ts` | Server half of the above: reads `page_copy` overrides. Returns `{}` on any DB failure so copy can never blank a page. |
| `roleMenuService.ts` | Server read of `role_menu`, each role's side-menu edit from Admin → Access (applied by `railFor` in `workspaces.ts`). Returns no change on any DB failure. |
| `views.ts` ⟂ | **Single source of truth for role-gated views** — `VIEWS`, `ROLE_VIEWS`, `resolveAllowedViews`, `viewIdForPath`. |
| `origin.ts` ⟂ | **The cross-site (CSRF) guard** — `isSameSiteRequest` decides whether a state-changing request came from our own pages, by comparing its `Origin` against the `Host` it arrived at. Pure, so `middleware.ts` can call it on the edge. It exists because the session cookie is `SameSite=None` for the Chrome side panel, which switches the browser's own protection off for the whole app. |
| `authMode.ts` ⟂ | **`noAuthConfigured()` — is any sign-in method configured at all?** One answer for the six places that need a local dev machine to work without Google OAuth. Every caller treats `true` as "let it through", so this is the one place a fail-open branch lives. |
| `apiAuth.ts` | **In-handler authorization** (`holdsView`) for the routes middleware cannot gate — one route serving two audiences, like `/api/employees` (an open roster read, a gated full read). Applies the same rule as `views.ts`, so a per-user grant works here too. |
| `notes.ts` ⟂ | **Notes rules** — the tags, `readNoteFields` (validates a POST/PATCH body), `billingYmForDate` (the 10th cutoff), `changedFields` (what an edit moved), `groupByBillingMonth`. Both the route and `NotesPanel` read it. |
| `notices.ts` ⟂ | **Who sees a notice, and when** — the audience match (groups OR named people, legacy single-target rows folded in) and the schedule window (`noticeStatus`: off / scheduled / live / ended). The reader's feed, the authoring route and the authoring panel all decide from here, so "it says Live" and "it shows" stay one claim. |
| `noticeLinks.ts` ⟂ | **Links in a notice's message** — `[label](target)`, a bare `/path` or a bare `https://` address. An address on the app's own site folds back to its path, so the office pastes whatever the address bar shows. Only app paths and http(s) become links; anything else stays text. Drawn by `components/NoticeText.tsx` in the banner, popup and authoring preview; the desktop toast opens the first link. A view is linkable only if its page keeps its state in the address (`lib/urlParam` `setUrlParam`). |
| `reportMarkdown.ts` ⟂ | The markdown slice Claude Code's monthly report uses (headings, bullets, tables, bold, links), parsed into blocks `ReportText` draws. Links only to http(s) or app paths |
| `noticeToasts.ts` | **Desktop alerts** — the browser's own Notification API, so a notice that arrives while the app sits in a BACKGROUND tab pops up in the corner of a computer's screen. `planToasts` is the pure rule (nothing toasts while the reader is looking at the app, nothing toasts twice per device, a burst is capped); the rest is the per-device on/off + already-toasted ledger in localStorage. NOT Web Push: nothing arrives with the app closed, and no iPhone has the API at all. |
| `help.ts` ⟂ | **The in-app instructions, as data** — one topic per question ("How do I clock in?"), each naming the view it belongs to so a topic for a page you can't open is hidden. Read by BOTH the `/help` page and the header's search (`searchHelp`), the same reason `workspaces.ts` is a module. Written to **ASD-STE100** Simplified Technical English: the rules are in the file header, and `help.test.ts` enforces the countable ones (20 words a step, 25 a note, one sentence per step, no banned words). Every `**bold**` string is the text on a real control — when a page rewords a button, this file changes with it. |
| `lopezrocksParse.ts` ⟂ | **LopezRocks (lopezrocks.org) pages, read as data** — the pure half of `/lopezrocks`. A small tolerant HTML reader (the whole site is one PHP template, so no library), then one shape per kind of page: a keyword-grouped listing, the calendar, one post / event / business / story / discussion with its comments, the front page's sponsors, and a generic fallback (headings, text, links, tables) for anything else. It returns TEXT and CLASSIFIED LINKS, never HTML, so a post's own markup can never run inside the app. `linkFromQuery` checks every value of the page's address, so the address bar can only ever reach a LopezRocks page. The firewall's "checking your browser" answer throws `LrNotAPage` rather than reading as a page. Unit-tested on synthetic pages (real ones carry islanders' names and phone numbers). |
| `lopezrocks.ts` | The fetch + cache behind `/lopezrocks`. ONE request per page per 15 minutes (Next's Data Cache, shared by every lambda), with an honest User-Agent. LopezRocks' Sucuri firewall turns some server requests away (2 in 10 in a test); a turned-away fetch throws, a throw is never cached, so a page read once keeps showing and a new one says "try again". It never tries to get past the check. |
| `pageGuide.ts` ⟂ | **The page guide, as data** — per-element help an admin writes from inside the app, one topic per thing on the screen (`help.ts` answers a question; this names a control). `guidePathKey` is the rule worth knowing: a guide belongs to a PAGE, so a path segment that does not read as a word is folded to `*` and `/bill/22ab9x` shares one guide with every other bill. `selectorFor` builds the anchor from the element an admin TAPPED, so nobody types CSS. Unit-tested. |
| `preview.ts` ⟂ | **Role preview** — the cookie name + helpers letting an admin view the app AS each role. The layout reads the cookie (honoring it only for a real admin) and hands that role's live view set to the nav, so the launcher/tabs render as that role sees them. Narrows only, never elevates. |
| `previewClient.ts` | Browser half of the above: `startPreview`/`stopPreview` set/clear the cookie and reload so the server layout re-reads it. |
| `auth.ts` ⟂ | Shared-password auth helpers (Web Crypto only; works in edge + node). |
| `billing.ts` ⟂ | Billing-period + bill-date standard, ported from appscript `Config.js`. Keep in lockstep. Client-safe (the pure half): the 10th cutoff, `parseBillingYm`/`ymOf`, and `billingMonthStale` — when the set month has fallen behind the calendar and the masthead paints it red. `deriveBillingPeriod` takes an optional set month that REPLACES the cutoff for every non-Sunset bill. |
| `billingMonth.ts` | The DB half of the billing month — the ONE `billing_month_setting` row, and `currentBillingPeriod()`, which every "current billing month" server read should use. Server-only, which is why the rule stays in `billing.ts`. No row means the automatic cutoff. `mirrorBillingMonth()` PUSHES the value into the appscript project (action `setBillingMonth`), which is what carries it to the bills captured there — the `_JT Invoice` Gmail scan, the LSWDD split and the uncaptured push. |
| `taxableLines.ts` ⟂ | **The stray `isTaxable: false` worklist** behind `/taxable-lines`, in TWO lists because the fix is: the CLIENT INVOICE line is what actually bills the client (and the only side reachable once the bill behind it is pushed or paid — a bill with `amountPaid > 0` is marked `locked`), the VENDOR BILL line is the source that stops the next invoice inheriting it. Create Invoice COPIES the flag, so the two are separate records and clearing one never moves the other. An invoice figure is EXACT (`price × rate`); a bill has no price, so its figure adds the markup and is flagged `estimated`. READ-ONLY by design — a bulk update across live documents is the wrong shape for a tax decision. Two exclusions carry the risk: overhead jobs (58 of August's 75 bill lines) and sales-tax lines matched MORE strictly than `isSalesTaxLine` matches them, because that helper checks the code first and a line named "Sales Tax" coded `01 00 00` would otherwise read as ordinary and get taxed. Pure; the JobTread walk is `getUntaxedLines`, which finds bills by date and invoices by the month's bills they CARRY (a draft invoice has no issue date). Unit-tested. |
| `arAging.ts` ⟂ | **Accounts receivable ageing** — the buckets behind `/ar-aging`. Pure arithmetic over rows the caller fetched; every money figure is JobTread's own (it derives `balance`/`amountPaid` from QuickBooks) and nothing here recomputes one. The rule worth knowing: an invoice ages from its DUE date where it has one and its ISSUE date where it does not — never whichever is later — and each row carries `basis` so the page can say which it used. An invoice with no usable date counts toward what is OUTSTANDING and never toward what is OVERDUE. |
| `emailSignature.ts` ⟂ | Keillor's Gmail signature (HTML + text), shared by the drafts the app saves (time entries, deposit checks). |
| `depositTracker.ts` ⟂ | **Deposit checks** — the rules behind Home's Deposit checks button: checking the selected invoices and grouping them into one payment per customer account (`planDepositPayments`), the payment's externalId (the retry guard), the photo names, and the email to Sara and Casey. No I/O. |
| `deposits.ts` ⟂ | **Job deposits** — one balance per job: Deposit − Previously applied − Draws. The deposit is the paid part of the job's deposit invoices (a positive CD line), or the figure the office entered by hand for a deposit taken before JobTread, which replaces it. Draws are negative CD lines on client invoices (drafts shown, not counted). Rules only; `deposits.test.ts` pins them to Berger, Studio and Ferron. |
| `depositRead.ts` | The one read both deposit routes answer with: the ledger, the deposit entered by hand, the client payments. |
| `depositLinks.ts` | The DB half of job deposits — the `deposit_links` row per job: the deposit entered by hand and what was previously applied before JobTread. |
| `billLineMath.ts` ⟂ | Money math for editing a vendor bill's lines. Identity now; still de-taxes a pre-2026-09-05 bill. |
| `salesTax.ts` ⟂ | Sales tax is a bill LINE coded 88 80 00, not the document tax field: the constants, the line matcher, and the job-derived recoverable/consumed split. Mirrors `CONFIG.JOBTREAD.SALES_TAX_*` in appscript `Config.js`. |
| `billInvoiceState.ts` ⟂ | **What the edge stripe on a bill row means** — one bill's place in the monthly invoicing lifecycle (flagged / reviewed-but-draft / on an invoice / left off the month's invoice), plus the colour per state. One axis on purpose: the stripe used to mix budget headroom, coding progress and invoiced state, which made it unreadable. `missing` depends on `monthInvoiceExists`, which `jobtread.ts` derives from the whole month BEFORE already-invoiced bills are filtered out. Unit-tested. |
| `billPdf.ts` ⟂ | **The vendor invoice that never arrived.** A ~150-line PDF writer (Letter, Helvetica + Courier, the logo square drawn from `AscentLogo.tsx`'s own peak points) and the one document it draws: the bill's vendor, job, lines and total on Ascent paper, plus the office's typed description of what the charge was for. `/api/bill/create-file` builds it and attaches it to the same JobTread document, so a "No file" bill stops being a hole in the month's Drive backup. No PDF dependency on purpose — reach for `pdf-lib` if a document ever needs images or a real font. Unit-tested (xref offsets, page breaks, Latin-1 folding). |
| `billTouch.ts` | One-bit "a bill was written through the app" signal, shared across pages so list caches know when to refresh. |
| `billSearch.ts` | The bill-search index engine: sweeps live JobTread vendorBills + lines, seeds pre-JobTread history from the sheets, and answers `/bill-search` queries from a local FTS5 index in under a second. Companion-owned cache, not a source of truth. |
| `leave.ts` ⟂ | PTO/sick accrual math (bi-monthly pay periods). |
| `leaveService.ts` | Accrual server orchestration: roster + JobTread worked-hours + companion DB. |
| `leaveFormat.ts` | Leave display formatting helpers. |
| `leads.ts` | Reads the org's "New Lead" customers out of JobTread (there is no lead object in Pave). |
| `jobBoard.ts` ⟂ | **The home job board's card shape + its schedule math** — where a job sits on JobTread's Gantt chart (span, share elapsed, the tasks covering today, the next one) and how that reads as a line. Client-safe: the cards render in the browser, so nothing here touches the Pave layer. `ACTIVE_PHASE` is what "active job" means — every job in the org is open, so Phase, not `closedOn`, separates site work from budgets and prospects. Filled by `getJobBoard` (`jobtread.ts`) in ONE org-wide aggregate query. Unit-tested. |
| `clientDirectory.ts` | **The customer/job directory, and the only write path onto those records.** Reads are two-phase because they must be: `jobs` nested inside a paged `organization.accounts` returns 413, so it pages the two flat connections and joins on `job.location.account.id`; custom-field VALUES are the same trap, so the list carries Phase and Status read per FIELD and the rest per record. Writes are an ALLOWLIST (`JOB_WRITABLE` and its three siblings) — everything else JobTread exposes stays read-only, and two kinds are held back on purpose: `defaultRetainagePercentage` (a bare unbounded "number" — the unit is stated nowhere) and `customTaxRate` (bounds ARE stated; it is withheld because it decides what a client is taxed), plus MULTI-VALUE custom fields, whose array-replace behaviour is unprobed. `updateAccount` always sends `notify:false` — it defaults to TRUE, and fixing a spelling must not mail the customer. Every write re-reads the record, because `update*` returns a bare `root` and because a location's tidied address/city/state/ZIP are derived from what was typed. |
| `leadPush.ts` | The ONE write in the leads feature — pushes a logged lead into JobTread as a customer. |
| `leadInquiry.ts` | Web-inquiry lead parsing/normalization. |
| `leadSettings.ts` | The DB half of the quiet thresholds — read and write the ONE `lead_settings` row. Server-only, which is why it is not in `leadBoard.ts`: the pure half (defaults, validation, banding) has to stay client-safe. Read fresh, never cached; the point of the setting is that moving it shows on the next load. |
| `leadBoard.ts` ⟂ | **The lead card's shape + the date math both lead surfaces share** — the day arithmetic (`daysSince`, `fmtDate`, `today`), the scope/address fallback chains, and the order-by-last-contact sort the home panel offers. Client-safe, like `jobBoard.ts`. Also the PURE half of the amber/red thresholds — `LEAD_QUIET_DEFAULTS`, `normalizeThresholds` (clamps rather than rejects; a BLANK field is absent, not zero, or it would clamp to 1 day and turn every lead amber) and `quietBand`, the one function both surfaces colour from. The rule worth knowing: a lead with NO touch ever logged is ordered from the day it arrived, so a new lead nobody has called cannot hide at the fresh end of the row. Unit-tested. |
| `timeSync.ts` | Worked-time reconciliation/retry. Two depths: `listTimeProblems` reads the Time Entries sheet's own verdict (cheap — the page and the launcher badge), `auditWorked` adds a JobTread cross-check of the last few days, which is the only thing that finds a record JobTread has with the WRONG hours (a refused clock-out leaves the entry open there, id and all). `retryWorked` re-posts, and adopts an entry that turns out to exist rather than creating a second one. |
| `timeProblems.ts` ⟂ | What can be wrong with one time record, and what the office does about it — the type, the order, the headings, the one-line fixes. Its own pure module because the server decides the problem and the client draws it. |
| `appsScript.ts` | The one client for the Apps Script web app — every Sheets/Drive feature POSTs `{action, secret, …}` here. |
| `anthropic.ts` | Claude chat engine — the server-side tool-use loop behind `/chat` (server-only). |
| `pdfLinks.ts` | A PDF's clickable links, each with the words under it and the row text beside it (pdf.js, server-only). Feeds the spec list import. |
| `specList.ts` | A spec selection list's types, `resolveSpecList` (link ids → links, unplaced links kept) and `groupByRoom`. Pure. |
| `specDocs.ts` | A job's Drive documents for AscentBot: `walkDriveLink` (every file under a link), `readDriveFile` (PDF text layer + links via pdf.js, kept in `spec_docs`), `searchSpecDocs` (the bot's LIKE filter + matching lines by page), and the job's shared Drive links (`listJobSources`/`addJobSource`/`removeJobSource`, table `job_sources`, used by /specs and /house-manual). Server-only. Unit-tested. |
| `specImport.ts` | `importSpecPdf` — read a spec list PDF (links + Claude) and store it as the job's newest import. The one path behind an upload on `/specs` and a Drive file on `/house-manual`. |
| `punchList.ts` ⟂ | A job's Punch List: the final inspection checklist template (keys from section + text slug), the per-job state (done, hidden, added items) and `applyPunchOp`, one change at a time. Pure. Unit-tested. |
| `houseManual.ts` ⟂ | A homeowner's manual: its shape, the first draft (spec list rows by room, else JobTread Specifications), and `manualHtml`, the self-contained Squarespace Code Block (scoped CSS, `<details>` accordions, no script, unsafe links dropped). Pure. Unit-tested. |
| `claudeExtract.ts` | Claude document extraction — invoice/bill reading for `/add-bill`, tool-serial OCR for `/api/ocr-serial`, Amazon order summaries, and spec selection lists for `/api/specs`. Port of appscript `Ingestion.js` `callClaude` (server-only). Replaced the Gemini module, deleted 2026-09-09. |
| `chatTools.ts` | Read-only JobTread tool registry exposed to the chat assistant. Phase 1 is READ-ONLY — do not add writes. |
| `chatMemory.ts` | AscentBot's memory: which job a Google Chat space is about, and every question, answer and kept decision (companion DB only, server-only). |
| `signalImport.ts` | Signal messages into AscentBot's memory: the import secret check, the chat report and batch checks, and `importSignalMessages` (a "said" turn per message in space `signal:<chat>`, only for chats set to a job or the office, the job id taken from the rule, skipping any already kept, moving the chat's cursor). Route `src/app/api/google-chat/signal-import/`; sender `scripts/signal-sync/` on the office Mac mini; read by the bot's `search_job_memory` (job chats) and `search_team_chat` (every chat). Unit-tested. |
| `signalChats.ts` | The Signal chats the Mac reports each run (table `signal_chats`) and what AscentBot may do with each — a job, the office, don't send, or not set (a new chat; sends nothing). Assigned on the AscentBot page (`src/app/ascentbot/SignalChats.tsx`, route `/api/ascentbot/signal`). Re-filing a chat moves its kept messages; setting it to don't send removes them and resets its cursor. |
| `botAdmin.ts` | `requireBotAdmin` — the `ascentbot` view check shared by the `/api/ascentbot` routes. |
| `amazonImport.ts` | Amazon Business monthly CSV → JobTread vendor bills. |
| `sunsetStatementBill.ts` | The shape of a Sunset statement's bill on the Office job ("Create Bills" on `/payments`): issue date, and two 88 70 00 lines — the total and the prompt discount as a negative line. Pure, unit-tested; the write is `src/app/api/sunset-statement-bills/`. |
| `sunsetStatementMonth.ts` | The Sunset Statements page's month: which statements Approve all and Print act on, and what a statement's Office-job bill says about payment. Pure. |
| `sunsetLinks.ts` | **Sunset statement line → bill links** (the "Link" on `/payments`). `sunsetLineKey` must match appscript `_sunreconNormNum` — the reconcile finds a link by it. `rankCandidates` orders the picker: unclaimed first, then closest amount, then same date. The links live in `sunset_statement_links`; the write is `src/app/api/sunset-statement-links/`; the reconcile route passes them to appscript, whose month-wide match (`_sunreconAssignMonth`) applies them before any automatic match. Pure, unit-tested. |
| `toolSchedule.ts` ⟂ | **The tool schedule's rules** (`docs/plans/TOOL_SCHEDULE_PLAN.md`). The catalogue is the Tools list, typed by ToolType. A rule (one task, task name, task type, phase — added together, "needs no tools" stops the rest) or a booking names a specific tool (`tool:<id>`) or any of a type (`type:<key>`); JobTread keeps no tool on a task. `findShortfalls` finds the days a type runs short, or one tool is booked for two jobs at once; `findMoves` sends a named tool where it is needed. `suggestTools` proposes targets from names already mapped; nothing counts until saved. Pure, unit-tested. |
| `toolScheduleView.ts` ⟂ | How the tool schedule page lays its answer out: Gantt lanes, a day's needs, weeks of need, job colours, the job filter (`filterScheduleByJobs` finds the shortfalls again for the jobs on view) and the editor's sorts. Client-safe, unit-tested. |
| `searchWords.ts` ⟂ | `matchesAllWords`: every typed word must appear, in any order. Used by `CostCodeSelect` and the tool schedule's job filter. |
| `toolScheduleData.ts` | Builds the tool schedule on the server: JobTread tasks (less left-out jobs) + the Tools list as the catalogue (`buildCatalog`) + the stored plan → `buildToolSchedule`; also the editor's phases, task names and suggestions (`taskRules`), the scheduled jobs, and `shortagesFor` (a newly named type none of is free → the requisition prompt). |
| `toolScheduleStore.ts` | The tool schedule's tables (types added by hand, task → tool needs, bookings, left-out jobs) and the Tools-sheet read (cache tag `tools`, shared with `/api/tools`). |
| `toolScheduleAccess.ts` | Who may edit the tool schedule (the `tool-schedule-edit` view), for the page's Edit link and every write. |
| `taskRunner.ts` | Tiny background scheduler (keyed serialization + parallelism cap) used by the Tracking Sheet page. |
| `usage.ts` | Activity tracking (login/view/coding) — the data layer behind Admin → Activity. |
| `financialJournal.ts` | **THE FINANCIAL JOURNAL** — one append-only record of every write the app makes to a money record. It exists because every JobTread write carries ONE grant key, so JobTread's own history attributes all of it to the API rather than to a person, and a deleted bill line used to leave no trace at all. Four rules, stated in the file: append only (no update, no delete, no sweep — the Apps Script side's `writeAuditLog` trims its oldest 500 rows past 2,000, which is the failure this must not repeat); never break a write (every function swallows its own errors); record failures too (a rejected write is part of the record); and be honest about `before` — `beforeSource` says whether the prior value was read live, reported by the browser, or not captured. The pure half (`valueToText`, `diffFields`, `redactMeta`, `describeEvent`) is unit-tested. |
| `budgetImport.ts` | "Import into JT": matches a tracking sheet's estimate to a job's live budget (name → cost → cost type → one-left, else the office chooses), prices from the page's markup (the API applies no margin), and writes the difference. A created item goes where the budget already keeps that code or division (`placeItem`), never into a sheet-named duplicate group — Gormley Studio's un-numbered groups are why. Pure planner unit-tested in `budgetImport.test.ts`. |
| `billJournal.ts` | The journal wrapper for a bill HEADER write — the one copy of "read the prior value, write, record the change, record the failure" that the six single-field bill routes (tax, issue date, vendor bill number, status, the Bill/Expense + QuickBooks flags) share. Rethrows unchanged, so each route keeps its own error response. |
| `codingDraft.ts` ⟂-ish | **Unsynced Tracking Sheets coding, made durable.** Staged coding is autosaved on every change — localStorage first (the layer that actually catches a killed tab), the companion DB a couple of seconds behind (the layer that follows you to another device) — and offered back on return. `reconcileDraft` is the judgement and the tested part: it re-tests a stored draft against the data that just loaded, dropping anything JobTread has since taken or lost. `listDrafts`/`describeDraft` feed the landing page's unfinished-coding list. It never writes to JobTread; Sync still does that. |
| `timeEntryDates.ts` ⟂ | The date arithmetic behind the shared time filter — Monday-based `weekStart`, `addDays`, the `W:`/custom-range encoding, and the UTC day labels. Split out of the component because every failure in it is SILENT (a week off by one just shows the wrong hours) and this is where the unit suite can reach it. |
| `useUnsavedChanges.ts` | React hook guarding navigation away from unsaved edits. Now a reminder rather than the safety net — `codingDraft.ts` is what stops the work being lost. |
| `mileageTrip.ts` | **The OPEN mileage trip — started, not yet ended.** A browser cannot follow a phone down the road, so the tracker takes a start point and an end point and lets Google Routes do the driving miles; this is what keeps the started trip alive between the two taps. Same two layers as `codingDraft.ts`: localStorage on every change (survives a force-quit with no signal), the companion DB behind it (`/api/mileage/active` — survives a cleared browser and lets the trip be ended on a different device). On reopen the LATER start wins, local on a tie. One open trip per driver; deleted on End and on Cancel. |
| `mileageRoute.ts` | **Miles for a trip logged by hand.** The driver names a From and a To (typed, the job's address, or "where I am"); `milesBetween` asks Google Routes for the one-way driving miles, and the page doubles a round trip with `tripMiles`. Backs `/api/mileage/route-miles`, which saves nothing — the save is still `POST /api/mileage { manual: true }`. Also holds the `reverseGeocode` the GPS tracker uses. |
| `mileagePlace.ts` | **A From or To in plain words.** `resolvePlace` matches "Office", "the shop", "the dump", "Berger" or "#142" against the open jobs and the crew's regular stops (`KNOWN_PLACES`: Sunset, Blossom, LVM, the dump — add one there), and returns an address for Google to route. Office and Shop are ordinary jobs under the "Ascent" customer. Text that names no job is routed as typed; text that fits several jobs is refused with the names. `suggestPlaces` feeds the list that drops under each field as the driver types (`src/app/mileage-tracker/PlaceInput.tsx`). Pure — the page passes in the job list it holds. |
| `mileageScope.ts` | **Whose logged miles a person sees.** Apps Script `listMileage` decides admin from its own email list; `scopeMileageList` then applies the companion role, so only `admin` and `office` see every driver. Everyone else gets their own trips (Driver = their roster name, or Logged By = their email) and no driver list. `GET /api/mileage` and the report route (`seesAllMileage`) use it. |
| `nearestJob.ts` | **"Which job am I standing on?"** — the location-aware half of the field job pickers (`JobPicker`'s `showNearest`, Employee Time's job sheet). `useNearestJobs(jobs, enabled)` turns the device's fix plus each job's `location.latitude/longitude` into a distance per job and one nearest job. It asks for the fix only when a picker OPENS, never on mount, and remembers a denial for two minutes so re-opening the list can't nag. The picker's DEFAULT is still the last job logged; this only reorders the menu. |
| `sentry.shared.ts` | Shared Sentry init. |
| `billingMonths.ts` | **Billing months — the ONE list, the ONE label and the ONE issueDate rule** (a month's bills carry its LAST DAY as `issueDate`; `ym` "2026-07" is the key). Every month picker builds its options here. |
| `money.ts` | `money` / `money0` — dollars as the app shows them: en-US, minus before the sign, and "—" (never $0.00) for a missing value. |
| `jtLinks.ts` | Links OUT to JobTread's own web app, one definition per destination. Every URL shape is one the owner copied from the address bar, dated (the time page's org and per-job addresses, its `userId`/`startDate`/`endDate`/`timeEntryId` params). |
| `combineLines.ts` | Combining two bill lines that share a cost code. The request is built once and STAGED, then applied at Save before the line writes (it deletes lines those writes would target), so Revert undoes it like any other edit. |
| `splitBill.ts` | Split a draft bill in two: the picked lines move to a new draft bill (same job, vendor, dates, terms, a copy of the PDF, invoice number "-2"). Every line lands on the new bill before any comes off the old one. Backs `/api/split-bill`. |
| `splitBillClient.ts` | The browser half of Split bill — one call and one outcome message for every host of the coding card. |
| `qboLock.ts` | **The QuickBooks lock** — a bill or invoice already in QuickBooks cannot be edited or deleted by any role (owner, 2026-09-09). The one exception is a pure re-code, which moves no money. |
| `invoicingEmail.ts` ⟂ | The month's Invoicing Package EMAIL: one item per job linking its tracking sheet, and per invoice its QuickBooks invoice, JobTread invoice and PDF (a job can have two in a month). The route gathers the inputs; Apps Script attaches the PDFs and saves the Gmail draft. |
| `packageInvoices.ts` ⟂ | **A job's invoices in the Invoicing Package payload** — every one, primary first, from the payload's `invoices` list, or the single `invoiceNumber` of an older Apps Script deploy. Read by the Invoice Status route and page and the package email. |
| `monthActions.ts` | When each month-closing action last ran, per billing month (`month_action_runs`). Stamped by the action's own route on success; read by `/api/month-actions` for the Tracking Sheets all-jobs cards. |
| `monthCostByJob.ts` | One billing month's cost per job and cost code (`getMonthCostByJob`), in the shape the cost rings take. Feeds `/api/trackingsheet/month-donuts`. |
| `warranty.ts` ⟂ | Warranty work (88 90 00) is Ascent's own cost: OUT of every per-job figure, IN the all-jobs month totals as its own slice. Keep in sync with `TRACKING_WARRANTY_CSI` in appscript `TrackingSheets.js`. **A warranty record** (`isWarrantyInvoice`): a client invoice priced $0 with every live line on 88 90 00, beside the month's normal invoice — so a job can have two invoices in one month (Seely #134 + #130, Oct 2026). `warrantyPart` takes 88 90 00 lines out of the review's markup figures. Mirror: `_misIsWarrantyInvoice` in appscript `MonthlyInvoicingSummary.js`. |
| `lopezMap.ts` ⟂ | The Lopez Island map's geometry: the OpenStreetMap coastline as one SVG path, and the flat projection that puts a job's latitude/longitude on it. |
| `vendorCoi.ts` ⟂ | Vendor COI file names ("<Vendor> COI - <year>"), matching appscript `VendorCoi.js`. Also the COI REQUEST rules behind the Vendors page's "Request COIs" button: who needs a COI (`coiNeeded` — the office's Yes/No/Auto, JobTread's vendor Type, `COI_EXEMPT_NAMES`), `coiState` from JobTread's "COI Expires" field, `coiRequestList` (billed in the past 365 days, expired or undated), and the Gmail compose link. The last-request date and the override live in companion table `vendor_coi`, seeded with the Oct 23, 2026 request. Unit-tested. |
| `vendorMail.ts` | **Did every vendor invoice get captured?** Mail from the vendor addresses on file in JobTread, joined to the bills. Read-only; the vendor address index is both its guarantee and its blind spot. |
| `payRates.ts` | Pay rates are office information: the rate is stripped on the server before the roster leaves it, so a field phone never holds it. |
| `leaveImport.ts` ⟂ | The TSheets/QuickBooks PTO and Sick balance CSV → a plan of signed adjustments per roster employee. Pure; `leaveService.ts` does the writes. |
| `leaveLast.ts` ⟂ | Puts PTO and Sick Time at the bottom of a job's Work list on the time clock. |
| `safetyTopics.ts` ⟂ | The safety meeting topic catalog — a year-plus of weekly talks picked for a small residential crew, each with its own talking points so it works with no signal. |

### `src/lib/invoiceReview/` — the monthly client-invoice review

Cross-checks a billing month's CLIENT invoices (JobTread `customerInvoice`
documents) against the vendor bills behind them, the backup PDFs filed in the
Drive invoicing tree, and the office mailbox. READ-ONLY against JobTread, Drive,
Gmail and the Sheet; the only things it writes anywhere are two rows in the
companion DB — a standing "ruling", and the run itself.

Staged expansion plan: `docs/plans/INVOICE_ACCURACY_PLAN.md`.

| File | Purpose |
|---|---|
| `types.ts` ⟂ | The evidence and finding shapes, the `FindingKind` list, and the `findingKey` identity a ruling suppresses by. Pure — imported by the checks, the route and the page alike. |
| `checkTypes.ts` ⟂ | The check contract: the three SCOPES (`month`/`job`/`invoice` — the unit a check reasons about) and the context each is handed. Separate types rather than one context with optional fields, so a month-scoped check can't read a job that was never meaningful for it. |
| `checks/mailCapture.ts` ⟂ | **The most important check.** A vendor invoice arrived in the 10th-to-10th window and JobTread has no matching bill — the one failure no other check can see, because everything downstream only sees what got captured. Month-scoped: an arriving invoice belongs to the PERIOD, not to whichever job it landed on. |
| `checks/uninvoiced.ts` ⟂ | Everything captured for the month reached a client invoice — one job-level finding when nothing was billed at all, one per bill when the job WAS invoiced, plus rolled-up labor. Skips Office and Shop, Ascent's own overhead (`isNeverInvoiced` in types.ts). |
| `checks/backup.ts` ⟂ | Backup coverage both ways: every billed bill has its PDF, every filed PDF is accounted for, and two copies of one charge are flagged. Amount-matched one-to-one against the pipeline's filename convention. |
| `checks/invoiceMath.ts` ⟂ | Does the invoice foot — line multiplies out, lines sum to the total, tax and balance reconcile. Recomputes only to COMPARE with what JobTread states; never decides which side is right. |
| `checks/duplicateBill.ts` ⟂ | One vendor bill carried by two live client invoices. The finding most likely to cost real money and real trust, and the one that can be true with every other check passing. |
| `checks/issueDate.ts` ⟂ | The invoice is dated inside the month it carries. In JobTread the issue date IS the billing period, so one mis-typed date bills the wrong month AND re-files the backup into the wrong Drive folder. |
| `checks/costBasis.ts` ⟂ | The invoice's cost basis is accounted for by the month's bills on it. One direction only — an invoice covering part of a month is normal. |
| `checks/draftBills.ts` ⟂ | Bills left in the coding queue when the month closed. JobTread can't pull a draft onto an invoice, so none of it was billed. |
| `checks/duplicateDraft.ts` ⟂ | **Is a draft bill a second copy of one the job already has?** `duplicate-bill` asks about CLIENT INVOICES and a draft is on none, so it cannot see this; `draft-bills` counts drafts without looking at what they are. Between them a re-ingested bill sits in the coding queue looking like ordinary unfinished work. Matches on same job + vendor + cost to the cent + issue date (the issue date IS the billing period, which is what makes the coincidence implausible), and reports a group only when at least one member is a draft — a draft twinning an approved bill counts too. `amount` is the SURPLUS, not the group total. Built from Kevin Berger / Main House Aug 2026: two drafts, Island Custom Woodworks, $4,163.75 each, nine identical lines, different externalIds so the ingestion guard missed them. |
| `checks/laborRate.ts` ⟂ | **Is the month's labor costed at the rate it should be?** JobTread SNAPSHOTS the hourly rate onto a time entry when it is written and never re-costs it, so a raise applied today leaves every entry already logged behind — invisibly. Four findings: `stale` (an entry's rate ≠ what that pay type carries on the person's membership now), `split` (one person + pay type at two rates inside one month), `unknown` (the pay type is gone from the membership, so the rate cannot be verified), and `code-spread` (one COST CODE carrying two labor rates — the proxy for the tracking sheets' per-code contract rate, which this side cannot read). The code loop re-prices anything the per-person loop already reported, so one stale rate is never reported again for every code it touched. Skipped, not passed, when the grant can't read per-member pay types. |
| `checks/qboPush.ts` ⟂ | **Did the cost reach the BOOKS?** The first check that asks about Ascent's own ledger rather than about the client. QuickBooks is the GL: approving a vendor bill is what pushes it there, and `amountPaid` comes back FROM QBO — while `qboIsIgnored` turns the push off in one tap, on the bill page and on the board. So a bill can be captured, coded, invoiced, backed by its PDF and paid with the flag set the whole time: the revenue lands, the cost never does, and the month's profit is overstated by exactly that amount. Two findings: `qbo-not-pushed` (the flag is set) and `qbo-never-approved` (a `pending` bill already on a live client invoice, so only approval is missing). It does NOT claim a push succeeded — JobTread exposes no per-document sync result this app can read — and a `qboIsIgnored` of `null` is SKIPPED, not passed. Overhead jobs are deliberately not skipped: that cost is never billed to a client but it belongs in the books. |
| `checks/taxableFlag.ts` ⟂ | **A stray `isTaxable: false` on one line of an otherwise taxable bill.** A client invoice taxes only the taxable lines, so one flag cleared by mistake shrinks the invoice's tax base and the client is under-billed the sales tax Ascent still owes. Nothing else catches it: `invoice-math` recomputes against the tax JobTread STATES, which is the reduced figure, so the invoice foots. Only the tracking sheet disagrees — it has no per-line flag and taxes the whole subtotal. Reports MIXED bills only; wholly exempt is a decision. Built from Ferron / Otis Perkins Addition Aug 2026: one $4,156.25 line of a 13-line Element Smart Roofing bill, $410.31 between the sheet and invoice #382. Unit-tested. |
| `checks/salesTaxLine.ts` ⟂ | **Is the client being billed the sales tax Ascent paid?** Tax on a vendor bill is its own 88 80 00 cost item, recorded so QuickBooks gets a sales-tax figure for the WA excise return — never client-billable. Nothing in JobTread can enforce that: a cost code carries no "not billable" flag, and Create Invoice prices whatever it pulls at cost × the job's markup, so a tax line selected by mistake bills the tax AND a markup on it. No threshold — any amount is wrong. |
| `checks/taxDoubled.ts` ⟂ | **A bill whose lines already include the tax its 88 80 00 line adds.** Reads the tax's shape (`taxLooksDoubled` in `src/lib/salesTax.ts`): on a correct bill tax = lines × rate; on a doubled one tax = (lines − tax) × rate. Rates are `settings.ts` (San Juan County to start). Drafts too. Built from Kevin Berger / Bunkhouse July 2026: Home Depot $59.50 vs a $55.24 receipt, Fasteners Plus $484.29 vs $449.64. Unit-tested. |
| `checks/duplicateWide.ts` ⟂ | **The same vendor document captured twice on one job, across months, finalized or not** — the case `duplicate-draft` and `duplicate-bill` both miss. Same vendor invoice number after a revision suffix is dropped (NS1866 = NS1866-R) is an error; same vendor + same cents within 45 days is a warning, unless both bills carry different vendor numbers (that rule silences monthly rentals). Credits pair with credits. Compares against `priorBills` (62 days before the month). Built from Dirt Doctors #1289, Naturally Sustained NS1866 and a Sunset −$145.91 credit entered twice. Unit-tested. |
| `checks/duplicateCrossJob.ts` ⟂ | **One vendor bill or credit booked on two jobs** — each job's own check sees only half. Month-scoped, so it runs in the monthly and scheduled reviews, not "Check this job". Same vendor + cents within 7 days on different jobs, unless the two carry different vendor numbers. Built from Sunset credits −$83.03 and −$17.99 on both Berger jobs (dry run 2026-10-19). Unit-tested. |
| `checks/invoiceLines.ts` ⟂ | **Every dollar on an invoice traces to a bill, a time entry or a deposit — code by code.** Invoice lines carry no source link (`sourceCostItem` is null), so each line pairs with a bill line (`billSources`) or time entry at the same code and cost; leftovers compare as sums so a consolidated line still reconciles. Reports unsourced cost, SHORT codes (a line cut or a hand-typed credit), and priced lines with no cost. Many codes out at once collapse to one "rebuilt invoice" finding. Built from Berger's $63.36, −$3,572.27 and "00 00 00" lines. Unit-tested. |
| `checks/lineCodeMismatch.ts` ⟂ | An invoice line whose text names a different cost code than the one it is billed under ("Shipping 01 71 23" under 01 71 13), or only the placeholder "00 00 00". One finding per invoice per pair of codes. Unit-tested. |
| `schedule.ts` ⟂ | **When the review runs on its own** — the office's timeline as code: early looks on the 5th and 8th, the first full review on the 11th (the day after the cutoff), nightly to send day on the 15th. Nothing has its own timer: the digest's scheduler call asks `scheduledReview` and starts the run as a separate request (Hobby's 2-cron cap). Unit-tested. |
| `checks/shared.ts` ⟂ | Only what more than one check needs: name-token comparison and the one-to-one backup pairing (`matchBackup`). Anything one check owns stays in that check. |
| `settings.ts` ⟂ | POLICY, in one editable file: every threshold, and `enabled` per check. A check declares behavior; this declares what it runs with. Severity is deliberately NOT here yet — that's set from evidence in the plan's Stage 3. |
| `registry.ts` ⟂ | The one list of checks, and the runner. Asserts at load that no two checks share an id or a finding KIND (a kind is half of a suppression identity — two owners would let one ruling silence findings nobody saw). A check that throws is caught, recorded on `evidence.warnings`, and does not take the review down. |
| `summary.ts` ⟂ | The one-line summary every run carries. Claude Code's fuller reading is the pass note (`investigations.ts`). |
| `sheetCompare.ts` ⟂ | **A legacy client's Google Tracking Sheet vs JobTread**, for the monthly check's Step 4b. Pure: Claude Code posts the cells it read (`/api/invoice-review/agent` `sheet-check`), the route adds the month's bill lines and time entries. Finds bills the sync missed, codes with no column or row, broken FILTER/lookup/total formulas, `#REF!`-style errors, and labor priced at another rate than JobTread costed it. Sales tax and warranty are left out, as the sync leaves them out. Pinned by `sheetCompare.test.ts` with the Berger Bunkhouse and Main House cases |
| `evidence.ts` | All the fetching: the job roster, each job's month bills and live invoices (413-safe two-phase reads), the Drive backup listing, and one mailbox sweep for the period — the last two via the Apps Script bridge. It also does the mail→JobTread JOIN, reusing the Daily Digest's `matchVendor`/`billMatchesEmail` so there is one answer in the codebase to "is this the same invoice". Per-job failures become warnings, never a dead review. Sets `emailChecked`, so a mailbox that couldn't be searched never looks like one that came back clean. |
| `brief.ts` ⟂ | The review as a self-contained markdown briefing, for the **no-API-key path**: the page's "Copy for Claude" button and `GET /api/invoice-review?format=brief`. Opens by telling Claude the arithmetic is already done and must not be redone. |
| `rulings.ts` | The memory — what the office has already overruled, so a structurally-true finding stops coming back every month. Three scopes: this finding, this kind on this job, or this kind for this customer across every job (for an arrangement that belongs to the client). Wider is not better; it always opens at the narrowest. |
| `runs.ts` | The HISTORY — every run that has happened, appended (many rows per month; the newest is the current view). What the page opens onto, and what the learning layer reads. Best-effort throughout: an unreachable DB costs a row, never a review. |
| `lifecycle.ts` | When each finding appeared and whether it ever went away — so a row can say "new" or "standing since 3 Aug", and so per-check precision falls out of what the office does next. Fixed (stopped appearing) and set-aside (ruled on) are counted SEPARATELY: a check finding real standing facts is not a check that is wrong. |
| `norms.ts` ⟂-ish | What normal looks like, learned from stored payloads: vendor cadence, and each CUSTOMER'S typical markup (median, and name normalizers so three spellings of one supplier aren't three vendors). Attached to the evidence by the runner so checks stay pure. Below 3 months of history it returns nothing: no baseline is NO signal. |
| `misses.ts` | **The training set** — billing mistakes the review did NOT catch. The only input a genuinely new check can come from; every other memory here can only make it quieter. Deliberately cheap to file (description is the one required field). |
| `learn.ts` | Claude reads the miss log + the current check list and PROPOSES checks that would have caught them. Sonnet, thinking on — this is a reasoning task, unlike narrate.ts. Returns a spec for a human to implement; never writes a check, moves a setting, or suppresses anything. |
| `preSend.ts` | **The pre-send gate** — the same checks against ONE job, before its invoice goes out, from the job workbench. Loads evidence for that job only and therefore runs `scopes: ["job","invoice"]`: month-scoped checks are not slow against single-job evidence, they are wrong. Files nothing — a spot check is not a review of the month. |
| `dispositions.ts` | Stores the verdicts Claude Code posts from the office Mac (`/api/invoice-review/agent`). **A disposition is NOT a ruling** — it changes no number, no severity, and hides nothing. Only the office silences a finding. |
| `instructions.ts` | Standing preferences for how the month is READ OUT, injected into the summary prompt. Cannot hide a finding — that is what a ruling is for — which is what makes them safe to add casually. |
| `checks/margin.ts` ⟂ | **The check that matters most for cost-plus** — a line that reached a client invoice at cost, or under it. The markup IS the revenue, and nothing else notices: the invoice foots, the bill is captured, the backup is filed, the client pays it. Needs no history. Its whole false-positive risk is lines with NO cost recorded (JobTread holds 0 for a flat-priced line), so it judges only lines with a real cost and price above a floor; `passThroughCodes` in settings.ts is the valve for codes billed at cost on purpose. |
| `checks/markupDrift.ts` ⟂ | A customer's blended markup this month against their OWN recent median. Ascent charges different markups to different customers, so there is no house rate to check against — this check has no configured version that would work, only a learned one. Month-scoped so a customer with three jobs yields one finding, and it reports both directions (under-billing is the loss; over-billing is what the client notices). |
| `checks/vendorSilent.ts` ⟂ | The first check that reads the review's own memory rather than this month's evidence: a vendor who bills four months in five and billed nothing this month. Cost-plus means that is missing REVENUE, and an invoice that was never sent leaves no trace anywhere else. Strict by design, and silent without enough history. |
| `run.ts` | The order of operations: evidence → checks → rulings → narrative → file the run. Thin by design. |
| `investigations.ts` | The status line of a month's investigation pass (running / done / error, one row per month in `invoice_review_investigations`). The pass runs detached, and the page polls this row. |

Tests: `checks.test.ts` (what each check decides about money — the backup
matcher against the real filename convention, every math tolerance, the
period/scope rules, the mailbox calibration, the briefing, finding order) and
`registry.test.ts` (the machinery — policy from settings, a check that is turned
off, and a check that throws without taking the review down), `norms.test.ts`
(the vendor-name key, and mostly the SILENCE — every case where a
pattern-based check must not speak), `qboPush.test.ts` (the QuickBooks handoff, and mostly the bills it must NOT
report — an unreadable flag, a near-zero item, a pending bill nobody has billed
yet), `margin.test.ts` (the markup checks, and
above all the lines they must NOT judge — a no-cost line, a credit, a
pass-through code) `preSend.test.ts` (the SCOPE RULE — it proves the month-scoped
checks fire wrongly against single-job evidence, then pins that the gate leaves
them out) and `rulings.test.ts` (how far each
suppression scope reaches, and where it must stop).
Skill: `.claude/skills/invoice-review/SKILL.md` drives the same review from a
Claude Code session. Drive half: `ascent-appscript/ClientInvoiceReview.js`.

### `src/lib/onboarding/` — new-hire paperwork

| File | Role |
|---|---|
| `fields.ts` ⟂ | How a fillable PDF's fields become questions on a phone: who fills each field (hire / office / fixed / hidden), the first guess from its name and tooltip, the presets for known forms (the office's Direct Deposit form, whose fields are named "1", "2", "undefined"), the profile and its prefills. Pinned by `fields.test.ts`. |
| `pdf.ts` | Read a PDF's fields, fill one from the answers (hire fields made read-only, office fields left open, signature painted, XFA removed), append the signature record page, build the bookkeeper's packet. Pinned by `pdf.test.ts`. |
| `store.ts` | The three `onboarding_*` tables, plus the Employee tab calls over Apps Script. |
| `respond.ts` | Route helpers: the signed-in email, the caller's IP, a `no-store` PDF response. |

### `src/lib/digest/` — the Admin Daily Digest

The morning report on the home launcher: independent "checks" over the
calendar, to-dos and inbox, run once a day by a Vercel cron, summarized by ONE
Claude call, stored in `daily_digest`, and read (never recomputed) on page load.
Every check is READ-ONLY against Gmail, Calendar, the Sheet and JobTread.

**It is a schedule/to-do report, not a billing report** (pivoted 2026-08-31).
Billing has its own screens now (Tracking Sheets, `/unbilled`, `/recode`), so the
four billing checks are `enabled: false` in `settings.ts` — switched OFF, not
deleted, and their code and tests are untouched, so re-enabling one is that flag
and nothing else. Category order is calendar → to-do → follow-ups → billing, and
a category with no results never renders, which is why Billing simply disappears
while its checks are off.

| File | Purpose |
|---|---|
| `settings.ts` ⟂ | **THE one place every knob lives** — categories, the billing cutoff day, vendor/job exclusion lists, thresholds, which calendars to read, and each check's `enabled` flag. Edit here, never inside a check. |
| `types.ts` ⟂ | The check contract (`DigestCheck`, `CheckContext`, `CheckResult`, `DigestItem`) plus the stored payload shape. Why the feature is extensible: a check knows nothing about scheduling, storage, or rendering. |
| `registry.ts` | The one list of checks, each bound to its settings block. Adding a check = one import + one line here. |
| `run.ts` | The aggregator: runs each enabled check in isolation (per-check timeout; a failure becomes one `status:"error"` entry, never a broken digest), makes the single Claude summary call, stores the result. Knows nothing about any individual check. |
| `grouping.ts` ⟂ | Stored results → the categories the screen draws, worst status rolled up. Also `categoryTone`, which separates PRESENTATION from status: a check reporting `ok` with items (the calendar) draws as informational with its count, not as a green "Clear". Pure, so "categories are data, not tabs" is testable. |
| `store.ts` | Read/write the `daily_digest` row and the `digest_dismissals` rows — the ONLY things this feature writes anywhere. |
| `dismissals.ts` ⟂ | "This one is handled, stop showing it to me." Pure: builds an item's stable dismissal key (`<checkId>::<item key>`, falling back to the title) and filters a set of results by it — the same code the browser, the aggregator and GET `/api/digest` all use, so a dismissal means one thing. Dismissing never closes a JobTread to-do or touches Gmail; the office's own reminders are the one item a dismissal also marks done, in `digest_todos`. |
| `checks/timeNotInJobtread.ts` | Time records that didn't reach JobTread, or reached it with the wrong hours (`auditWorked`, above). Twice a day, because the failure is silent from every other direction: the phone said saved, the sheet holds the record, and JobTread just shows fewer hours than were worked. Read-only — a retry stays a person's decision, on /time-sync. |
| `checks/uncapturedBills.ts` | Invoice-looking mail with no matching JobTread bill (sender → vendor account → date/amount window). |
| `checks/draftBillsPastCutoff.ts` | Draft vendor bills left over from a billing month that already closed. |
| `checks/invoiceReviewWindow.ts` | The month's invoice review on the home digest, 1st to send day: what is left to fix, the countdown to the 15th, and the findings worst first. Reads the filed run history only; never starts a review. |
| `checks/reconciliationFlags.ts` | The Expenditure sheet's own `Reconciliation Flags` column, grouped by flag type. Reads the sheet's verdict; never re-derives it. |
| `checks/costVsInvoice.ts` | Jobs whose approved spend has outrun approved client invoices, past a configurable gap. |
| `checks/calendarEvents.ts` | Today's / this week's shared-calendar events (read-only scope; never a personal calendar by default). Reports `ok` WITH items — a full calendar is information, not a problem — which is what `categoryTone` exists to draw correctly. Prefixes whose calendar an event is on only when more than one calendar has events that day. |
| `checks/jobtreadTodos.ts` | Open JobTread to-dos (`isToDo=true`, `progress` null or `<1`), overdue or due within the window, grouped by assignee. Undated ones are skipped by default — a morning glance, not a backlog dump. Live-confirmed 2026-08-31: 223 to-dos org-wide, 42 open, 7 overdue + 3 due inside 7 days. |
| `checks/emailSignals.ts` | Appointments and action items *mentioned in* recent inbox email, via ONE Claude pass. **The only check that sends email BODY text off-site** — every other one reads metadata only. The body is truncated and quote-stripped on the Apps Script side (`digestEmailContent`) before it ever reaches this app, and only the extracted result is kept. |
| `checks/emailFollowUps.ts` | Inbox threads whose last message came from outside and went unanswered past a business-day threshold. |
| `claude.ts` | The digest's OWN Claude client: the email-signals extraction and the reply-box parser. Separate from `claudeExtract.ts` and `anthropic.ts` on purpose. |
| `overrides.ts` | The digest's live settings: `settings.ts` defaults layered with an admin's changes from `/admin` (`digest_settings_overrides`). Pure merge plus one DB read, read fresh every run. |
| `checks/crewActivity.ts` | Who worked where yesterday, and who is clocked in now, from JobTread time entries. |
| `checks/digestTodos.ts` | The office's own reminders set through the reply box (`digest_todos`) — the one check that reads the Companion's own database. |
| `checks/jobtreadSchedule.ts` | JobTread's dated schedule items (site visits, inspections, installs) today or soon, filed under Calendar. |

Items in a category flagged `dismissible` in `settings.ts` (To-Do, Follow-ups)
carry a Dismiss button on the card. It POSTs `/api/digest/dismiss`, which stores
the item's key; the run filters those out before Claude writes the brief, and
GET `/api/digest` filters the already-stored digest, so a dismissal takes effect
on the current card and every later one. Undo lifts it (deactivated, not
deleted). A follow-up's key carries the thread's last-message time, so a NEW
reply on a dismissed thread comes back.

Tests: `digest.test.ts` (registry wiring, category grouping, the informational
vs. clear tone, the billing-cutoff rule, vendor/amount matching, the exclusion
lists); `dismissals.test.ts` (item identity across re-runs, and what filtering
does to a check's status and summary).

Tests live beside their module (`*.test.ts`): `arAging` (the bucket BOUNDARIES,
exactly — every failure in that module is silent, since an invoice in the wrong
bucket still shows a correct balance), `billing`, `billLineMath`,
`jobtread`, `paveGateway`, `leadInquiry`, `taskRunner`, `appsScript`,
`lopezrocksParse` (the address checks first — a malformed `/lopezrocks?…` must
read as the front page, never as a fetch — then that no post markup survives,
then each page shape).

## `src/app/` — pages (grouped by the view group in `views.ts`)

Each page is a server component (`page.tsx`) that hands non-secret context to a
`"use client"` component. Group/roles for each is set by its `VIEWS` entry.

- **Financials:** `trackingsheet` (Tracking Sheets — the billing hub, gated by
  the `recode` view id: Board, BillCodingCard, TimeCodingCard, ClientInvoicing,
  DraftWorkbench, AllJobs), `bill/[docId]`, `add-bill`,
  `labor-review`, `invoice-review`
  (a month's client invoices checked against the bills and the Drive backup),
  `jobs`, `clients` (Directory — the customer/job directory, and the one
  page that EDITS a JobTread record), `unbilled`, `ar-aging` (Receivables — unpaid
  client invoices, aged), `deposit-tracker` (Deposit checks — photos of the
  checks to the Office job's Checks folder, the invoices they pay marked
  paid, the email to Sara and Casey drafted; admin-only),
  `vendors`, `bill-search` (fast full-text search over every bill + line item,
  live JobTread plus seeded pre-JobTread history), `email`, `needs-review` (the
  queue of bills flagged "Needs review" — corrections the app can't make itself),
  `needs-project`,
  `payments` (Sunset Statements), `expenditure-history`, `lswdd`, `amazon-import`,
  `tracking-sheet`, `budget-import` (a tracking sheet's estimate as a JobTread
  budget import CSV, costs only; built by appscript `BudgetImport.js`),
  `specs` (Specifications — an architect's spec selection list with live links),
  `invoicing-summary` (Invoice Status — every job billed in a month, its
  invoice's payment state and JobTread email state, and the "Draft invoicing
  email" button; figures come from appscript `MonthlyInvoicingSummary.js`,
  whose Package doc the tracking-sheet push still rewrites on its own).
- **Field:** `safety-meeting`, `mileage-tracker`, `employee-time`, `tools`,
  `tool-tracker`, `tool-schedule` (every role; `/tool-schedule/edit` is the
  office's, under `tool-schedule-edit`), `rfis` (on no workspace since 2026-09-29 — nobody logs RFIs),
  `time-off` (self-service; `/time-off/office` is the office console under the
  `time-off-admin` view — both pages render `TimeOffView` in `TimeOff.tsx`),
  `requisitions`, `onboarding` (a new hire's own profile and forms; every
  role, and Today sends a field login with open paperwork here instead of
  Time). (`/more`, "The Rest", redirects home.)
- **Assistant:** `chat`.
- **Office:** `office` (the Office dashboard — the "Office" JobTread job's open
  to-dos and its Files tab as a `?folder=` browser, read server-side via
  `getOpenToDos` + `getJobFiles`; the billing month's bills on Office and Shop
  via `currentBillingPeriod` + `getJobBillsForMonth` + `resolveShopJobId`; the to-dos are editable — `OfficeTodos.tsx` →
  `/api/office/todos`; images show as a thumbnail grid,
  `OfficeImages.tsx`, opening in the bill scans' `InvoiceLightbox`), `employees`, `leads`,
  `onboarding/office` (New Hires — invite a hire, the blank forms and their
  field setup, the signed packet; office + admin, the invite admin-only),
  `job-board` (Jobs — Active jobs, PreCon jobs and leads as kanban rows; the
  route is `/job-board` because `/jobs` is Job Cost), `labor-import`, `labor-rates`,
  `time-sync`, `notices` (post an announcement to the team — banner or popup,
  targeted at groups and/or named people, now or on a schedule; office + admin).
  `vendor-mail` is now a section of Inbox (`/email?section=mail`); its page
  redirects there.
- **System / admin:** `admin`, `logs`, `historical-cost`, `requests`,
  `actions`, `journal` (the financial journal — every write the app has made to a bill, a
    line or a time entry, read-only; admin by default alongside Logs, and
    grantable per user for a bookkeeper), `changelog` (what each working session changed and what is still
  in flight — reads `src/lib/sessionLog.generated.json`; see "The session
  ledger" below), `course` (the in-app "Reading Your Own App" walkthrough —
  `course/page.tsx` + `course/[seg]` reader; metadata `src/lib/course.ts`,
  bodies `course/segments.tsx`, progress `src/lib/useCourseProgress.ts`),
  `help` (the staff instructions — `help/page.tsx` + `help/HelpBrowser.tsx`
  over the topics in `src/lib/help.ts`; the ONE view every role holds, and
  `/help#<topic-id>` opens a single answer, which is what the header's search
  links to), `lopezrocks` (LopezRocks — Lopez Island's community board, re-drawn
  for a phone; read-only; EVERY role, linked from the bottom of Home), plus
  `login`, `privacy` (ungated).
- **Root:** `page.tsx` (home launcher — the primary nav), `layout.tsx`,
  `manifest.ts`, `global-error.tsx`.

## `src/app/api/` — server routes (the only place the grant key is used)

Grouped by domain; each folder is `…/route.ts`.

- **JobTread access:** `pave` (the guarded generic gateway), `jt-sync`,
  `jt-users`, `jobs/*`, `job-budget`, `unbilled`, `historical-cost`,
  `bill-search` (query the local bill/line index; `bill-search/refresh` sweeps
  JobTread into it, `bill-search/seed` imports the pre-JobTread sheet history),
  `clients` (the whole customer/job directory — uncached on purpose, since the
  page that reads it is the page that edits it), `clients/customer`,
  `clients/job`, `clients/update` (the ONE write onto a job / customer /
  contact / location — allowlisted, journalled with its prior value, and behind
  `writesEnabled()`), `clients/invoice-tag` (the Gmail capture label, via Apps
  Script).
- **Bills / coding:** `bill/*`, `add-bill`, `add-line`, `delete-line`,
  `combine-lines`, `code`, `coding-queue`, `trackingsheet/*`, `bill-status`,
  `bill-fields`, `billing-month` (the org-wide billing month the office SET —
  GET for anyone signed in, POST for office/admin, journalled; it overrides the
  10th cutoff for every non-Sunset bill),
  `bill-issuedate` (the BILLING MONTH — JobTread's `issueDate`),
  `bill-duedate` (JobTread's "Payment Due" — when the VENDOR gets paid; an empty
  date puts the bill back on net-30), `bill-number` (the vendor's own invoice
  number — JobTread's `externalId`), `bill-tax`, `bill-reviewed`, `uncaptured`,
  `vendor-bills/*`, `vendor-bill-count`, `stuck-vendors`, `needs-project`,
  `reassign-job`, `coding-draft` (the cross-device backup for staged, not-yet-
  synced coding — companion DB only, never JobTread; see `lib/codingDraft.ts`).
- **Bill and vendor actions:** `bill-void` (POST — voids a bill, never
  deletes it, through Apps Script `voidBill`), `split-bill` (POST — split a
  draft bill in two, `lib/splitBill.ts`; preview only unless writes are on),
  `shop-job` (GET — the "Ascent - Shop" job id for the buyback dialog),
  `document-access` (GET/POST — a month's or one bill's client Document
  Access list), `month-actions` (GET — when each month-closing action last ran),
  `vendor-coi` (a vendor's COI in Drive, via appscript `VendorCoi.js`;
  `vendor-coi/status` is the COI expiry + last-request read and the
  companion-only request/override writes),
  `vendor-create` (create a JobTread vendor with its sender address, refusing a
  name that already exists), `vendor-details` (save a vendor's email, phone,
  address and Bill Type), `vendor-mail` (+ `vendor-mail/seed` — the vendor-mail
  completeness check and the one-period-at-a-time index fill).
- **Invoicing surfaces:** `deposits` (GET — one job's deposit ledger and client
  payments; POST edits only the companion's `deposit_links` row, never JobTread),
  `deposits/apply` (POST — the one JobTread write: a DRAFT invoice's Deposit
  line, checked against a fresh ledger, verified, journalled),
  `deposit-tracker/*` (`photo` POST — one check photo onto the Office job,
  folder Checks; `invoices` GET — open client invoices with a balance;
  `record` POST — the payments, one per customer account, re-checked against
  JobTread first and safe to press twice; `email` POST — the Gmail draft via
  Apps Script `draftDepositEmail`),
  `ar-aging` (GET — every open client invoice, bucketed
  by age; "today" is resolved in the ORG timezone, because a UTC lambda would
  age a boundary invoice a day early), `stage/*`, `invoice-review` (GET runs a month's
  client-invoice review, or `?format=brief` for the paste-into-Claude version;
  POST records or lifts one standing ruling), `lswdd` (`bills` GET — the newest
  statement's bills and pay state, read by `/lswdd` and the pay reminder pop-up
  `src/components/LswddPayReminder.tsx`; deadline rule in `src/lib/lswddPay.ts`),
  `amazon-import/*`,
  `sunset-statements/*`, `sunset-duplicates`, `sunset-expense`,
  `sunset-statement-bills` (Create Bills: one draft Bill per unpaid statement on the Office job),
  `sunset-statement-links` (Link a statement line to its bill, on any job — companion DB only), `buyback`,
  `invoicing-summary` (GET reads a billing month — every job billed, its labor,
  bills and total, the office's edits and where the doc is, all from appscript;
  then adds each invoice's live payment + email `status` from JobTread. POST
  saves one edit or writes the doc, proxying appscript, which holds the Docs grant).
- **Labor / time:** `employee-time/*`, `labor-rates/*`, `labor-review/*` (the API only; the page folded into Tracking Sheets 2026-10-18),
  `labor-report` (the month's company-wide Drive sheet),
  `time-entry` (one entry, edited in place — gated under `recode`),
  `time-off/*`, `time-sync/*`, `expenditure-history`.
- **HR / field ops:** `onboarding/me` (+ `me/forms/[id]` — the new hire's
  own, by session email), `onboarding/office` (+ `forms`, `file` — the office's,
  under `new-hires`), `employees/*`, `team/*`, `mileage/*`, `tools`,
  `tool-tracker`, `tool-schedule` (+ `catalog`, `rules`, `holds`, `jobs` — the editor's, under `tool-schedule-edit`), `safety-meeting`, `requisitions`, `rfis/*`,
  `feature-requests/*`.
- **Leads:** `leads/*`.
- **Jobs page:** `job-board` (the Active and PreCon rows — `getJobBoard` +
  `getJobs` + `getRecentJobToDos`, all cached; read-only).
- **Assistant / misc:** `chat`, `ocr-serial`, `tracking-sheet`, `budget-import`, `specs`, `vendors`,
  `bank-details`, `notices/*` (the reader's own feed + dismiss — UNGATED, every
  role must be able to receive a notice; the authoring CRUD is
  `admin/notices`, gated by the `notices` view so office can post too).
- **Platform:** `auth/[...nextauth]`, `login`, `logs`, `journal` (GET only —
  read the financial journal, filtered by bill, job or person; there is
  deliberately no POST, because a journal you can amend answers nothing),
  `actions`, `usage`,
  `usage-track`, `digest` (GET the stored digest — gated by the admin-only
  `digest` view; `digest/run` builds one and is the ONE route listed as PUBLIC
  in middleware, because the daily cron carries no session — it checks a bearer
  secret or an admin session itself; `digest/reply` the reply box;
  `digest/dismiss` marks one To-Do / Follow-up item handled, and undoes it).

> Gateway rule of thumb: reads are open to any signed-in role; writes are
> triple-gated (see `CLAUDE.md` → "The Pave gateway"). New pages are read-first.

## `src/components/` — UI

- **Design system:** `ui.tsx` — build EVERY UI on these primitives (see the list
  in `CLAUDE.md`). Never hand-roll styles.
- **Chrome / nav:** `AppHeader` (☰ menu, logo, search, Add bill — one row; the
  logo IS the light/dark switch), `AppMenu` (the ☰ drawer — every page by
  workspace, from `src/lib/workspaces.ts`), `WorkspaceTabs` (the workspace's
  tab strip under the header, mounted once in the root layout),
  `GlobalSearch` (the app's ONE search box, in that
  row — pages + vendors + bills + line items, from any
  page — hidden for the FIELD role), `TabBar` (the bottom bar — each role's
  slots from `BARS` in `src/lib/workspaces.ts`),
  `HomeActions` (the Actions button panel on Today — one big button per job
  done from a phone, each on its own view; Deposit checks first, which opens
  the camera from the tap and hands the photo to `/deposit-tracker`),
  `HomeMasthead` (the iPad home's head — the date, and the BILLING MONTH as a
  dropdown: office/admin set the month every non-Sunset bill files into, a lead
  only reads it. It goes RED past the 10th while still behind the calendar
  (`billingMonthStale`); nothing turns over on its own any more. The date line
  shows from `pad` up; the month shows at every width),
  `PageTitle`, `ThemeToggle` (takes any face as `children` — the header gives it
  the logo), `AppearanceCard` (the home page's Appearance block — picks the
  PALETTE and the theme, both per device, and links admins to the theme editor;
  see `src/lib/palette.ts`, `src/lib/paletteDraft.ts` and `THEME.md`),
  `DesktopAlertsCard` (the block under it — the per-device switch for OS
  notifications about notices, plus a test alert; SELF-HIDING where the browser
  has no Notification API, i.e. every iPhone; rule in `src/lib/noticeToasts.ts`),
  `AscentLogo` (the lockup; `tone="white"` is the reversed, black-ground
  variant), `LoadingScreen` (the logo-on-black cover — one look, three
  triggers: `SplashScreen` on app open, `RouteLoadingScreen` on an in-app tap,
  and `src/app/loading.tsx` for hard loads; the last two only fade in past
  180ms, so a fast page swap stays silent),
  `SyncNowButton`,
  `AccessProvider`, `CopyProvider` (editable page text —
  `useCopy()`), `UsageBeacon`, `PreviewBanner` (the admin's "viewing as {role}"
  bar + its "Return to my view" link — see `src/lib/preview.ts`).
- **JobTread pickers / links:** `JobPicker`, `CostCodeSelect`,
  `JtLink`, `LinkPending`, `BillStatusBadge`, `BillingSummary`.
- **Bills and vendors:** `BillMove` (moving a bill between jobs, run in the
  BACKGROUND by a provider in the root layout — the void-and-recreate takes
  30–90 s), `InvoiceViewer` (a bill's scan as a flat image plus lightbox,
  never an iframe), `SplitGrid` (the three-up workbench row with drag handles,
  widths in localStorage), `DocumentAccess` (add a client contact to the
  "Document Access" list of a month's bills or one bill), `LinkVendor` (point
  an unresolved vendor name at the existing JobTread vendor through the Apps
  Script `linkVendor` action), `CoiDot` (the green dot beside a vendor with a
  COI on file), `PackageEmail` (the "Draft invoicing email" button).
- **Navigation and pickers:** `JobTabs` (one job's pages as a tab row, each
  opened on the job through `?jobId`), `PageTabs` (joins pages that are one
  menu row: Audit, Look & Text, Help), `MonthPicker` (the billing month as a
  tappable heading), `SafetyTopicPicker` (search, season and category over
  `lib/safetyTopics.ts`).
- **Chrome and admin:** `CopyInPlace` (Admin → edit page text in place),
  `UpdateNotice` ("Ascent was just updated…" under the loading logo on the
  first load after a deploy), `ScriptJobs` (one button per Apps Script
  `COMPANION_TASKS` registry entry, from `GET /api/actions`).
- **Feature widgets:** `InvoiceReconcile`, `InvoiceSweepResult`,
  `UncapturedBills`, `StuckVendors`, `NeedsProject`, `Notices` (`NoticeCenter` —
  BOTH reader surfaces for a notice, the banner stack under the header and the
  interrupting popup, off ONE feed request; mounted in the root layout, and it
  re-reads the feed on tab focus — and every five minutes whatever the tab is
  doing, which is what lets a background tab raise a DESKTOP TOAST for a notice
  that arrives while the reader is elsewhere), `NoticesAdmin` (the authoring panel — what it says, banner or popup,
  the schedule window, and the groups/people it targets; rendered by both
  `/notices`), `SunsetDuplicateScan`, `SunsetExpenseSwitch`, `SunsetLinkPicker`, `SunsetStatementBills`, `TrackingSheetSync`,
  `TrackingSheetRisks`, `ReportText` (Claude Code's monthly report on `/invoice-review`, drawn from markdown by `src/lib/reportMarkdown.ts` — no HTML injected), `TimeEntryList` (**the month's time entries, rendered by
  BOTH Labor Review and the board's Time & labor panel** — the list, its filters,
  its grouping, the selection and the recode drawer, in one place so the two
  can't drift again; money stays the caller's, since the two pages legitimately
  differ on what a code has left), `Donut`, `SignaturePad`, `QrScanner`, `CopyButton`,
  `Spinner`, `HomeTodos` (the admin To Dos card on Home — the live JobTread
  to-do list and the form that creates one, then the stored digest's other
  categories under them; no hardcoded tabs),
  `HomeJobBoard` (the board across the top of Home: a budget donut + calendar
  position per active job for office/admin, one wide panel for a lead's own job;
  the ROLE decides which, server-side in `/api/home/board`. Each card also
  carries this billing month's TO BE INVOICED in its top-right corner, and the
  headline above the row is their sum — one `/api/jobs/to-be-invoiced` fetch for
  the whole board, in the month the masthead's dropdown sets), `JobGantt` (one
  job's JobTread schedule PHASES as bars on a shared timeline with today marked
  — `isGroup` tasks only, ~15 bars instead of ~110; geometry from `barPct` /
  `axisTicks` in `lib/jobBoard.ts`, data from `/api/home/gantt`).

## `src/db/` — companion DB (Drizzle + libSQL; companion-only data, NOT JobTread)

`schema.ts` tables: `allowed_users`, `role_access`, `role_menu`, `usage_events`,
`saved_bills`, `feature_requests`, `flagged_time_entries`,
`labor_rate_catalog`, `labor_rate_groups`, `leads`, `lead_activities`,
`lead_settings` (ONE row — the org's amber/red quiet thresholds; no row means
the defaults in `lib/leadBoard.ts`),
`billing_month_setting` (ONE row — the billing month every non-Sunset bill files
into; no row means the automatic 10th cutoff),
`lead_inquiries`, `lead_inquiry_dismissals`, `leave_policies`, `leave_balances`,
`leave_requests`, `leave_transactions`, `jt_user_links`, `notices`,
`notice_reads`, `rfis`, `sunset_statements`, `sunset_statement_links`, `page_copy`,
`page_guides` (one JSON row per page — the per-element help topics an admin
wrote in the help overlay; no row means that page has no guide),
`bill_index`,
`bill_line_index`, `bill_index_meta`, `daily_digest`, `digest_dismissals`
(items the office marked handled on the digest — hidden from every later run),
`invoice_review_rulings`
(the invoice review's standing rulings), `invoice_review_runs` (every review that
has run — the history the learning layer reads), `invoice_review_finding_state`
(when each finding appeared and whether it went away — ages + check precision),
`invoice_review_misses` (mistakes the review didn't catch — the training set),
`invoice_review_instructions` (how the month is read out),
`coding_drafts` (unsynced Tracking Sheets coding, per user and per scope — the
cross-device BACKUP for a staged draft; localStorage is the primary),
`tool_kinds` (types added by hand), `task_tool_needs`, `tool_holds` (bookings),
`tool_job_excludes` (the tool schedule's plan — `lib/toolScheduleStore.ts`; `task_tool_rules`
is read as a fallback; `tool_kind_members`, `tool_kind_codes` and `task_code_rules` are retired and unread),
`mileage_open_trips` (the started-but-not-ended trip, one row per driver — the
cross-device backup for the phone's copy; a finished trip goes to the Mileage
sheet instead, see `src/lib/mileageTrip.ts`),
`invoice_review_dispositions` (Claude's verdict on each finding — a reading, not
a ruling),
`deposit_links` (one row per job with a deposit — the facts JobTread has no
field for: which deposit payments are this job's, the opening balance, the draw
rule; see `src/lib/depositLinks.ts`),
`job_notes` + `job_note_edits` (**notes, kept forever** — one row per note, edited in place; every save appends the whole note before and after to the edit table. Nothing deletes or trims either; see `src/lib/notes.ts`),
`financial_events` (**the financial journal** — every write the app makes to a
money record: actor from the session, field, before, after, and which of
read/client/none that before-value is. Append-only, never trimmed; see
`src/lib/financialJournal.ts`),
`onboarding_forms` (the blank forms new hires fill — the PDF and its field
setup), `onboarding_intakes` (one row per invited new hire, keyed on the
sign-in email — the profile, and when it went to the bookkeeper),
`onboarding_submissions` (one filled, signed PDF per hire per form — they hold
SSNs and bank numbers, so "Sent to bookkeeper" deletes them).
`month_action_runs` (one stamp per month-closing action, scope and month —
see `src/lib/monthActions.ts`), `leave_import_aliases` (the hand-made CSV
line → employee matches for the PTO balance import),
`invoice_review_investigations` (one status row per month for the
investigation pass, with Claude Code's full report in `report`), `monthly_check_runs`
(each scheduled monthly-check start and outcome posted by the office Mac, with
the log tail on a failure), and the digest's own tables: `digest_settings_overrides`
(an admin's per-check changes over `settings.ts`), `digest_ignore_rules`
(senders the owner said to ignore), `digest_replies` (an audit row per reply-box
message and its parse) and `digest_instructions` (standing preferences; inert
since the brief stopped being model-written, 2026-09-04). Access via `src/db/index.ts`.

(`bill_index`/`bill_line_index`/`bill_index_meta` back the `/bill-search` index —
the searchable snapshot of every bill + line item, plus its refresh/seed
bookkeeping; the FTS5 `bill_fts` virtual table over them lives only in
`db/index.ts`'s DDL, as Drizzle can't model it.)

(`notices`/`notice_reads` back both notice surfaces — one row carries the text,
the banner/popup choice, the schedule window and the audience (roles + emails);
a notice is dismissed per-user and stays gone, and an undismissible banner
writes no read row, which is what keeps it standing for its whole window; `lead_inquiry_dismissals` hides a web-form inquiry from
the leads board without deleting it.)

## Off-app scripts — run on the office Mac mini

| Folder | Role |
|---|---|
| `scripts/signal-sync/` | **Not app code — runs on the office Mac mini.** `signal_sync.py` reads Signal Desktop's encrypted database (a read-only copy; key from the Keychain), reports every chat to `/api/google-chat/signal-import` and gets back each one's rule from the AscentBot page, then POSTs the new messages of the job and office chats (`SIGNAL_IMPORT_SECRET`) and writes a monthly CSV backup. `install.sh` sets up the venv and the hourly launchd job. Setup in its `README.md`. |
| `scripts/monthly-check/` | **Not app code — runs on the office Mac.** `install.sh` makes the token (`~/.ascent-monthly-check/token`, same value as Vercel env `REVIEW_AGENT_TOKEN`) and a launchd job; `run.sh` runs hourly and, on review days after 9 am, runs the `/monthly-check` skill headless on Opus; `agent.mjs` is the skill's only door to `/api/invoice-review/agent`. Log `~/Library/Logs/ascent-monthly-check.log` |

## The session ledger — what each session did

Not application code. It exists because work here is sporadic and interrupted,
and a session that stops mid-thought used to leave nothing on disk saying what
it was doing. The same six files live in `ascent-appscript`.

| File | Role |
|---|---|
| `scripts/session.mjs` | The ledger CLI: `start`, `log`, `set`, `note`, `brief`, `board`. One file per session under `.claude/sessions/`, keyed to the branch. Dependency-free. |
| `scripts/ship.sh` | Ends a session (`npm run ship`): commits the ledger, rebases onto `origin/main`, pushes `HEAD:main`. The pre-push hook still runs typecheck + build. |
| `.githooks/post-commit` | Appends each commit to the session file and stages it. Skips mid-rebase/merge/cherry-pick, and never fails a commit. |
| `.claude/hooks/session-start.sh` | Arms `core.hooksPath` (a fresh CCR clone has it unset), fetches `origin/main`, safe-fast-forwards, reads the ledger into Claude's context. |
| `.claude/hooks/session-stop.sh` | Stamps `updated`, and asks once for `next:` when the session has commits but no next step. |
| `SESSIONS.md` | **GENERATED** index over every session file. Do not hand-edit — `ship` regenerates it after the rebase, which is what keeps two sessions from conflicting on it. |
| `src/lib/sessionLog.generated.json` | **GENERATED** by the same command — the ledger as data. Committed because the deployed bundle can't read `.claude/sessions/`. |
| `src/app/changelog/page.tsx` | The page over that JSON (view `changelog`, System group). Pure server component; `<details>` does the expansion, so it ships no JavaScript. |

## The theme editor

| File | Role |
|---|---|
| `src/app/globals.css` | The token blocks — one per palette per theme. The only place a palette's values live. |
| `tailwind.config.ts` | Maps `accent`/`brand`/`line`/`ink` onto those variables, plus the warm `neutral` ramp. Also owns `screens` — Tailwind's five plus `pad` (744px), declared as a full sorted object so a `pad:` rule cannot outrank an `xl:` one. |
| `src/lib/palette.ts` | Which palette is painted: the `data-palette` attribute, the localStorage key, the labels. |
| `src/lib/paletteDraft.ts` | The editor's data layer — the editable token list (which IS its UI), hex/HSL maths, WCAG contrast, and the per-device draft store. |
| `src/app/theme/page.tsx` | The editor (view `theme-editor`, admin-only). Pickers, H/S/L sliders, live contrast, a sampler, and Copy CSS. |
| `THEME.md` | Both palettes with every value and the reasoning, plus how to add a third. |

The editor needs no preview pane: the tokens are CSS variables on `<html>`, so
it writes them as inline styles and the whole app repaints. A draft is per
device and never committed — shipping is pasting Copy CSS into `globals.css`.

## The cross-repo boundary

The companion never touches Sheets/Drive directly. Anything Sheets/Drive-backed
goes: **companion page → `src/lib/appsScript.ts` → `/api/…` route → Apps Script
web app (`doPost` action router) → the matching `.js` file in
`ascent-appscript`.** See that repo's `CODEBASE_MAP.md` for the back-end side.
JobTread is the source of truth; the appscript hourly loop mirrors it to the
Sheet + Drive. Don't add companion write paths that race that mirror.

(`daily_digest` holds one row per day: each check's STRUCTURED result, the single
model summary paragraph over them, and the run log. Rewritten in place by
"Refresh now", so a date has exactly one digest — see `src/lib/digest/store.ts`.)
