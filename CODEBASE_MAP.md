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
> (Gmail→Gemini ingestion, the hourly JobTread↔Sheet↔Drive mirror) and the
> Sheets/Drive data layer the companion reaches over a shared secret.

## Which doc answers what

| You need… | Read |
|---|---|
| Working rules, the mobile build loop, write-safety gates | `CLAUDE.md` |
| The Pave/JobTread schema + query grammar + gotchas | `JT_API_REFERENCE.md` |
| Why the gateway exists, where new views belong | `FRONTEND_ARCHITECTURE.md` |
| Standing structural review, agreed cleanup checklist | `ARCHITECTURE_REVIEW.md` |
| What each screen does, for the owner (end-user manual) | `USER_MANUAL.md` |
| How to deploy / env vars / Vercel | `DEPLOY.md` |
| **Where a given file/feature lives (this doc)** | `CODEBASE_MAP.md` |
| A guided course through the whole system, for the owner | `docs/course/README.md` |
| Session-to-session handoff notes | `HANDOFF.md` — **do NOT read unless asked** |

## Task → where to look

| To work on… | Start in |
|---|---|
| A **new read-only page** over JobTread | copy `src/app/jobs/` (`page.tsx` → `JobsBrowser.tsx`), compose query per `JT_API_REFERENCE.md`, call `gatewayQuery` (`src/lib/paveGatewayClient.ts`) |
| **Gating / who sees what** | `src/lib/views.ts` (the single source of truth: `VIEWS`, `ROLE_VIEWS`), enforced by `src/middleware.ts` |
| **Nav / launcher / tabs** | `src/lib/nav.ts` (`AREAS` — the destination list), `src/app/page.tsx` (renders it), `src/components/TabBar.tsx` |
| **The global search box** | `src/components/GlobalSearch.tsx` (in `AppHeader`, under the job picker) — matches pages via `src/lib/nav.ts`, vendors via `/api/vendors`, bills/line items via `/api/bill-search` |
| **The Pave gateway** (generic JobTread access + write policy) | `src/app/api/pave/route.ts` + `src/lib/paveGateway.ts` (policy) + `src/lib/paveGatewayClient.ts` (browser) |
| **Verified JobTread reads/writes** (not the generic gateway) | `src/lib/jobtread.ts` |
| **Billing period / bill-date rules** | `src/lib/billing.ts` (keep in lockstep with appscript `Config.js`) |
| **Bill line money math** (edit/save a bill's lines) | `src/lib/billLineMath.ts` |
| **Coding / Tracking Sheets workflow** | `src/app/trackingsheet/*` (Board, BillCodingCard, TimeCodingCard, ClientInvoicing, DraftQueue, DraftWorkbench,
  AllJobs, Roster) + `src/app/api/trackingsheet/*`, `src/app/api/code` |
| **Editing ONE time entry** (code / hours / day / job) | `src/app/trackingsheet/TimeCodingCard.tsx` + `src/app/api/time-entry`; batch recodes stay in `labor-review` |
| **Org-timezone wall clocks in the browser** | `src/lib/orgTime.ts` (read half; the server's is in `src/lib/jobtread.ts`) |
| **A single bill page** | `src/app/bill/[docId]/page.tsx` + `src/app/api/bill/*` |
| **PTO / sick accrual** | pure math `src/lib/leave.ts`; server orchestration `src/lib/leaveService.ts`; UI `src/app/time-off/` + `src/app/api/time-off/*` |
| **Employee time / clock** | `src/app/employee-time/` + `src/app/api/employee-time/*`; back end is appscript `EmployeeTime.js` |
| **Leads / lead board** | read `src/lib/leads.ts`; the one write `src/lib/leadPush.ts`; UI `src/app/leads/` + `src/app/api/leads/*` |
| **The chat assistant** | engine `src/lib/anthropic.ts`, tools `src/lib/chatTools.ts`, UI `src/app/chat/` + `src/app/api/chat` |
| **Anything Sheets/Drive-backed** (employees, tools, mileage, safety, requisitions, Sunset, tracking sheets, audit log) | `src/lib/appsScript.ts` (the one client over the shared secret) → the matching appscript `.js` file |
| **Invoice/Amazon extraction (Gemini)** | `src/lib/gemini.ts`, `src/lib/amazonImport.ts` |
| **Auth / session / roles** | `src/auth.ts`, `src/middleware.ts`, `src/lib/auth.ts` |
| **Env, gates, Pave config** | `src/lib/config.ts` |
| **Companion DB tables** | `src/db/schema.ts` |
| **The design system** | `src/components/ui.tsx` (build every UI on these primitives) |
| **Editable on-screen text** (office reword, no deploy) | add a key to `src/lib/copy.ts`, render it via `useCopy()`; edited at `/admin/copy` → `src/app/api/admin/copy/route.ts` |
| **The Admin Daily Digest** (morning report on Home) | `src/lib/digest/` — `settings.ts` (EVERY threshold/exclusion), `registry.ts` (the check list), `checks/*` (one file per check), `run.ts` (aggregator); UI `src/components/DailyDigest.tsx`; routes `src/app/api/digest/*`; Google data via appscript `DailyDigest.js` |
| **Reviewing a month's client invoices** | `src/lib/invoiceReview/` — `checks.ts` (every judgement, pure + tested), `evidence.ts` (JobTread + Drive + Gmail), `rulings.ts` (the memory), `brief.ts` (the no-API-key hand-off); page `src/app/invoice-review/`; route `src/app/api/invoice-review`; Drive + Gmail reads via appscript `ClientInvoiceReview.js`; skill `.claude/skills/invoice-review/` |
| **Adding a digest check** | write `src/lib/digest/checks/<id>.ts`, add its config block to `src/lib/digest/settings.ts`, add one line to `src/lib/digest/registry.ts` — the aggregator, the cron route and the UI are untouched |

## `src/lib/` — shared logic (the most-reused code)

Pure modules (no DB/Node/React) are marked ⟂ — safe to import anywhere,
including edge middleware.

| File | Purpose |
|---|---|
| `jobtread.ts` | The typed Pave client + the verified read/write calls behind the app. Every call was confirmed live; TODO fields are unverified (probe-first). |
| `jobsCache.ts` | The org's open jobs in Next's Data Cache (5-min TTL), shared by `/api/jobs` AND any server component that wants to preload the list into its HTML (e.g. `/employee-time`). |
| `jtUserLink.ts` | **email → JobTread identity, cached in the DB** (`jt_user_links`). The roster answer costs a ~3 s Apps Script round trip, so read it here: `readJtUserLink` (DB only, safe on a render path) / `resolveJtUserLink` (falls back to Apps Script and writes back). |
| `employeeClock.ts` | The running clock (`readOpenClock`) and the last job/cost/pay a person used (`readLastUsed`), shared by `/employee-time`'s server shell and its clock route. |
| `paveGateway.ts` ⟂ | Policy + query inspection for the generic `/api/pave` gateway (read/write classification, per-role write allowlist). |
| `paveGatewayClient.ts` | Browser-safe `gatewayQuery(query)` — POSTs to `/api/pave`; no grant key. |
| `config.ts` | Server-side Pave config from env (`getPaveConfig`) + write gates. Never import into client code. |
| `copy.ts` ⟂ | **Registry of editable on-screen text** — every string the office can reword from Admin → Page Text. English lives here as the shipped default; the DB only overrides. |
| `copyService.ts` | Server half of the above: reads `page_copy` overrides. Returns `{}` on any DB failure so copy can never blank a page. |
| `views.ts` ⟂ | **Single source of truth for role-gated views** — `VIEWS`, `ROLE_VIEWS`, `resolveAllowedViews`, `viewIdForPath`. |
| `nav.ts` ⟂ | **The launcher's destination list** (`AREAS`) — the one place every gateable view is named. Read by BOTH the home launcher and the header's global search, which is why it's a module rather than living in `page.tsx`. |
| `preview.ts` ⟂ | **Role preview** — the cookie name + helpers letting an admin view the app AS each role. The layout reads the cookie (honoring it only for a real admin) and hands that role's live view set to the nav, so the launcher/tabs render as that role sees them. Narrows only, never elevates. |
| `previewClient.ts` | Browser half of the above: `startPreview`/`stopPreview` set/clear the cookie and reload so the server layout re-reads it. |
| `auth.ts` ⟂ | Shared-password auth helpers (Web Crypto only; works in edge + node). |
| `billing.ts` ⟂ | Billing-period + bill-date standard, ported from appscript `Config.js`. Keep in lockstep. |
| `billLineMath.ts` ⟂ | Money math for editing a vendor bill's lines (JobTread's tax carve, confirmed live). |
| `billTouch.ts` | One-bit "a bill was written through the app" signal, shared across pages so list caches know when to refresh. |
| `billSearch.ts` | The bill-search index engine: sweeps live JobTread vendorBills + lines, seeds pre-JobTread history from the sheets, and answers `/bill-search` queries from a local FTS5 index in under a second. Companion-owned cache, not a source of truth. |
| `leave.ts` ⟂ | PTO/sick accrual math (bi-monthly pay periods). |
| `leaveService.ts` | Accrual server orchestration: roster + JobTread worked-hours + companion DB. |
| `leaveFormat.ts` | Leave display formatting helpers. |
| `leads.ts` | Reads the org's "New Lead" customers out of JobTread (there is no lead object in Pave). |
| `leadPush.ts` | The ONE write in the leads feature — pushes a logged lead into JobTread as a customer. |
| `leadInquiry.ts` | Web-inquiry lead parsing/normalization. |
| `timeSync.ts` | Worked-time reconciliation/retry — surfaces records saved to the sheet but not yet in JobTread. |
| `appsScript.ts` | The one client for the Apps Script web app — every Sheets/Drive feature POSTs `{action, secret, …}` here. |
| `anthropic.ts` | Claude chat engine — the server-side tool-use loop behind `/chat` (server-only). |
| `gemini.ts` | Gemini invoice extraction — port of appscript `Ingestion.js` (server-only). |
| `chatTools.ts` | Read-only JobTread tool registry exposed to the chat assistant. Phase 1 is READ-ONLY — do not add writes. |
| `amazonImport.ts` | Amazon Business monthly CSV → JobTread vendor bills. |
| `taskRunner.ts` | Tiny background scheduler (keyed serialization + parallelism cap) used by the Tracking Sheet page. |
| `usage.ts` | Activity tracking (login/view/coding) — the data layer behind Admin → Activity. |
| `useUnsavedChanges.ts` | React hook guarding navigation away from unsaved edits. |
| `sentry.shared.ts` | Shared Sentry init. |

### `src/lib/invoiceReview/` — the monthly client-invoice review

Cross-checks a billing month's CLIENT invoices (JobTread `customerInvoice`
documents) against the vendor bills behind them, the backup PDFs filed in the
Drive invoicing tree, and the office mailbox. READ-ONLY against JobTread, Drive,
Gmail and the Sheet; the only thing it writes anywhere is a standing "ruling" in
the companion DB.

