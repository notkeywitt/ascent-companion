# SIMPLICITY_AUDIT.md — `ascent-companion`

Read 2026-09-14 against the working tree: **482 files, 117,545 lines** of
TypeScript in `src/`. Every figure below was measured, not carried over from an
earlier document.

Findings **01**, **03** and **09** extend items already open in
`ARCHITECTURE_REVIEW.md`. The other ten are new. Nothing here re-opens a settled
decision — see "Do not do these" at the end.

The web version of this report, with the fixes set out one per block:
<https://claude.ai/code/artifact/aa608f2c-34c1-46fc-8b0c-dfdfadf5f85f>

---

## Measured baseline

| | |
|---|---|
| Lines of TypeScript in `src/` | 117,545 |
| Source files | 482 |
| API routes | 147, under 81 top-level names |
| Pages / gated views | 54 / 39 |
| Database tables | 47 |
| Largest single function | 4,595 lines |
| Copies of `money()` | 39 |
| Runtime dependencies | **10** — genuinely lean |

## What is already right

- **Ten runtime dependencies.** No component library, no state library, no ORM
  sprawl. Most apps this size carry sixty.
- **One Apps Script client** (`lib/appsScript.ts`) with a timeout, a read-only
  retry rule, and a written reason for that rule. It replaced 17 hand-copied
  helpers.
- **The billing-period rule has golden tests** shared with the Apps Script repo.
  The most bug-prone rule in the system is the best-guarded.
- **Write safety is real.** Two named gates, a per-role mutation allowlist, and a
  journal snapshot taken before anything is deleted.
- **The colour tokens are a true design system** — two palettes, two themes,
  contrast ratios worked out and recorded in `THEME.md`.

---

## Findings

Each carries a mark. **FIGURES** can put a wrong number on screen. **CHANGE
COST** makes every future edit slower. **DEAD WEIGHT** is shipped code that does
nothing.

### 01 — One function is 4,595 lines long · CHANGE COST

`src/app/trackingsheet/Board.tsx` — `Board()` runs line 368 to 4,962.
71 `useState`, 18 `useEffect`, 37 `useMemo`. Two hooks are declared 850 lines
into the body. 8 of the last 50 commits touched it: the highest-churn code file.
No tests. It writes coding to live JobTread money.

Eight unrelated jobs share one function: the month load, bill coding, the tax
panel, invoice approval, the tracking-sheet push, the pre-send checks, the
cost-code rail and time coding.

The August review flagged this file at 2,704 lines. It has grown 70% since.

**Option A — Split the file by job (recommended)**

1. Make one new file for each block of the board. Start with time coding. It is the most separate.
2. Move the state for that block into the new file.
3. Keep the month and the loaded data in `Board.tsx`. Send them to each block.
4. Move one block in one session. Push after each block.
5. Do no other work on this file at the same time.

**Option B — Freeze the file, then split it**

1. Add no new function to this file.
2. Write a test for each money calculation in the file.
3. Split the file after the tests pass.

> **Caution.** A split and a feature edit at the same time cause a merge conflict
> in the largest file you have. Do one or the other.

### 02 — Page loops stop early and say nothing · FIGURES

`src/lib/jobtread.ts` — 84 uses of `nextPage`, about 42 paged queries, no shared
helper. 25 hand-written loops of the form `do { … } while (page && ++guard < N)`.

`N` has **eight** different values: 10, 20, 50, 100, 200, 2000, 10000. None of
them throws, logs, or reports to Sentry when the limit is reached.

A job with more bills than its loop allows returns a short list and a total that
is quietly too low. This is the only finding that can put a wrong figure in front
of a client.

**Read all pages in one shared function (recommended)**

1. Write one function in `jobtread.ts` that reads all pages of a Pave query.
2. Give the function one page limit. Use the same limit for every caller.
3. Make the function stop with an error when it reaches the limit.
4. Do not let the function return part of the data.
5. Change each of the 25 loops to call the function.
6. Test the function on a job that has more than 100 bills.

> **Do this first.** An error is safe. A short total is not.

### 03 — The database is described twice · CHANGE COST

`src/db/schema.ts` — 1,368 lines, 47 tables, in Drizzle.
`src/db/index.ts` — `applySchema()`, 884 lines of raw SQL: 48 `CREATE TABLE`,
17 `ALTER TABLE`, 23 indexes. No `drizzle-kit`, no migrations folder. Nothing
checks that the two agree.

Adding one column means editing two files in two languages. If they drift, the
types say one thing and the live table holds another, and the failure appears at
query time in production.

