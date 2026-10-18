# CONSOLIDATION_PLAN.md — `ascent-companion`

Read 2026-10-18 against the working tree. Status: **agreed 2026-10-18** (owner answers
below). Stage 0 is next. Web version, with the before/after chart and a
"where did my page go?" lookup: <https://claude.ai/artifact/9i159BFud4dbuvjwVcgTbj>

`NAVIGATION_PLAN.md` (2026-09-29) laid one menu over the pages and kept every
page. This plan is the next step: it merges the pages themselves. The rules of
that plan still hold. Never rename or merge a view id. A tab that needs its own
gate gets its own path. Every old route redirects.

---

## The answer

Build each hub around the thing the office works on: the **month**, the **job**,
the **inbox**, the **pay period** and the **person**. Open a bill **in place**
on every screen.

| | Today | Proposed |
|---|---|---|
| Pages on the menus (admin) | 48 | 28 |
| Pages on the menus (office) | 42 | 25 |
| Page changes to close a month | ~10 (4 by search) | 1 |
| Page changes per bill coded, iPad | 2 | 0 |
| Places a job is picked | 7 | 2 |
| Page changes, lead → job with a budget | 4–5 (3–4 job picks) | 1–2 (1 pick) |
| Page changes, pay-period close + month end | 8–9 | 1 |

Usage is Vercel server renders, 2026-09-18 to 10-18, all roles (Web Analytics
is off). The bill page is first (1,214), Tracking Sheets second (1,067).

## Findings, ranked

1. **A bill is a page change.** Below 1280px every bill tap on Tracking Sheets
   goes to `/bill` and back (`Board.tsx:1604-1619`), including 1024–1279px where
   the board is already two columns. One bill card has three hosts (board column,
   `/bill`, docked panel/popup) with three save models.
2. **The month close is spread over 7 pages.** Invoicing is one menu row with no
   strip (`workspaces.ts:194, 200`). Taxable Flags, Invoice Review and Invoicing
   Package have no in-link from any page; search is the only way in. The
   package's email button is on Tracking Sheets (`AllJobs.tsx:164-177`).
3. **One inbox queue lives on three pages.** Email Invoices, Mail Check and Not
   in JobTread each show one stage of the same bill, plus two home banners and
   two Tracking Sheets panels. "Processed" is a Gmail label that Mail Check
   ignores. Email Invoices (311) has no Today row.
4. **A job lives in 7 places with 3 kinds of picker.** Only Specs and RFIs read
   `?jobId`. No Clients page links to another.
5. **Pay-period work is on 5 pages with 4 periods**: half month (timesheets,
   email), last 7 days (`timeSync.ts:258`), calendar month (Labor Report),
   "since last accrued". Pay types have three write paths. One person has six
   keys.
6. **The office phone cannot reach most pages** since `1e2362f` removed ☰ for
   the office role. Incoming Bills, Employees, Search and Office are reached only
   by typing a search. Nothing links to `/employees`, `/email`, `/vendor-mail`,
   `/expenditure-history` or `/labor-rates`. Help still says "tap ☰"
   (`help.ts:112-127`).
7. **The same action in many places.** Tracking-sheet Sync: 5. Labor Report: 5.
   Run a script job: 3. The default month: 4 rules.
8. **The look varies.** 14 pages draw a bordered card per record. Chips mark
   ordinary state. Widths change between tabs of one workspace.

## The target map

