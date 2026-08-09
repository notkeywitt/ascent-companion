# Architecture Review — `ascent-companion` + `ascent-appscript`

*Reviewed 2026-08-08. Covers both repos.*

A structural review of the two repos: efficiency, size, complexity, failure points,
and whether a different language or platform would serve better.

**Short answer: the stack is right, the structure needs work.** No language,
framework, or platform change is warranted. But ~10% of the combined codebase exists
only to shuttle data through a Google Sheet that has no reason to hold it, the
highest-churn file in either repo is a 2,700-line function, and until this review
there was no automated test, lint, or CI gate anywhere across ~70k lines that move
money.

This document is the record so a future session can pick up mid-sequence instead of
re-deriving the analysis. **The progress checklist is at the bottom — update it as
stages land.**

---

## Baseline (measured, 2026-08-08)

| | `ascent-companion` | `ascent-appscript` |
|---|---|---|
| Lines | 39,112 TS/TSX | 30,405 JS |
| Files | 172 | 19 `.js` |
| Largest module | `src/lib/jobtread.ts` — 3,816 | `Diagnostics.js` — 9,441 (166 fns) |
| Largest component | `app/recode/Board.tsx` — 3,035 | `JobTread.js` — 4,597 |
| Commits | 60 | 52 |
| Tests | 0 | 0 |
| CI | 0 | 0 |
| Lint | 0 (despite `next lint` wired) | 0 |
| Error monitoring | none | Stackdriver (exceptions only) |

---

## Verdict on language & platform

**Don't switch anything.** Recorded with reasons so this isn't re-litigated:

- **Next.js + TypeScript + Vercel** is correct. Branch → preview URL is exactly the
  mobile build loop in `CLAUDE.md`; App Router server routes are a clean place to hold
  the grant key. Nothing in the workload argues for Remix, SvelteKit, Go, or a separate
  API server.
- **Apps Script earns its place.** Gmail scanning, the Gmail add-on (contextual
  triggers are Apps Script-only), Drive filing, Docs→PDF, and Sheets writes — all with
  Google auth for free. Replacing it means service accounts and domain-wide delegation
  for no functional gain, against ~30k lines of working, hard-won ingestion code.
- **libSQL/Turso** is fine for the companion's small non-financial tables. Postgres was
  already considered and rejected (`ascent-appscript` commit `c0de4ee`); nothing has
  changed to reopen it.
- **JobTread-as-source-of-truth** is the right call and is consistently enforced.

The problem was never *which* platforms. It's *which work sits on which platform*.

---

## Findings

### 1. ~7,100 lines exist only to push companion data through a Google Sheet

Six Apps Script modules read/write companion-owned data in a Sheet, and 26 Next.js
routes exist only to proxy to them:

| Apps Script module | LOC | Companion side |
|---|---|---|
| `EmployeeTime.js` | 1,037 | `api/employee-time/*` |
| `Mileage.js` | 677 | `api/mileage/*` |
| `Tools.js` | 667 | `api/tools`, `api/tool-tracker` |
| `Employees.js` | 525 | `api/employees/*` |
| `Requisitions.js` | 460 | `api/requisitions` |
| `SafetyMeeting.js` | 308 | `api/safety-meeting` |
| **3,674** | | **+ 3,489 across the 26 proxy routes** |

Verified by cross-file symbol search: **these six reference only each other**, never
the ingestion or mirror core. They are cleanly separable.

Failure modes the bridge creates, all of which disappear with it:
- **The single versioned `/exec` deployment silently serves stale code.** `deploy.sh`
  exists *only* because this bit them — its own header: *"pushing appears to work while
  the Companion keeps running months-old code — the failure is completely silent."*
- Apps Script's 6-minute execution cap and daily quotas.
- One shared secret for the whole surface, no per-action scope.
- An extra network hop with no retry and no timeout (finding 3).
- Apps Script answers via a 302 to a one-time content URL and **always reports HTTP
  200**, so transport status is meaningless — every caller must dig `ok` out of the
  body, and 17 of them re-implement that.