**Option A — Let the tool write the SQL (recommended)**

1. Add `drizzle-kit` to the project. It writes the SQL from `schema.ts` for you.
2. Make the first migration from the schema you have now.
3. Compare that migration to `applySchema`. Correct any difference you find.
4. Delete `applySchema` and the fingerprint code.
5. Run the migrations where `ensureDb` runs now.

**Option B — Keep one file and write SQL by hand**

1. Delete `schema.ts`.
2. Write every query as raw SQL.

Option B removes the duplication but loses the types. Option A keeps both.

> **Caution.** Step 3 is the safety step. A difference between the two files is a
> live data problem. Find it before you delete anything.

### 04 — The documented way to build a page has no users · DEAD WEIGHT

`gatewayQuery()` in `src/lib/paveGatewayClient.ts` has **zero** callers in
`src/`. The stack kept alive for it: `paveGatewayClient.ts` 30 +
`paveGateway.ts` 202 + its test 123 + `api/pave/route.ts` 164 = **519 lines**,
plus two environment flags and a section of `CLAUDE.md`.

`CLAUDE.md` step 1 tells every future session to fetch JobTread data through the
gateway, and names `src/app/jobs/` as the worked example. `/jobs` calls
`/api/jobs/browser` instead. Every page uses a purpose-built route.

The cost is not the 519 lines. It is that the written instruction sends the next
person down a path nobody else took.

**Option A — Remove the gateway (recommended)**

1. Delete `paveGatewayClient.ts`, `paveGateway.ts`, its test, and `/api/pave`.
2. Remove `COMPANION_GATEWAY_WRITES_ENABLED` from Vercel.
3. Correct step 1 of the recipe in `CLAUDE.md`. Describe the API route pattern the pages use.
4. Remove the gateway paragraphs from `CLAUDE.md` and `FRONTEND_ARCHITECTURE.md`.

**Option B — Prove the gateway on one page**

1. Move `/jobs` to `gatewayQuery`.
2. Compare the result to the API route it replaced.
3. Keep the gateway only if the page is simpler than before.

> **This removes a risk.** The gateway allowlist lets `deleteDocument` run. Only
> a written rule stops a bill being destroyed. Option A removes that door.

### 05 — The same 45 lines are copied across the API · CHANGE COST

Six routes set six fields on one bill — `bill-duedate`, `bill-issuedate`,
`bill-number`, `bill-status`, `bill-tax`, `bill-fields` — **389 lines**. Each
repeats: grant check → parse JSON → validate → writes preview → `qboLock` →
journal → 502 catch. Only the field name and one validation line differ.

Across all 147 routes: **64** copies of the grant check, **73** of the catch,
**279** of the error expression.

In the browser the same shape repeats: **83** components write their own fetch,
**133** loading / error state pairs, no shared way to load data.

**Server side (recommended)**

1. Write one helper that runs a bill field write. Give it the field name, the check, and the journal name.
2. Make one route, `/api/bill-field`. Let the body name the field.
3. Change the pages that call the six routes. Do this in the same commit.
4. Delete the six routes.
5. Write one helper for the error answer. Use it in the 73 routes that repeat it.

**Browser side**

1. Write one hook (a small reusable piece of React logic) that loads a URL.
2. Let it return the data, a loading flag and an error.
3. Use it on each new page. Move an old page when you next edit it.
4. Do not add a data-fetching library. One hook is enough here.

### 06 — Money is formatted 39 different times · FIGURES

**39** local definitions of `money()` across pages, components and routes. They
are not the same: six behaviours — two decimals, no decimals, null handling,
string parsing, a `/hr` suffix. No `src/lib/format.ts` exists.

Also: `defaultYm()` defined 4 times. `isDivisionLevelCode()` 3 times, one of
which is **already exported from `jobtread.ts`**. `/sunset/i` written inline 9
times.

The same figure can print as `$1,240.50` on one page and `$1,241` on another.

**Make one place for formatting (recommended)**

1. Make a new file, `src/lib/format.ts`.
2. Put one money function in it. Show two decimals.
3. Give that function an option for no decimals. Do not write a second function.
4. Add one short-date function and one month-name function.
5. Change the 39 pages to use the new file.
6. Delete the copied `isDivisionLevelCode` from the two pages. Import the one in `jobtread.ts`.

> **Caution.** Six of the 39 copies round differently on purpose. Read each one
> before you replace it.

### 07 — Names a reader cannot tell apart · CHANGE COST