| File | Purpose |
|---|---|
| `types.ts` ⟂ | The evidence and finding shapes, the `FindingKind` list, and the `findingKey` identity a ruling suppresses by. Pure — imported by the checks, the route and the page alike. |
| `checks.ts` ⟂ | **Every judgement lives here**, as pure functions over the evidence: CAPTURE (a vendor invoice arrived in the 10th-to-10th window and JobTread has no matching bill — the one failure no other check can see), COVERAGE (everything captured reached a client invoice, per bill), backup coverage (amount-matched one-to-one against the filename convention), the invoice math (line, total, tax, balance), and billing period + scope. Never fetches, never writes, never "corrects" a number. Skips Office and Shop, which are Ascent's own overhead and are never billed to anyone (`isNeverInvoiced` in types.ts). |
| `evidence.ts` | All the fetching: the job roster, each job's month bills and live invoices (413-safe two-phase reads), the Drive backup listing, and one mailbox sweep for the period — the last two via the Apps Script bridge. It also does the mail→JobTread JOIN, reusing the Daily Digest's `matchVendor`/`billMatchesEmail` so there is one answer in the codebase to "is this the same invoice". Per-job failures become warnings, never a dead review. Sets `emailChecked`, so a mailbox that couldn't be searched never looks like one that came back clean. |
| `brief.ts` ⟂ | The review as a self-contained markdown briefing, for the **no-API-key path**: the page's "Copy for Claude" button and `GET /api/invoice-review?format=brief`. Opens by telling Claude the arithmetic is already done and must not be redone. |
| `rulings.ts` | The memory — what the office has already overruled, so a structurally-true finding stops coming back every month. Two scopes: this finding, or this kind on this job. The ONLY write in the feature. |
| `narrate.ts` | One Claude paragraph over the STRUCTURED findings (never the raw evidence, so it cannot invent a figure). Silent fallback to the locally-built summary. |
| `run.ts` | The order of operations: evidence → checks → rulings → narrative. Thin by design. |