**Constraint for any migration:** the owner reads these Sheet tabs directly (reads, does
not edit). So each dataset needs a one-way **DB→Sheet mirror** — the tab stays live and
readable, it just stops being the source of truth.

### 2. `recode/Board.tsx` — a 2,704-line function, and the highest-churn file in either repo

`Board()` spans lines 332–3035: **48 `useState`, 12 `useEffect`, ~60 nested
definitions.** Touched by **32 of the companion's 60 commits.** Highest complexity ×
highest change rate is where the next production bug comes from.

It also duplicates the bill page — commit `12bdf29` is literally *"port add/delete line
and tax editing from the bill page"*. That logic now lives in both `Board.tsx` and the
1,575-line `bill/[docId]/page.tsx` (32 `useState`).

ESLint independently flags this file: four `react-hooks/exhaustive-deps` warnings on
`openLines` recomputing every render, plus a missing `codeOf` dependency.

### 3. `pave()` has no retry — the client it replaced does

`src/lib/jobtread.ts`'s `pave()` is a single bare `fetch`: no retry, no backoff, no
timeout. The *older* Apps Script client (`_jtFetch`) has 3 retries with exponential
backoff on 429/502/503, plus `_jtFetchAll` for batching. **The newer, more heavily used
path is less resilient than the one it replaced** — every JobTread 429 surfaces on a
phone in the field as a hard error.

Same gap on the bridge: 17 hand-copied `callAppsScript` helpers, none with retry or
timeout, in two different return shapes.

⚠️ **Retry must be mutation-aware.** Re-sending a mutation after a 502 could
double-create a bill, line, or time entry — silently, in the money path. Retry 429
always (rate-limited ⇒ never processed); retry 502/503 **only when
`findMutations(query)` is empty**, reusing the function already in
`src/lib/paveGateway.ts`. This is deliberately stricter than `_jtFetch`, which retries
mutations too — a latent risk on the Apps Script side worth its own look.

### 4. Per-cell `setValue()` inside loops on the hot sync paths

Each call is a separate round trip to the Sheets backend, inside a 6-minute budget.
Confirmed at `JobTread.js:2574` (`totalUpdates.forEach(u => …setValue(…))`),
`JobTread.js:4210`, `JobTread.js:1196`, `Diagnostics.js:3593`, `:3828`, `:3926`,
`:6805`. Batching each into one `setValues()` per column/block is typically 10–50× on
these shapes.

Cheaper related win: 42 `getDataRange().getValues()` calls in `Diagnostics.js` and 26 in
`Sheets_AppSheet.js` are full-sheet reads where a bounded range would do.

### 5. `Diagnostics.js` holds the production web-app dispatcher

9,441 lines, 166 functions. It contains the `doPost` router (55 cases), all 18
`_companion*` handlers serving the live app, and the sync orchestrator (`step*_LIVE`,
`_syncWithScriptLock`, `runFullJtSync`) — alongside 41 one-off `diagnose*`/`probe*`
investigations for bugs already fixed.

The most business-critical entry point in the repo lives in a file named
"Diagnostics", and its size directly aggravates the repo's own hard rule #1 about
last-definition-wins global collisions.

### 6. Business rules duplicated across the two repos

`deriveBillingPeriod`, bill issue/due dates, and line taxability exist twice — in
`Config.js`/`JobTread.js` (GAS) and `src/lib/billing.ts` (TS), whose header says *"keep
this file in lockstep with the Apps Script originals"* and *"These rules have caused
real production bugs when re-derived from scratch."* Two implementations of a rule that
has already broken production, kept in sync by discipline alone.

Apps Script can't import TS, so full deduplication isn't practical. A shared golden-vector
fixture, asserted on both sides with a CI diff check, makes drift fail loudly instead.

### 7. No tests, anywhere