- `/tracking-sheet` and `/trackingsheet` — different features, one hyphen apart
- `/api/tracking-sheet` and `/api/trackingsheet` — the same trap in the API
- `billing.ts` · `billingMonth.ts` · `billingMonths.ts` — three files, three jobs
- `/requests` (feature ideas) and `/requisitions` (purchase approvals)
- `/journal` and `/logs` · `billJournal.ts` and `financialJournal.ts`
- **81** top-level API names for 147 routes, in two styles: `/api/bill-tax` and `/api/bill/files`

The pair that matters is `/trackingsheet` against `/tracking-sheet`. One is the
client-invoicing and coding board. The other pushes rows into a Google
spreadsheet. A search for "tracking sheet" finds both.

**Rename by what each one does (recommended)**

1. Rename `/trackingsheet` to `/invoicing`. It holds the month's invoices and the coding work.
2. Keep `/tracking-sheet` as it is. It pushes the Google sheet.
3. Rename the two API routes to match the pages.
4. Add a redirect from each old path, as `/tool-tracker` already does. Staff have bookmarks.
5. Put `billingMonth.ts` and `billingMonths.ts` into `billing.ts`.
6. Rename `/requests` to `/ideas`.
7. Write down one style for API names. Use it for every new route.

### 08 — One module holds the whole JobTread layer · CHANGE COST

`src/lib/jobtread.ts` — 6,296 lines, **130** exports. It covers bills, budgets,
cost detail, jobs, vendors, users, time entries, invoices, tax, files and
buyback.

**87** of the repo's 115 uses of `any` live here: the Pave answers carry no
types. `jobtread.test.ts` covers `pave()` and 1 of the 130 exports.

Because the answers are untyped, every caller reaches through them blind —
`r?.job?.costItems?.nodes ?? []`. If JobTread renames a field, nothing fails at
build time. The page renders an empty list.

**Option A — Type the answers first (recommended)**

1. Write a type for each Pave answer the code reads.
2. Put each type next to the function that reads it.
3. Remove the `any` from that function.
4. Do one function each time you edit this file.

**Option B — Split the file by subject**

1. Make one file for bills, one for jobs, one for time, one for invoices.
2. Keep `pave()` and the cache in one file. Every other file calls it.
3. Do this after the board split in finding 01. Both touch the same code.

### 09 — The tests run after the deploy, not before · FIGURES

`main` is production and a push deploys at once.

- `.githooks/pre-push` runs **typecheck** and **build**. It does not run the tests.
- `scripts/ship.sh` runs no tests either.
- `.github/workflows/ci.yml` runs `npm test` and lint **on push** — after Vercel has shipped.

45 test files, 8,367 lines, over 117,545 lines of source. Zero component tests.

The tests you have are good ones. They guard the billing period, the tax round
trip and the write gates. They cannot stop a bad push, because they start after
the code is live for field staff.

**Option A — Run the tests in the push hook (recommended)**

1. Add `npm test` to `.githooks/pre-push`.
2. Put it before the build. The tests are fast. The build is not.
3. Keep typecheck and build as they are.
4. Tell the office that a push now takes longer.

**Option B — Make Vercel wait for CI**

1. Turn on the Vercel setting that waits for GitHub checks.
2. The deploy then starts only after the tests pass.

Option A tells you before the code leaves the machine. Option B tells you after.

### 10 — Code that ships and does nothing · DEAD WEIGHT

- `/coding` (310 lines) and `/stage` (518 lines) — retired, zero inbound links, still routed, still gated
- a `RETIRED` set in `lib/pagesMenu.ts` exists only to hide those two from the menu
- `admin/DigestInstructionsPanel.tsx` — marked "INERT SINCE 2026-09-04", still rendered on `/admin`, backed by an inert route and a live table
- `components/RefreshButton.tsx` — zero importers
- 84 markers of retired or legacy code in `src/`

The inert admin panel is the one that can mislead a person. An admin can type
digest instructions into it today, save them, and nothing reads them.

**Delete what does nothing (recommended)**

1. Delete `DigestInstructionsPanel` and `/api/admin/digest-instructions`. An admin can type into that panel now and nothing happens.
2. Delete `/coding` and `/stage`.
3. Delete their entries in `views.ts` and the `RETIRED` set in `pagesMenu.ts`.
4. Delete `components/RefreshButton.tsx`.
5. Keep the `digest_instructions` table. Delete the rows only when you are sure nobody wants them.

### 11 — Six Claude clients, forty-five raw settings · CHANGE COST

Six files build their own Anthropic client: `anthropic.ts`, `claudeExtract.ts`,
`digest/claude.ts`, `invoiceReview/learn.ts`, `narrate.ts`, `investigate.ts`.
Each has its own key check, its own singleton, and its own model setting. All six
default to the same model.

