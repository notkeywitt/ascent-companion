# NAVIGATION_PLAN.md — `ascent-companion`

Read 2026-09-29 against the working tree. Every figure below was measured in the
code, not carried over. Web version, with mockups, the page-change chart and a
"where did my page go?" lookup:
<https://claude.ai/artifact/2RBRreUQTJFzexsFHQyGL1>

`SIMPLICITY_AUDIT.md` covers the code. This plan covers the pages: how they are
grouped, named and reached. Nothing here re-opens a settled stack decision.

---

## The answer

The app is not short of pages. It is short of one organizing rule.

- Group every page into a **workspace** named for a recurring job.
- Each workspace shows a **tab strip** that carries `jobId` and `ym` from tab to tab.
- **Home becomes Today**: a list of what needs this person, with counts.
- **One list** (`src/lib/workspaces.ts`) feeds the phone bar, the iPad rail, the
  desktop sidebar, the header menu, search and the Help sections.
- **Every page keeps its route and its view id.** A workspace is navigation laid
  over existing pages. Saved links, Invoicing Package docs, `page_guides`,
  `usage_events`, Role Defaults and per-user grants keep working.

## Measured today

| | Today | Plan |
|---|---|---|
| Menus that list pages | 11 | 3 (bar, menu, search) |
| Grouping schemes | 4 (AREAS, ViewGroup, PAGE_GROUPS, help sections) | 1 |
| Admin home rows | 45 | 0 (Today is a queue) |
| Page changes, 10 traced tasks | 104 | 63 |
| Monthly close: page changes / month re-picked | 24 / 5 | 14 / 0 |
| Office phone: taps to an off-bar page | 3 | 2 (1 inside a workspace) |
| Routes that move in stages 0–3 | — | 0 |

The eleven menus: admin home cards, tile grid, The Rest (`/more`), inline rest
lists, All Pages, SideNav, TabBar, search Pages, the `/office` page list, Help
"Open" buttons, the home Community row.

## The ten workspaces

Tabs are listed in order. Each tab is an existing route, shown only to people who
hold its view today.

| Workspace | Tabs (was → route) |
|---|---|
| **Today** | Home launcher → `/` (queues, month control, to-dos, job and lead boards) |
| **Month Close** | Tracking Sheets `/trackingsheet` · Labor Review `/labor-review` · Bill Corrections (was Needs Review) `/needs-review` · Taxable Flags `/taxable-lines` · Invoice Review `/invoice-review` · Invoicing Package `/invoicing-summary` · Finalize (was Tracking Sheet) `/tracking-sheet` |
| **Incoming Bills** | Email Invoices `/email` · Mail Check (was Vendor Mail) `/vendor-mail` · Not in JobTread (was Needs Project, merged) `/needs-project` · Sunset `/payments` · LSWDD `/lswdd` · Amazon `/amazon-import` |
| **Clients** | Leads `/leads` · Directory (was Clients & Jobs) `/clients` · Job Cost (was Jobs) `/jobs` · Unbilled `/unbilled` · Budget Import `/budget-import` · Receivables `/ar-aging` · RFIs `/rfis` |
| **People** | Employees `/employees` · Pay Rates (was Labor Rates) `/labor-rates` · Time Off, office console (split) · Time Sync `/time-sync` · Labor Import `/labor-import` · Safety Meeting `/safety-meeting` (full screen, no strip) |
| **Search** | Bill Search `/bill-search` · Vendors `/vendors` · Bill Archive (was Expenditure History) `/expenditure-history` |
| **Office** | Dashboard `/office` · Notices `/notices` · Actions `/actions` |
| **My Work** | Time `/employee-time` · Miles `/mileage-tracker` · Tools `/tools` · Requisitions `/requisitions` · Time Off, self-service `/time-off` |
| **Help** | Help `/help` · Changelog `/changelog` · App Feedback (was Requests) `/requests` · Course `/course` |
| **Admin** | Access `/admin` · Page Text `/admin/copy` · Theme `/theme` · System Logs `/logs` · Financial Journal `/journal` · Historical Cost `/historical-cost` |

Outside the strips: `/bill/[docId]` (unchanged), `/add-bill` (header ＋ on every
page), `/chat` (header "Ask" button), `/lopezrocks` (account menu and Today
footer), `/tool-tracker` (redirect, unchanged), `/login`, `/privacy`.