Neither repo had a test framework. The only gate was `npm run typecheck && npm run
build` run by hand. Most valuable targets are already pure and need no mocking:
`billing.ts`, `billLineMath.ts`, `leave.ts`, `taskRunner.ts` (its API already documents
`active()` as "for tests/diagnostics"), and `paveGateway.ts`'s
`findMutations`/`isMutationAllowed`/`sanitizeQuery` — **the single control standing
between the browser and arbitrary JobTread writes, currently covered by nothing.**

### 8. No error monitoring on the companion

**Zero** `console.error` calls in any API route; no Sentry/Axiom/Logtail. A 502 on a
phone in the field leaves no trail beyond Vercel log retention and alerts nobody. The
app has its own `usage.ts` telemetry for *activity* but nothing for *failures*.

### 9. In-process caches are weaker on serverless than their comments imply

`_refCache` in `jobtread.ts` and `ensuring` in `db/index.ts` are module-level. On Vercel
each concurrent lambda has its own copy and cold starts drop them, so hit rates are well
below what the code's reasoning assumes — and `clearJtRefCache()` after a write only
clears *the instance that handled the write*, so another instance can still serve stale
reference data for the full TTL.

**Not a bug** — TTLs are short and worst case is one re-read. Recorded so nobody is
surprised. **Measure before acting.**

### 10. Documentation drift

`ascent-appscript/CLAUDE.md` stated that `pushCodingUpdate`, `acceptJtCodingForRow`, and
`scanAndPushCodingUpdates` "remain in the codebase as dead code" — they had been
deleted. CLAUDE.md is described as "the law"; stale law misleads every future session.
*(Fixed in Stage 1.)*

`ascent-appscript` also had no `.gitignore`, tracked a `.DS_Store`, and carried an
**orphaned git submodule pointer** — a `160000` gitlink named `ascent-appscript` with no
`.gitmodules`, referencing a commit that doesn't exist in the repo (an accidentally
committed nested clone). *(Fixed in Stage 1.)*

### 11. `npm run build` fails from a clean clone

Found while wiring CI. `src/db/index.ts` calls `createClient()` at **module scope**, so
`next build`'s page-data collection opens the local libSQL file at *import* time. `data/`
is gitignored, so a fresh clone fails with
`ConnectionFailed("Unable to open connection to local database ./data/companion.db")`.
It only passes on a machine that already happens to have the directory.

The documented verification gate therefore doesn't work on a clean checkout. CI creates
`data/` as a stopgap. **The real fix is to make the client lazy** (construct on first
query, not at import), which also means an unreachable database fails at query time with
a useful error instead of at import time. Small, worth doing.

---

## Recorded decisions — do NOT do these

- **Don't rewrite Apps Script in Node.** It earns its place (see verdict above).
- **Don't move off Vercel or Next.js.** Branch→preview *is* the mobile build loop.
- **Don't swap libSQL for Postgres.** Already considered and rejected (`c0de4ee`).
- **Don't merge the two repos.** Different runtimes, different deploy paths; the split
  is load-bearing.
- **Don't chase the in-process caches** (finding 9) without measuring first.

---

## Progress checklist

Scope agreed: **Stages 1–5, then reassess.** Update this as stages land.

### Stage 1 — Housekeeping + CI gate · ✅ done
- [x] `ascent-appscript/.gitignore`; untrack `.DS_Store` and the orphaned gitlink
- [x] Correct the stale dead-code paragraph in `ascent-appscript/CLAUDE.md`
- [x] `ascent-companion/.github/workflows/ci.yml` — typecheck + build, lint advisory
- [x] `ascent-appscript/.github/workflows/ci.yml` — `node --check` every file, plus
      `check-globals.sh` enforcing hard rule #1 (passes clean today: no duplicate
      top-level names across 19 files)
- [x] ESLint config. **Baseline was far cleaner than expected** — 2 trivial errors
      (unescaped `'` in `chat/page.tsx` and `historical-cost/page.tsx`) plus 11
      `react-hooks/exhaustive-deps` warnings — so both were fixed and **lint is
      blocking in CI from day one**, not advisory as originally planned.