**45** environment names are read directly from `process.env` in pages and
routes. `lib/config.ts` covers JobTread and leave only. `ANTHROPIC_API_KEY` is
read in 14 places.

**One client, one settings file (recommended)**

1. Make one file that builds the Claude client. Put the key check in it.
2. Let each caller pass the model name it wants.
3. Change the six files to use it.
4. Keep a separate model name only where the model must differ. Delete the rest.
5. Read every environment value in `config.ts`.
6. Do not read `process.env` in a page or a route again.

### 12 — The design system is followed about half the time · CHANGE COST

229 `<Button>` against 225 plain `<button>`. 81 `<Input>` against 88 plain
`<input>`. 154 hand-styled card blocks outside `ui.tsx`. `CLAUDE.md` says: build
every UI on these primitives, never hand-rolled styles.

`globals.css` also rewrites two Tailwind class names by hand —
`.dark\:border-neutral-600` and `-700`. A rule in the stylesheet changes what
`dark:border-neutral-600` means, but only in one palette, and nobody reading the
page file can see it.

**Close the gap one page at a time (recommended)**

1. Start with the pages the field staff open most.
2. Change each plain control on that page to the `ui.tsx` part.
3. When a page needs a part that does not exist, add it to `ui.tsx`. Do not style it in the page.
4. Change the 40 call sites that write `dark:border-neutral-600` to `border-line-strong`.
5. Delete the two override rules in `globals.css` after those call sites are changed.

> **Caution.** Delete the override rules last. If you delete them first, 40
> borders change colour in the website palette.

### 13 — Some files are more prose than code · DEAD WEIGHT

**21,145** comment lines — 18% of `src/`. `salesTax.ts` is 60% comment,
`views.ts` 55%, `db/schema.ts` 51% (711 of 1,368 lines). 158 comments carry a
date. 49 markdown files, 6,575 lines. `CODEBASE_MAP.md` is 71 KB, too large to
load automatically.

Two kinds of comment are mixed. A note recording a live API test —
"probe-confirmed 2026-09-03" — is worth more than the code it sits above, because
nothing else records it. A note saying what the code used to be is git's job.

This is the least urgent finding. It is listed because the volume is why a new
session reads 71 KB before it can find a file.

**Keep the tests, drop the history (recommended)**

1. Keep a comment that records a live API test. Keep its date.
2. Keep a comment that says *why* the code is as it is.
3. Delete a comment that says what the code used to be. Git holds that.
4. Delete a comment that repeats what the line below it says.
5. Move the long notes out of `views.ts` and `schema.ts`. Put them in the matching document.
6. Do this only in a file you are already editing. Do not make a pass for it.

---

## Order of work

Correctness first, then the cheap wins, then the two large splits.

| # | Finding | Why now | Size |
|---|---|---|---|
| 1 | 02 · paging | The only one that can print a wrong total | Half a day |
| 2 | 09 · test gate | Protects every change after it | One hour |
| 3 | 10 · dead code | An admin can type into an inert panel today | One hour |
| 4 | 06 · `format.ts` | Stops the same figure printing two ways | Half a day |
| 5 | 11 · one Claude client | Small, contained, removes five copies | Two hours |
| 6 | 04 · remove the gateway | Also closes the bill-delete door | Two hours |
| 7 | 05 · route helpers | Makes the next write rule a one-file change | One day |
| 8 | 07 · renames | Do before the split, so the split lands on final names | Half a day |
| 9 | 03 · drizzle-kit | Ends the two-language schema | One day |
| 10 | 01 · split `Board.tsx` | The big one — needs a clear session, no other work in flight | Several sessions |
| 11 | 08 · type `jobtread.ts` | Continuous; after the board split | Ongoing |
| 12 | 12 · design system | One page at a time, as you touch them | Ongoing |
| 13 | 13 · comments | Only in files you are already editing | Ongoing |

## Do not do these

- Do not change the stack. Next.js, Vercel, libSQL and the two-repo split are
  settled decisions, recorded in `ARCHITECTURE_REVIEW.md`.
- Do not join the two repositories. Different runtimes, different deploy paths.
- Do not weaken the write gates to remove duplication. The repeated guard in 64
  routes is the cost of the gate working.
- Do not add a data-fetching library, a component library, or a state library.
  Ten dependencies is an asset. One shared hook solves finding 05.
- Do not delete a comment that records a live API probe. Nothing else holds that
  result.
- Do not start finding 01 and a Board feature in the same week. The merge
  conflict costs more than the split saves.