| Workspace | Pages (tabs) | What merges in |
|---|---|---|
| **Home** | — | An "Invoices to log" row. One to-do list (yours + the Office job's, de-duplicated). Reminders on phones. Each queue row opens its hub filtered. |
| **Invoicing** | Tracking Sheets · Checks · Package | Labor Review → the labor panel's wide mode. Finalize → beside Sync; Pause/Pin → Company tools. Historical Cost → a SheetGap drawer. Checks = Invoice Review + Check all Jobs + Bill Corrections + Taxable Flags + sheet risks. Package = Invoicing Package + its email. Bill drawer at every width; Add bill as a sheet. Strip returns. |
| **Incoming Bills** | Inbox · Statement Import · Sunset | Inbox = Email Invoices + Not in JobTread + Mail Check (filter), plus the email-scan buttons from Actions. Statement Import = LSWDD + Amazon with a source picker. Sunset unchanged (leads hold it). |
| **Jobs** (was Clients) | Job Board · Customers · Receivables | Customers = Leads + Directory's customers. New job page `/job/[id]`: Overview · Record (Directory) · Cost (Job Cost + Budget Import) · Specs · Billing (Unbilled + receivables + deposit). RFIs retire. |
| **Employees** | Employees · Pay Rates · Safety Meeting | The person record gains pay rates and time defaults, time-off balance and ledger, miles. Pay Rates keeps only the catalog. People workspace dissolves. |
| **Time** | Time · Payroll | Payroll = one pay period: Time Off (Office) approve + accrual, Time Sync (widened), each employee's total linked to their timesheet, the time-entries email, month end (Labor Report, Labor Import, miles PDF). |
| **Search** | Bills · Vendors · Archive | Vendor Addresses → a Vendors filter. Archive reads `?q`. Header search also finds jobs and customers. |
| **Office** | Office Dashboard · Notices | Dashboard loses its to-dos (Home has them). Actions dissolves: each button moves beside what it updates. |
| **My Work** | Miles · Tools · Requisitions · Time Off | No change for the office. |
| **Help** | Help · App Feedback | Changelog → a short "What's new". Course is removed (owner, 2026-10-18). |
| **Admin** | Access · Look & Text · Audit | Look & Text = Page Text + Theme. Audit = System Logs + Financial Journal + Activity. Digest settings → Home's To-dos card. |

## Fix first (broken today)

- Office phone door (decision 1), then the ☰ help topics (`help.ts:112-127, 153, 759`).
- Tracking Sheets ≥1024px: closing actions show only on pointer hover
  (`Board.tsx:2597, 2647-2651`). Untested on an iPad.
- Admin › Access: active tab is white on white in Website · Dark
  (`admin/page.tsx:98`, `globals.css:193`).
- "Delete" where the code voids (`BillCodingCard.tsx:846`,
  `historical-cost/page.tsx:204, 344`). The Sunset duplicate legend says
  "delete or deny" (`SunsetDuplicateScan.tsx:199-200`).
- "Link Google tracking sheet" opens Finalize, which lists only linked jobs
  (`Board.tsx:1766-1770`).
- Add bill → Review coding → Back lands on a blank form (`add-bill/page.tsx:790`).
- Viewing another employee's time: "saved as them" beside "View only"
  (`EmployeeTimeClient.tsx:2097-2115`).
- Variable names and "redeploy" on screen (`amazon-import:719`,
  `time-sync/page.tsx:224`, `bill/[docId]/page.tsx:1617-1621`).
- Four month-default rules (`AllJobs.tsx:40`, `Board.tsx:282`,
  `LaborReview.tsx:137`, `InvoiceReview.tsx:86-91`, `tracking-sheet/page.tsx:241`).
- Today's Requisitions row opens unfiltered (`TodayQueue.tsx:124`). Employees
  table is 58rem minimum (`employees/page.tsx:430`).

### Stage 0 status, 2026-10-18

Shipped: the office Pages list; ☰ help topics; "Void" for the void buttons and
the Sunset legend; the Admin tab colour; closing actions under the columns on a
touch screen 1024px+ (`(hover: none)`); plain words for the writes-off banners;
the dead "Link Google tracking sheet" link replaced by a note; Home's
Requisitions row opens on Requested; the bar lights a slot for its whole
workspace; "Check this job" gated on `invoice-review`; routes gated —
`/api/bill-review` (recode), `/api/sunset-statements` and
`/api/sunset-duplicates` (payments), `/api/logs`, `/api/chat`, `/api/rfis`,
`/api/jobs/browser` (jobs).

Not done: the shared month default (moves to stage 2, where Tracking Sheets'
month handling changes anyway); the Employees phone list (stage 5);
`/api/jobs/cost-detail` stays open because a lead's Home job panel reads it; the
acting-as header is now right (the office can edit as another employee since
1f3b4eb); Add bill → Back (stage 1).

### Stage 1 status, 2026-10-18

Shipped: below xl a bill opens in the board's popup (`BillPopup`) instead of
`/bill` — from the job board's bill list, the cost-code view and the all-jobs
month list — with ‹ › paging through the list and a "Full page" link for what
the popup does not carry (approve, void, flag). Add Bill's "Review coding"
opens the new bill in the same popup, so the result and Add another stay on
screen. The popup saves a bill at a time, straight to JobTread, as `/bill`
does; no write path changed.

Later the same day: the popup carries Approve, Void and the Needs review flag
(blocked while coding is unsaved), and Summary mode opens bills in the popup.

Dropped from stage 1: Add Bill as a sheet. With "Review coding" in place the
page no longer costs a round trip, so a sheet would move code without saving a
page change. `Sheet`/`Tabs` primitives wait for stage 2, which needs tabs.

### Stage 2 status, 2026-10-18 (first slice)

Shipped: the Invoicing tab row (`InvoicingTabs`: Tracking Sheets · Checks ·
Package, carrying `?ym`) on Tracking Sheets (both views), Checks and Package.
Invoice Review is renamed **Checks** and holds three sections — Findings,
Flagged bills (was Bill Corrections) and Taxable lines (was Taxable Flags) —
picked by `?section=`. `/needs-review` and `/taxable-lines` redirect there; their
view ids stay, now in `OUTSIDE_WORKSPACES`. Home's Bill Corrections row opens
the Flagged bills section.

Later the same day: "Draft invoicing email" moved from Tracking Sheets' all-jobs
row to Package's action bar (`src/components/PackageEmail.tsx`).

Then: "Finalize sheet" sits beside "Sync to Tracking Sheet" on each job's
workbench. `/tracking-sheet` is renamed "Sheet sync settings" (pause, pin the
month), off the menu, linked from Tracking Sheets' Company tools.

Then: the tab row hands on the month on screen, not only one in the address;
Tracking Sheets (all jobs) opens on the month the office set on Home when one is
set.

Then: Labor Review folded (owner: neither the unapproved switch nor the cost
codes list is used). `/labor-review` redirects to Tracking Sheets with its
`jobId`/`ym`; the job workbench's labor panel holds the same list.

Not done in stage 2: Check
all Jobs merged into Checks; one dismissal model; one taxable rule; Labor
Review and Historical Cost into the workbench. The job workbench and Labor Review still default by the 10th cutoff when
opened with no month (links from Tracking Sheets always carry one). A production Page Text override of `home.dest.invoice-review.label`
would still say "Invoice Review" in the menu.

### Stage 3 status, 2026-10-18 (first slice)

Shipped: `/email` is **Inbox**, with three sections picked by `?section=` —
To log (was Email Invoices, `EmailInvoices.tsx`), Stuck (was Not in JobTread,
`src/app/needs-project/NotInJobTread.tsx`) and Check mail (was Mail Check,
`src/app/vendor-mail/VendorMail.tsx`). Each shows only to its view; only the open
one loads. `/needs-project` and `/vendor-mail` redirect; `/vendor-mail/index`
stays. The Page Text defaults for Inbox and Checks were renamed too — the
Checks rename had not reached the menu because the copy default won.

Then: an "Invoices to log" row on Home (TodayQueue, cached 10 minutes).

Dropped: Statement Import. LSWDD and Amazon are already one tap apart in the
Incoming Bills tab strip; one page with a source picker would only rename them.

Not done in stage 3: one meaning of "handled" (Processed is still a Gmail label
Check mail ignores; the fix is in appscript `VendorMail.js` and needs a deploy);
the email-scan buttons from Actions (stage 6).

### Stage 2 addendum, 2026-10-18

"Check all Jobs" on Tracking Sheets opens Checks for the month (owner: option
B); the second findings list at the foot of Tracking Sheets and
`CheckAllJobs.tsx` are gone. "Check this job" on each job stays.

### Stage 4 status, 2026-10-18 (first slice)

Shipped, without a new route: a job tab row (`src/components/JobTabs.tsx`:
Record · Cost · Budget Import · Specs · Unbilled · This month) on Directory's
job record, Job Cost, Budget Import, Specifications and Unbilled. Each tab keeps
its own route and gate and opens on `?jobId`; Directory, Job Cost and Budget
Import now read it. Jobs board card names open the job's Record (JobTread is
the ↗ beside them). The Clients workspace is titled **Jobs**, its menu holds
Job Board · Leads · Directory · Receivables, and the bar's Jobs slot is the
whole workspace. Job Cost, Budget Import, Specs and Unbilled left the menu;
`JOB_PAGES` keeps them in the header search.