- [x] **Decoupled lint from the deploy path.** Adding ESLint made `next build` fail on
      those two errors, which would have broken the Vercel *production* deploy. Caught
      before commit. `next.config.mjs` now sets `eslint.ignoreDuringBuilds` so a style
      rule can never block a ship — especially not one being made from a phone. Type
      errors still fail the build; only lint moved to CI.
- [x] This document

### Stage 2 — Field-visible failure points (companion only) · ✅ done
Vercel preview → production. **No Apps Script deploy.**
- [x] **2a — `src/lib/appsScript.ts`.** One client with timeout, read-only retry, and
      the 302/`ok` parsing; all 26 routes converted, 17 copies deleted, **−570 lines**.
      Split by *helper shape* rather than by domain, which turned out to be the real
      fault line: `{data,status}` ×10, `NextResponse` ×9, throwing ×5, plus 2
      fire-and-forget sync kicks. Notes for whoever touches this next:
      - **Retry is opt-out by action name.** `isRetryable()` allows `list*`/`get*` plus
        four named reads; anything else is assumed to write and is never retried.
        Retrying a `logMileage` whose response was lost writes the trip twice.
      - **Timeouts track each route's `maxDuration`** (minus a few seconds) so a stall
        returns a readable 504 instead of an opaque platform kill. If you change a
        route's `maxDuration`, change its `timeoutMs` to match.
      - `kickJtSync()` returns `boolean | null` — `null` means "not configured", which
        must stay silent; `false` means "tried and didn't confirm", which warns.
      - `stuck-vendors` keeps one explicit env check on purpose: it returns 400 without
        entering `unstable_cache`, and its throw-on-failure is what keeps a bad result
        out of that cache.
- [x] **2b — mutation-aware retry + timeout in `pave()`** (finding 3). Retries only
      when `findMutations(query)` is empty, so a create/update/delete is sent exactly
      once — same detector as the gateway, so "what is a write" has one definition.
      Only transient transport conditions retry (network error, timeout, 429/5xx); a
      200 carrying a JSON `errors` array still throws first try. 30s request timeout.
- [x] **2b — lazy libSQL client** (finding 11). `db` is now a Proxy over a
      built-on-first-use client, so `next build` never opens the database. **Finding
      11 is fixed and the `mkdir -p data` CI step is gone.** Don't reintroduce a
      module-scope `createClient()`.
- [x] **2c — Sentry** (finding 8), across node + edge + browser, with
      `onRequestError` and a `global-error` boundary. **Inert unless
      `NEXT_PUBLIC_SENTRY_DSN` is set** — that is a supported state; keep it that way.
      `sendDefaultPii: false` and a `beforeSend` denylist strip grantKey/secret/
      authToken/Bearer text and any attached cookies, headers, or body. Replay is off
      deliberately (it would record job financials on screen).
      - ⚠️ **`instrumentation.ts` must live in `src/`**, not the repo root — this
        project uses a `src/` dir, and at the root Next silently ignores it, so
        nothing server-side registers. Cost an hour to spot; don't undo it.
      - ⚠️ **No `tunnelRoute`.** It generated no route/rewrite here, and
        `middleware.ts` matches everything but `_next/static`, so `/monitoring` would
        redirect to `/login` — and a 404ing tunnel silently discards every browser
        report. Re-adding it needs a PUBLIC middleware entry *and* a verified route.
- [x] Fixed the 2 lint errors; lint is blocking (done early, in Stage 1)

### Interlude — merged work from other sessions (2026-08-08)

- Vendor-detection fixes (appscript) and the vendor Refresh fix (companion) merged to
  `main`. The companion side was already built on Stage 2a's shared client. The
  appscript side also batched the Sync Notes column into one `setValues` — **a slice of
  Stage 5 is already done**, so re-locate the remaining targets rather than trusting
  finding 4's line numbers.
