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
| **Nav / launcher / tabs** | `src/app/page.tsx` (`AREAS` launcher), `src/components/TabBar.tsx` |
| **The Pave gateway** (generic JobTread access + write policy) | `src/app/api/pave/route.ts` + `src/lib/paveGateway.ts` (policy) + `src/lib/paveGatewayClient.ts` (browser) |
| **Verified JobTread reads/writes** (not the generic gateway) | `src/lib/jobtread.ts` |
| **Billing period / bill-date rules** | `src/lib/billing.ts` (keep in lockstep with appscript `Config.js`) |
| **Bill line money math** (edit/save a bill's lines) | `src/lib/billLineMath.ts` |
| **Coding / Client Invoicing workflow** | `src/app/recode/*` (Board, BillCodingCard, TimeCodingCard, ClientInvoicing, DraftQueue, DraftWorkbench,
  AllJobs, Roster) + `src/app/api/recode/*`, `src/app/api/code` |
| **Editing ONE time entry** (code / hours / day / job) | `src/app/recode/TimeCodingCard.tsx` + `src/app/api/time-entry`; batch recodes stay in `labor-review` |
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
| `auth.ts` ⟂ | Shared-password auth helpers (Web Crypto only; works in edge + node). |
| `billing.ts` ⟂ | Billing-period + bill-date standard, ported from appscript `Config.js`. Keep in lockstep. |
| `billLineMath.ts` ⟂ | Money math for editing a vendor bill's lines (JobTread's tax carve, confirmed live). |
| `billTouch.ts` | One-bit "a bill was written through the app" signal, shared across pages so list caches know when to refresh. |
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

Tests live beside their module (`*.test.ts`): `billing`, `billLineMath`,
`jobtread`, `paveGateway`, `leadInquiry`, `taskRunner`, `appsScript`.

## `src/app/` — pages (grouped by the view group in `views.ts`)

Each page is a server component (`page.tsx`) that hands non-secret context to a
`"use client"` component. Group/roles for each is set by its `VIEWS` entry.

- **Financials:** `recode` (Client Invoicing — the billing hub: Board,
  BillCodingCard, TimeCodingCard, ClientInvoicing, DraftQueue, DraftWorkbench,
  AllJobs, Roster), `bill/[docId]`, `add-bill`,
  `coding` (retired), `stage` (retired), `labor-review`, `jobs`, `unbilled`,
  `vendors`, `email`, `needs-project`, `payments` (Sunset Statements),
  `expenditure-history`, `lswdd`, `amazon-import`, `tracking-sheet`.
- **Field:** `safety-meeting`, `mileage-tracker`, `employee-time`, `tools`,
  `tool-tracker`, `rfis`, `time-off`, `requisitions`.
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
  `jt-users`, `jobs/*`, `job-budget`, `unbilled`, `historical-cost`.
- **Bills / coding:** `bill/*`, `add-bill`, `add-line`, `delete-line`,
  `combine-lines`, `code`, `coding-queue`, `recode/*`, `bill-status`,
  `bill-fields`, `bill-issuedate`, `bill-number` (the vendor's own invoice
  number — JobTread's `externalId`), `bill-tax`, `bill-reviewed`, `uncaptured`,
  `vendor-bills/*`, `vendor-bill-count`, `stuck-vendors`, `needs-project`,
  `reassign-job`.
- **Invoicing surfaces:** `stage/*`, `lswdd`, `amazon-import/*`,
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
  `usage-track`.

> Gateway rule of thumb: reads are open to any signed-in role; writes are
> triple-gated (see `CLAUDE.md` → "The Pave gateway"). New pages are read-first.

## `src/components/` — UI

- **Design system:** `ui.tsx` — build EVERY UI on these primitives (see the list
  in `CLAUDE.md`). Never hand-roll styles.
- **Chrome / nav:** `AppHeader`, `TabBar`, `PageTitle`, `ThemeToggle`,
  `AscentLogo`, `RefreshButton`/`RefreshProvider`, `SyncNowButton`,
  `AdminActionBar`, `AccessProvider`, `CopyProvider` (editable page text —
  `useCopy()`), `UsageBeacon`.
- **JobTread pickers / links:** `JobPicker`, `GlobalJobBar`, `CostCodeSelect`,
  `JtLink`, `LinkPending`, `BillStatusBadge`, `BillingSummary`.
- **Feature widgets:** `InvoiceReconcile`, `InvoiceSweepResult`,
  `UncapturedBills`, `StuckVendors`, `NeedsProject`, `Notices` (the global
  per-user popup feed), `SunsetDuplicateScan`, `TrackingSheetSync`,
  `TrackingSheetRisks`, `Donut`, `SignaturePad`, `QrScanner`, `CopyButton`,
  `Spinner`.

## `src/db/` — companion DB (Drizzle + libSQL; companion-only data, NOT JobTread)

`schema.ts` tables: `allowed_users`, `role_access`, `usage_events`,
`saved_bills`, `feature_requests`, `flagged_time_entries`,
`labor_rate_catalog`, `labor_rate_groups`, `leads`, `lead_activities`,
`lead_inquiries`, `lead_inquiry_dismissals`, `leave_policies`, `leave_balances`,
`leave_requests`, `leave_transactions`, `jt_user_links`, `notices`,
`notice_reads`, `rfis`, `sunset_statements`, `page_copy`. Access via
`src/db/index.ts`.

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