**Goes away:** admin home cards, office tile grid, `/more`, All Pages, inline rest
lists, the `/office` page list, the Notices tab inside `/admin`, `/coding` and
`/stage` (after Today shows drafts to code), and the dead code listed in stage 0.

### Bars by role (derived from grants; each person can pin a slot)

| Role | Phone bar | Header |
|---|---|---|
| field | Time · Miles · Tools · Requisitions · Time Off | ☰ (Help, LopezRocks, account) |
| lead | Today · Time · Miles · Tools · Requisitions | ☰, search |
| office | Today · Month Close · Incoming Bills · Clients · My Work | ☰, search, ＋ |
| admin | Today · Month Close · Incoming Bills · Office · My Work | ☰, search, ＋ |

From iPad width up, the bar becomes a left rail with every workspace. The desktop
sidebar lists the current workspace's tabs as well.

## Naming rules

1. Name a page for the work done there, in the office's words. Keep a name people
   already use (Tracking Sheets, Invoicing Package, LSWDD) unless it collides.
2. One word for one thing. "Job", not "project". "Sync" only for the JobTread
   mirror. "Push to sheet" for tracking sheets. "Save" for every JobTread write.
3. Never give a retired name to a different page. That is why Requisitions keeps
   its name and Requests becomes App Feedback.
4. A tab label must make sense alone: in search, the browser title, a shared link.
5. One label per page on every surface (bar, title, Help).
6. Title Case for page and tab names; sentence case for descriptions.

Renames are copy-registry label changes. Routes stay. **Read production
`page_copy` first**: an old override hides a rename on some screens, and
`home.area.*` / `home.quick.*` overrides orphan when AREAS and TILE_LAUNCHERS go.

## Stages