- **Time Sync** (`/time-sync`) was an open PR from an ORPHANED history — its branch and
  `main` share **no merge base** (different root commits; the repo history was rewritten
  after it was cut). It could not be rebased or merged; the one meaningful commit was
  cherry-picked onto `main` instead, and its sibling commit turned out to be in `main`
  already under a different hash. **If another stale branch appears, check
  `git merge-base` before trusting a PR's "mergeable" status.**
- That PR carried a hand-rolled `callAppsScript`, and converting it surfaced a **19th
  copy in `src/lib/leaveService.ts`** that Stage 2a missed — the sweep then searched
  `src/app/api`, not `src/lib`. Both now use the shared client. `src/lib/appsScript.ts`
  is the only place reading `APPS_SCRIPT_SYNC_URL`, apart from the deliberate
  `stuck-vendors` guard.

### Stage 3 — Tests · ✅ done
**120 tests, 6 files, blocking in CI.** Scoped to pure modules — no DB, no network,
no React. Route handlers and components are deliberately out of scope (they need a
running Next request context); that gap is real and unclosed.
- [x] `vitest` + `npm test` (+ `npm run test:watch`), blocking in CI
- [x] **`paveGateway.ts`** — the write gate. Includes the false-positive that would
      break reads: selecting `createdAt`/`updatedAt` must not look like a mutation.
- [x] **`pave()` retry** — every write path (`createDocument`, `updateCostItem`,
      `deleteCostItem`, `createTimeEntry`, …) asserted to be sent **exactly once** on
      502 / 429 / network failure, including when a mutation rides alongside a read.
- [x] **`appsScript.ts`** — `isRetryable` over the real action names; writes never
      retried; `kickJtSync`'s `null` vs `false` distinction pinned.
- [x] **`billing.ts`** + shared golden vectors (below)
- [x] **`billLineMath.ts`** — the tax-inclusive ↔ pre-tax round trip, which must be
      lossless on an untouched bill. Also pins JS float half-way rounding, which is
      *shared* with the Apps Script side — don't "fix" it in one repo only.
- [x] **`taskRunner.ts`** — same-key tasks strictly serialized (a job's Finalize reads
      what its own Sync writes), different keys concurrent, cap respected.

**Billing golden vectors — the cross-repo contract.** `src/lib/billing-vectors.json`
is the source of truth (20 vectors). `scripts/gen-billing-vectors.mjs` mirrors it to
`ascent-appscript/BillingVectors.js`. Both repos assert their OWN implementation
against the same table:
- companion → `npm test`
- appscript → `.github/check-billing-vectors.mjs` in CI (extracts the real
  `deriveBillingPeriod` from `Config.js` and runs it under `TZ=America/Los_Angeles`),
  plus `diagnoseBillingPeriodVectors()` for the Run dropdown.

Vectors use **UTC instants, not calendar dates**, so they exercise the Pacific
boundary — an 11pm-Pacific-on-the-10th bill must not count as the 11th. Verified the
check actually fails on drift, not just passes. Editing the rule means: edit the
fixture, re-run the generator, commit **both** repos.

- [ ] Not done: `leave.ts` accrual maths still untested (accrual is DB-only and writes
      nothing to JobTread, so it ranked below the write paths)

### Stage 4 — Split `Diagnostics.js` · 🔶 code done, CI green, **NOT DEPLOYED**
Splits into `WebApp.js` (doPost/doGet, `WEBAPP_BUILD`, `WEBAPP_ACTIONS`,
`COMPANION_TASKS`, all `_companion*`), `SyncOrchestrator.js` (lock, `SYNC_*`/`EST_*`
consts, `step*` wrappers, `runFullJtSync*`), and `Diagnostics.js` (probes only).

**Read before starting:**
1. **Move only. Rename nothing.** Installed triggers bind by name — a renamed target
   silently stops running. Protected: `runFullJtSync`, `runFullJtSyncTriggered`,
   `scanJtInvoiceCaptureTags_LIVE`, `scanJtTodoCaptureTags_LIVE`,
   `syncAllTrackingSheetsLIVE`, all `step*_LIVE`.