Tests: `checks.test.ts` (the backup matcher against the real filename
convention, every math tolerance, the period/scope rules, the mailbox
calibration, the briefing, finding order).
Skill: `.claude/skills/invoice-review/SKILL.md` drives the same review from a
Claude Code session. Drive half: `ascent-appscript/ClientInvoiceReview.js`.

### `src/lib/digest/` — the Admin Daily Digest

The morning report on the home launcher: independent "checks" over billing,
calendar and inbox, run once a day by a Vercel cron, summarized by ONE Gemini
call, stored in `daily_digest`, and read (never recomputed) on page load. Every
check is READ-ONLY against Gmail, Calendar, the Sheet and JobTread.

| File | Purpose |
|---|---|
| `settings.ts` ⟂ | **THE one place every knob lives** — categories, the billing cutoff day, vendor/job exclusion lists, thresholds, which calendars to read, and each check's `enabled` flag. Edit here, never inside a check. |
| `types.ts` ⟂ | The check contract (`DigestCheck`, `CheckContext`, `CheckResult`, `DigestItem`) plus the stored payload shape. Why the feature is extensible: a check knows nothing about scheduling, storage, or rendering. |
| `registry.ts` | The one list of checks, each bound to its settings block. Adding a check = one import + one line here. |
| `run.ts` | The aggregator: runs each enabled check in isolation (per-check timeout; a failure becomes one `status:"error"` entry, never a broken digest), makes the single Gemini summary call, stores the result. Knows nothing about any individual check. |
| `grouping.ts` ⟂ | Stored results → the categories the screen draws, worst status rolled up. Pure, so "categories are data, not tabs" is testable. |
| `store.ts` | Read/write the `daily_digest` row — the ONLY thing this feature writes anywhere. |
| `checks/uncapturedBills.ts` | Invoice-looking mail with no matching JobTread bill (sender → vendor account → date/amount window). |
| `checks/draftBillsPastCutoff.ts` | Draft vendor bills left over from a billing month that already closed. |
| `checks/reconciliationFlags.ts` | The Expenditure sheet's own `Reconciliation Flags` column, grouped by flag type. Reads the sheet's verdict; never re-derives it. |
| `checks/costVsInvoice.ts` | Jobs whose approved spend has outrun approved client invoices, past a configurable gap. |
| `checks/calendarEvents.ts` | Today's / this week's shared-calendar events (read-only scope; never a personal calendar by default). |
| `checks/emailFollowUps.ts` | Inbox threads whose last message came from outside and went unanswered past a business-day threshold. |