| # | Stage | Size | Owner ok needed |
|---|---|---|---|
| 0 | **Fix what is broken.** Gate `/api/time-off/import` (on `time-off-admin`) and `/api/labor-report`. Gate "＋ Add bill" on `recode`, not `coding`. Hide the other lead dead ends rather than widen access. Show the billing-month control on phones. Carry `ym` and `jobId` on links between close pages. Fix the `?tab=drafts` links. Add `npm test` to pre-push (audit 09). Delete DraftQueue, the Roster component, RefreshButton, DigestInstructionsPanel. | 1–2 sessions | Gating the two routes; deleting the digest panel |
| 1 | **One list, one menu.** Add `src/lib/workspaces.ts`. Render a tab strip on each member page; each tab keeps its own default month until the person sets one. Build bar, header menu (every role, every width), iPad rail, search (every tab indexed) and Help sections from it. Remove the other menus; remove `/more` once the menu reaches field and lead. Apply label renames. Keep view ids and copy keys. | 2–3 sessions | Removing the admin home cards and editor (built 2026-09-25); giving leads a bar; deleting `nav_layout` rows |
| 2 | **Today replaces the launcher.** One cached endpoint for every queue count. Rows grouped by type, each gated by its own view. Office-job to-dos and own to-dos in one list, each part under its own gate; digest stays admin-only. Appearance, desktop alerts, LopezRocks, Sign out move to an account menu. Then delete `/coding` and `/stage`. | 3–4 sessions | Deleting `/coding`, `/stage` and their LEAD_VIEWS ids |
| 3 | **Small real merges.** Not in JobTread = no-job + never-pushed + missing-vendor queues. "Code this bill →" on Email Invoices. Split the Time Off office console onto its own path under `time-off-admin`. Labor Report button on People. Remove the `/admin` Notices tab. "History" link from a bill to its journal rows. | 2–3 sessions | The Time Off path added to a view |
| 4 | **Month Close in depth**, after the Board split (audit 01). A bill opens in a side sheet on iPad with `?bill=` in the URL (reuse the host's controller, no third one). A labor lane that carries Labor Review's three extra features. A done/open count per tab. | 4–6 sessions | Coding writes from a phone |

Optional later: rename routes to match labels. It needs permanent `next.config`
redirects (start non-permanent), a clasp push for `_misAppTrackingUrl` /
`_misAppLaborUrl`, and a `page_guides` re-key. Skip it unless the URLs confuse
someone.

### Rules the checks set for every stage

- Never rename or merge a **view id**. Role Defaults, per-user grants, SideNav pins
  and `home.dest.<view>` copy keys all hang off it.
- A tab that needs its own gate must be its own **path**, added to that view's
  `paths` in `views.ts`. Middleware ignores the query string.
- Gate each **section**, not only the tab, when a page calls another view's API
  (the `TrackingSheetSync.tsx` pattern).
- Today rows read **stored or cached** results. `vendor-mail`'s live sweep runs up
  to 120 s.
- Keep the Chrome side panel's `/?jobId=` contract on Today.

## Owner decisions before stage 1

1. Keep "Tracking Sheets" as the workbench name inside a workspace called Month Close?
2. Do office staff log their own miles? If yes, Miles replaces Clients on the office bar.
3. May the admin home cards and their drag editor go?
4. Does anyone log RFIs?
5. Does anyone still record hours in QuickBooks Time that must reach JobTread? (Labor Import)
6. Who runs the safety meeting: a lead or the office?
7. Should a lead see a Sunset bill's detail, or get a JobTread link?
8. May field staff and leads send App Feedback? Help already tells them to.
9. Confirm the close order: Tracking Sheets, Labor Review, Bill Corrections, Taxable Flags, Invoice Review, Invoicing Package, Finalize.
10. Check Admin › Activity (30 days) before archiving Course, Changelog, RFIs, Labor Import, Expenditure History or Job Cost.

### Owner answers, 2026-09-29

| # | Answer | What it changes |
|---|---|---|
| 1 | Yes | The workbench stays "Tracking Sheets", inside Month Close. |
| 2 | Yes | Miles replaces Clients on the office bar. |
| 3 | Yes | The admin home cards and their editor go in stage 1. |
| 4 | No | RFIs leave every menu. The route and the view stay. |
| 5 | Yes | Labor Import stays, under People. |
| 6 | Office | Safety Meeting stays an office view, under People. |
| 7 | Yes | A lead gets a read-only Sunset bill detail. Needs its own change: the bill page is the coding editor. |
| 8 | Yes | App Feedback (`requests`) is in FIELD_VIEWS. Changing a request's status stays office/admin. |
| 9 | Yes | Month Close tabs in that order. |
| 10 | Not sure | Nothing else is archived until Admin › Activity is checked. |

Also approved: leads get a bar; `nav_layout` rows are archived, not deleted
(the code stops reading them; the rows stay, so a revert brings them back); the
admin home cards go.

### Stage 1 status, 2026-09-29

Shipped: `src/lib/workspaces.ts` (one list; `workspaces.test.ts` fails on a page
on no workspace); the header ☰ menu for every role and width; the bar from
`BARS` per role, leads included; search over every tab; the tab strip carrying
`jobId` and `ym` (close pages write `?ym` when a month is picked); the renames.
Removed: admin home cards and editor, tile launchers, `/more` (redirects home),
All Pages, the desktop side drawer, the `/office` page list, RFIs from the menus.
`nav_layout` rows are kept and no longer read.

Not yet done: the iPad left rail and desktop sidebar (the dock stays); Help
sections grouped by workspace; a per-person pinned bar slot (the side drawer's
per-device pins went with it); queue counts on menu rows (the launcher's
Time Sync badge went with it — Today in stage 2 brings counts back).

## Found along the way

- `POST /api/time-off/import` commits a leave-balance import for any signed-in
  user (`src/app/api/time-off/import/route.ts:25-47`; no `views.ts` path).
- `POST /api/labor-report` writes the payroll Drive sheet after a sign-in check
  only (`src/app/api/labor-report/route.ts:50-51`).
- Reported by the checks, confirm before fixing: `/api/chat`, `/api/logs`,
  `/api/unbilled`, `/api/rfis`, `/api/jobs/cost-detail` and the full
  `/api/bill-review` GET queue sit behind page-only gates. Security review item
  M-1 (refuse unlisted API routes) closes them together.
- `USER_MANUAL.md` still describes Coding Review, the Invoicing tab and a
  "More ▾" menu. Help's find-a-page topic promises leads a Home tab they lack.
  Budget Import is described as read-only; it writes the live budget.

## Method and limits

Nine agents inventoried every page, menu and ten end-to-end tasks with file:line
evidence; five more checked the draft for lost features, engineering risk,
page-change counts and outside products (JobTread, Procore, Buildertrend,
QuickBooks Online, Ramp, Linear, Connecteam, Apple HIG, Material 3). Counts assume
an iPad in portrait and code-default access. Production usage, Role Defaults,
Page Text overrides and saved home layouts were not visible.