2. **Update `deploy.sh`'s `STAMP_FILE` in the same commit** — it hardcodes
   `"Diagnostics.js"` and greps `^const WEBAPP_BUILD = ".*";$`. (Fails loudly: exits 1,
   nothing deploys.)
3. **Ship with `./deploy.sh`, not `clasp push`** — `clasp push` alone leaves the live
   `/exec` on the old version. That re-point briefly puts Tools, Mileage, Employees,
   Employee Time, Safety Meeting, Requisitions, Logs, Actions, Payments, Needs Project,
   and Tracking Sheet in play. **Quiet weekday mid-morning; not during invoicing week
   (1st–10th).**
4. `./.github/check-globals.sh` must pass before pushing.
5. Smoke-test from a phone, then confirm the hourly trigger fired in the Executions
   list before calling it done.
- **Rollback:** `git revert` + re-run `./deploy.sh`.

**Status (2026-08-08):** the split landed as `b1b17a3` on
`claude/repo-structural-analysis-v4wnln`, CI green. **It has NOT been deployed** —
`doPost` moved, so it needs `./deploy.sh`, and the 8th is inside invoicing week.
Deploy after the 10th, then smoke-test and confirm the hourly trigger fired.

Result: `WebApp.js` (1,229) + `SyncOrchestrator.js` (313) + `Diagnostics.js`
(8,014, down from 9,513). Proven a pure move rather than eyeballed: declaration
inventory identical (183 = 183), each moved block a verbatim substring of the
original, remainder equal to the original minus exactly those spans.
`deploy.sh`'s `STAMP_FILE` moved to `WebApp.js` in the same commit. Extra check
worth repeating on any future split: concatenating all files into one scope must
parse clean — that is the load-time duplicate-declaration failure a split can
introduce, and neither `node --check` per-file nor the globals script proves it
on its own.

⚠️ **Still in `Diagnostics.js`, and still production code:** the sync step
IMPLEMENTATIONS (`reconcileSheetJobsFromJT`, `pullJtBillPdfsToDrive`,
`relinkStaleJtDocs`, `sweepDeletedInJtRows`, the re-file pipeline). Only the
`step*_LIVE` wrappers moved. Splitting those out too is a refactor, not a file
move — deliberately out of scope here.
 The deployment id is fixed, so the
  same URL is re-pointed — no companion env change.

Verified safe: every top-level `const` in `Diagnostics.js` is a pure literal (none
dereferences `CONFIG`/`COLUMNS`/`JT_STATUS`), so the split cannot cause a load-order
failure even though `.clasp.json` has `filePushOrder: []`. Apps Script shares one global
scope, so moving a function is invisible to callers.

### Stage 5 — Batch the sheet writes · ⬜ not started
Targets in finding 4 (line numbers shift after Stage 4 — re-locate, don't trust them).
**One function per commit, no exceptions:** run the existing `step*_dry`, save the log →
change → run `_dry` again and **diff the logs, they must be identical** → run `_LIVE`
once and eyeball the range → commit.

### Then reassess — Stages 6 & 7 (specified, not committed)
- **Stage 6** — split `Board.tsx` (finding 2). Not app-breaking, but a merge-conflict
  magnet: needs a dedicated session with no other companion work in flight, merged the
  same day.
- **Stage 7** — move companion-only data off Sheets (finding 1). Per dataset, smallest
  first (Requisitions → Tools → Mileage → Employees → Safety → EmployeeTime), five
  reversible phases: table behind a flag → backfill → dual-write a week → **flip reads
  (the only user-visible moment)** → delete the old path after a clean week. **Each
  needs the DB→Sheet mirror** (finding 1). Drive/Docs dependencies — safety roster PDF,
  mileage report PDF, tool and time photos — stay on Apps Script as narrow calls.