Tests: `digest.test.ts` (registry wiring, category grouping, the billing-cutoff
rule, vendor/amount matching, the exclusion lists).

Tests live beside their module (`*.test.ts`): `billing`, `billLineMath`,
`jobtread`, `paveGateway`, `leadInquiry`, `taskRunner`, `appsScript`.

## `src/app/` — pages (grouped by the view group in `views.ts`)

Each page is a server component (`page.tsx`) that hands non-secret context to a
`"use client"` component. Group/roles for each is set by its `VIEWS` entry.

- **Financials:** `trackingsheet` (Tracking Sheets — the billing hub, gated by
  the `recode` view id: Board, BillCodingCard, TimeCodingCard, ClientInvoicing,
  DraftQueue, DraftWorkbench, AllJobs, Roster), `bill/[docId]`, `add-bill`,
  `coding` (retired), `stage` (retired), `labor-review`, `invoice-review`
  (a month's client invoices checked against the bills and the Drive backup),
  `jobs`, `unbilled`,
  `vendors`, `bill-search` (fast full-text search over every bill + line item,
  live JobTread plus seeded pre-JobTread history), `email`, `needs-review` (the
  queue of bills flagged "Needs review" — corrections the app can't make itself),
  `needs-project`,
  `payments` (Sunset Statements), `expenditure-history`, `lswdd`, `amazon-import`,
  `tracking-sheet`.
- **Field:** `safety-meeting`, `mileage-tracker`, `employee-time`, `tools`,
  `tool-tracker`, `rfis`, `time-off`, `requisitions`, `more` ("The Rest" — the
  last button on the field/lead launcher: the curated menu of everything else
  that role can open; the lists are `TILE_LAUNCHERS` in `src/lib/nav.ts`).
- **Assistant:** `chat`.
- **Office:** `employees`, `leads`, `labor-import`, `labor-rates`,
  `time-sync`.
- **System / admin:** `admin`, `logs`, `historical-cost`, `requests`,
  `actions`, `course` (the in-app "Reading Your Own App" walkthrough —
  `course/page.tsx` + `course/[seg]` reader; metadata `src/lib/course.ts`,
  bodies `course/segments.tsx`, progress `src/lib/useCourseProgress.ts`), plus
  `login`, `privacy` (ungated).
- **Root:** `page.tsx` (home launcher — the primary nav), `layout.tsx`,
  `manifest.ts`, `global-error.tsx`.

## `src/app/api/` — server routes (the only place the grant key is used)

Grouped by domain; each folder is `…/route.ts`.

- **JobTread access:** `pave` (the guarded generic gateway), `jt-sync`,
  `jt-users`, `jobs/*`, `job-budget`, `unbilled`, `historical-cost`,
  `bill-search` (query the local bill/line index; `bill-search/refresh` sweeps
  JobTread into it, `bill-search/seed` imports the pre-JobTread sheet history).
- **Bills / coding:** `bill/*`, `add-bill`, `add-line`, `delete-line`,
  `combine-lines`, `code`, `coding-queue`, `trackingsheet/*`, `bill-status`,
  `bill-fields`, `bill-issuedate`, `bill-number` (the vendor's own invoice
  number — JobTread's `externalId`), `bill-tax`, `bill-reviewed`, `uncaptured`,
  `vendor-bills/*`, `vendor-bill-count`, `stuck-vendors`, `needs-project`,
  `reassign-job`.
- **Invoicing surfaces:** `stage/*`, `invoice-review` (GET runs a month's
  client-invoice review, or `?format=brief` for the paste-into-Claude version;
  POST records or lifts one standing ruling), `lswdd`,
  `amazon-import/*`,
  `sunset-statements/*`, `sunset-duplicates`, `buyback`.
- **Labor / time:** `employee-time/*`, `labor-rates/*`, `labor-review/*`,
  `time-entry` (one entry, edited in place — gated under `recode`),
  `time-off/*`, `time-sync/*`, `expenditure-history`.
- **HR / field ops:** `employees/*`, `team/*`, `mileage/*`, `tools`,
  `tool-tracker`, `safety-meeting`, `requisitions`, `rfis/*`,
  `feature-requests/*`.
- **Leads:** `leads/*`.
- **Assistant / misc:** `chat`, `ocr-serial`, `tracking-sheet`, `vendors`,
  `bank-details`, `notices/*` (the per-user popup feed + dismiss).
- **Platform:** `auth/[...nextauth]`, `login`, `logs`, `actions`, `usage`,
  `usage-track`, `digest` (GET the stored digest — gated by the admin-only
  `digest` view; `digest/run` builds one and is the ONE route listed as PUBLIC
  in middleware, because the daily cron carries no session — it checks a bearer
  secret or an admin session itself).

> Gateway rule of thumb: reads are open to any signed-in role; writes are
> triple-gated (see `CLAUDE.md` → "The Pave gateway"). New pages are read-first.

## `src/components/` — UI

- **Design system:** `ui.tsx` — build EVERY UI on these primitives (see the list
  in `CLAUDE.md`). Never hand-roll styles.
- **Chrome / nav:** `AppHeader`, `GlobalSearch` (the app's ONE search box, in the
  header under the job picker — pages + vendors + bills + line items, from any
  page — hidden for the FIELD role), `TabBar`, `TileLauncher` (the field/lead
  home launcher — large buttons in place of the office area lists: field gets
  4, lead 6; curated in `src/lib/nav.ts` → `TILE_LAUNCHERS`),
  `PageTitle`, `ThemeToggle`,
  `AscentLogo`, `RefreshButton`/`RefreshProvider`, `SyncNowButton`,
  `AdminActionBar`, `AccessProvider`, `CopyProvider` (editable page text —
  `useCopy()`), `UsageBeacon`, `PreviewBanner` (the admin's "viewing as {role}"
  bar + its "Return to my view" link — see `src/lib/preview.ts`).
- **JobTread pickers / links:** `JobPicker`, `GlobalJobBar`, `CostCodeSelect`,
  `JtLink`, `LinkPending`, `BillStatusBadge`, `BillingSummary`.
- **Feature widgets:** `InvoiceReconcile`, `InvoiceSweepResult`,
  `UncapturedBills`, `StuckVendors`, `NeedsProject`, `Notices` (the global
  per-user popup feed), `SunsetDuplicateScan`, `TrackingSheetSync`,
  `TrackingSheetRisks`, `Donut`, `SignaturePad`, `QrScanner`, `CopyButton`,
  `Spinner`, `DailyDigest` (the admin morning digest card on Home — renders
  whatever categories and checks the stored digest carries; no hardcoded tabs).

## `src/db/` — companion DB (Drizzle + libSQL; companion-only data, NOT JobTread)

`schema.ts` tables: `allowed_users`, `role_access`, `usage_events`,
`saved_bills`, `feature_requests`, `flagged_time_entries`,
`labor_rate_catalog`, `labor_rate_groups`, `leads`, `lead_activities`,
`lead_inquiries`, `lead_inquiry_dismissals`, `leave_policies`, `leave_balances`,
`leave_requests`, `leave_transactions`, `jt_user_links`, `notices`,
`notice_reads`, `rfis`, `sunset_statements`, `page_copy`, `bill_index`,
`bill_line_index`, `bill_index_meta`, `daily_digest`, `invoice_review_rulings`
(the invoice review's standing rulings). Access via `src/db/index.ts`.

(`bill_index`/`bill_line_index`/`bill_index_meta` back the `/bill-search` index —
the searchable snapshot of every bill + line item, plus its refresh/seed
bookkeeping; the FTS5 `bill_fts` virtual table over them lives only in
`db/index.ts`'s DDL, as Drizzle can't model it.)

(`notices`/`notice_reads` back the global popup feed — a notice is dismissed
per-user and stays gone; `lead_inquiry_dismissals` hides a web-form inquiry from
the leads board without deleting it.)

## The cross-repo boundary

The companion never touches Sheets/Drive directly. Anything Sheets/Drive-backed
goes: **companion page → `src/lib/appsScript.ts` → `/api/…` route → Apps Script
web app (`doPost` action router) → the matching `.js` file in
`ascent-appscript`.** See that repo's `CODEBASE_MAP.md` for the back-end side.
JobTread is the source of truth; the appscript hourly loop mirrors it to the
Sheet + Drive. Don't add companion write paths that race that mirror.

(`daily_digest` holds one row per day: each check's STRUCTURED result, the single
Gemini summary paragraph over them, and the run log. Rewritten in place by
"Refresh now", so a date has exactly one digest — see `src/lib/digest/store.ts`.)