Then: `/leads` is **Customers**, with two sections — Leads (the follow-up
board, `LeadsBoard.tsx`) and All customers (Directory's list, `ClientsBrowser`
embedded). Directory left the menu; `/clients?jobId` stays the job's Record
tab. The Jobs menu is Job Board · Customers · Receivables.

Then: the header search finds jobs by name, number or customer and opens the
job's Record.

Not done in stage 4: an Overview tab (Home's job card, Gantt, cost rings);
search by customer name opens a job, not the customer; RFIs retire (stage 6).

### Stage 5 status, 2026-10-18 (first slice)

Shipped: **Payroll** (`/payroll`, `src/app/payroll/`) with three sections —
Time off (was Time Off (Office), `TimeOffView office embedded`), Sync gaps (was
Time Sync, `TimeSync.tsx`) and Labor import (was Labor Import,
`LaborImport.tsx`). `/time-off/office`, `/time-sync` and `/labor-import`
redirect. `/payroll` rides the `time-sync` view (relabelled Payroll): a new
view id would reach a signed-in person only at their next sign-in, because the
role base is fixed in the session token. The People workspace is gone — Pay
Rates and Safety Meeting joined Employees; Payroll sits under Time.

Not done in stage 5: one pay-period picker driving every section; each
employee's period total linked to their timesheet; the time-entries email and
the miles PDF on Payroll; Pay Rates' per-person editing moved into the
Employees record; Time Sync's 7-day window widened to the period; the Employees
table that fits a phone.

## Look rules (apply as each page merges)

1. A list is one hairline card (`Card pad={false}`, `divide-y divide-line-soft`).
2. A chip marks only the exception.
3. One width per workspace: `max-w-2xl`; full width only for Tracking Sheets and Specs.
4. The first screen shows the list; tools fold or move below.
5. Add `Sheet` (drawer/dialog) and `Tabs` to `ui.tsx`. The merges need both.
6. One name per thing (Invoicing/Tracking Sheets, Jobs/Clients, Sunset, Office
   Dashboard, the four meanings of "Not in JobTread", the three names of one flag).
7. Plain words: no variable names, "Void" for a void, "job" not "project".

## Stages

| # | Stage | Size | Needs first |
|---|---|---|---|
| 0 | Fix first (above) | 1–2 sessions | Decision 1 |
| 1 | Bill drawer + Add Bill sheet on new `Sheet`/`Tabs` parts; `/bill/[id]` as a thin shell | 2–3 | Owner ok: coding writes from the drawer at every width |
| 2 | Invoicing: Checks, Package, Labor Review / Finalize / Historical Cost into the workbench | 3–4 | One dismissal model; one taxable rule |
| 3 | Incoming Bills: Inbox, Statement Import | 2–3 | One meaning of "handled"; one job list (four today) |
| 4 | Job page + Customers; RFIs retire; search finds jobs and customers | 3–4 | Decisions 4, 5 |
| 5 | Employees + Payroll | 3–4 | Decision 3 |
| 6 | Office, Help, Admin, Search; Actions dissolves; RFIs and Course removed | 1–2 | — |

## Owner decisions

1. How does the office reach an off-bar page now that ☰ is gone? Recommended: a
   short "Pages" list in the Account drawer (about 10 rows after the merges).
2. May Bill Corrections, Taxable Flags and Invoice Review become filters of one
   Checks tab, and Invoicing get a 3-tab strip back? Recommended: yes.
3. Is "Payroll" the office's word, and which period? Recommended: the half month
   of the time-entries email.
4. May the app add a job page `/job/[id]`? Recommended: yes.
5. Rename the Clients workspace "Jobs"? Recommended: yes.
6. Retire RFIs and Actions, move Course to Admin? Check Admin › Activity first.
7. Sunset stays its own page (leads hold it). Confirm.

### Owner answers, 2026-10-18

| # | Answer | What it changes |
|---|---|---|
| 1 | Yes | The office Account drawer gets a "Pages" list, one row per workspace. Stage 0. |
| 2 | Yes | Checks tab replaces Bill Corrections, Taxable Flags and Invoice Review as pages. The 3-tab strip was not asked separately; confirm it at the start of stage 2. |
| 3 | Yes | Payroll, on the half month of the time-entries email. |
| 4, 5 | Yes | Add `/job/[id]`. Rename the Clients workspace "Jobs". |
| 6 | Yes, and remove Course | Retire RFIs and Actions. Course is removed, not moved to Admin. |
| 7 | Not asked | Sunset stays its own page, as recommended. |

Still open: the owner's ok for coding writes from the bill drawer at every width
(stage 1).

## Found along the way

Not on any view's gate, so any signed-in role can call them: `/api/bill-review`
GET (the whole correction queue), `/api/sunset-statements` (+ `[id]` PATCH,
`/extract`), `/api/sunset-duplicates`, `/api/logs`, `/api/chat`, `/api/rfis`,
`/api/jobs/browser`, `/api/jobs/cost-detail`. The board's "Check this job" button
does not check `can("invoice-review")`.

## Method and limits

Six readers inventoried every admin and office page and the navigation shell with
file:line evidence; four of the largest claims were re-checked by hand. Access is
the code default; production Role Defaults and Page Text overrides were not
visible. Nothing was tested on a device. Page-change counts assume an iPad in
portrait.
