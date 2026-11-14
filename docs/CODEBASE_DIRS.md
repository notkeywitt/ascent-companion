# CODEBASE_DIRS.md — directory map of the companion repo

The second half of `CODEBASE_MAP.md`. Read the map's task table first. Open
this file only when that table does not name the file you need.

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
| `toolScheduleStore.ts` | The tool schedule's tables (types added by hand, task → tool needs, bookings, left-out jobs, trailer loads) and the Tools-sheet read (cache tag `tools`, shared with `/api/tools`). |
| `toolTrailers.ts` | A trailer's load goes where it goes: `moveLoadWith` writes the trailer's new Location to every tool riding in it (Apps Script `updateToolLocation`), called after a scan and a Location edit. |
| `toolScheduleAccess.ts` | Who may edit the tool schedule (the `tool-schedule-edit` view), for the page's Edit link and every write. |
| `toolBatch.ts` | **Batch add, server side.** Saves phone captures (tables `tool_batch_*`), answers "is a run due", hands ready tools to Claude Code (`beginRun`), adds each analyzed tool to the Tools list (`addTool`: Apps Script `createTool` + `updateToolPhoto`), parks what it could not add, prunes photos 30 days after a tool is added. |
| `toolBatchRules.ts` ⟂ | Batch add's pure rules: the assigned `noqr-…` id, the QR id, `analysisDue` (the Analyze button, or 30 quiet minutes; never two runs at once), `cleanFields`, `mergeFields` (an update writes only filled, different values), `batchPrompt` (the copied Claude Code prompt). Client-safe, unit-tested. |
| `nearestSite.ts` ⟂ | The job site nearest a GPS fix (`haversineKm`; the Shop wins among the sites at the shop's address). Used by the Tools page's scan and by Batch add. Pure, unit-tested. |
| `toolBatchAccess.ts` | Who may run "Analyze Tools Batch" and clear its problems (the `tools-batch-analyze` view, office + admin). |
| `agentToken.ts` | The office Mac's bearer token check (`REVIEW_AGENT_TOKEN`), shared by `/api/invoice-review/agent` and its `/tools` sub-route. |
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
| `sheetTables.ts` | **Stage 7 — the Tools and Mileage tabs, copied into the companion DB.** The two flags (both default off), the copy each write route calls after Apps Script succeeds (`mirrorToolWrite`, `mirrorMileageWrite`), the backfill (`syncTools`, `syncMileage`) and the sheet-against-table check behind `/api/admin/sheet-tables`. Nothing reads the tables yet. Plan and flip steps: `docs/plans/STAGE7_TOOLS_MILEAGE.md`. |
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
    grantable per user for a bookkeeper), `changelog` (what reached production, from `git log` at build
  time; see "The development platform" in `CODEBASE_MAP.md`), `course` (the in-app "Reading Your Own App" walkthrough —
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
  `tools/batch` (+ `photo`, `analyze` — batch add; `analyze` is under `tools-batch-analyze`),
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
  `OfficeHome` (the admin and office Home: Needs attention, Today, To-dos, and
  the desktop widgets with per-user layout), `HomeActions` (the phone's four
  big buttons on that Home — Deposit check, Add bill, Scan tool, Record miles;
  each button is itself the camera or start control),
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
  `UncapturedBills`, `StuckVendors`, `Notices` (`NoticeCenter` —
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
  `Spinner`, `DigestFindings` (the stored morning digest, opened under
  Needs attention on Home, and `CreateTodo`, Home's new-to-do form; no
  hardcoded tabs),
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
`company_details` + `company_documents` (Ascent's own tax rate, P&O and permit numbers, and the permit files — `src/lib/companyDetails.ts`),
`mileage_open_trips` (the started-but-not-ended trip, one row per driver — the
cross-device backup for the phone's copy; a finished trip goes to the Mileage
sheet instead, see `src/lib/mileageTrip.ts`),
`tool_batch_items`, `tool_batch_photos`, `tool_batch_events` (batch add: phone
captures and update requests waiting for Claude Code — mode add/update, GPS job
site, the run holding each — their photos, and the analysis log — `src/lib/toolBatch.ts`),
`tools` and `mileage_trips` (Stage 7 copies of the Tools and Mileage tabs — written only
behind `COMPANION_TOOLS_DB_WRITES` / `COMPANION_MILEAGE_DB_WRITES`, read by nothing yet;
`src/lib/sheetTables.ts`),
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
| `scripts/tool-batch/` | **Not app code — runs on the office Mac.** `install.sh` adds a launchd job (every 10 minutes) and shares the monthly check's token; `run.sh` asks `/api/invoice-review/agent/tools` whether a batch analysis is due and, if so, runs the `/tool-batch` skill headless on Sonnet; `agent.mjs` is the skill's only door (`begin [itemId …]` downloads photos to `.tool-batch/`, `submit` writes each tool, `finish`/`fail` close that run only). It reads the token from env `REVIEW_AGENT_TOKEN` first, so a Claude Code cloud session with that secret (and `ascent-companion.vercel.app` allowed) runs the same skill from a copied prompt. Log `~/Library/Logs/ascent-tool-batch.log` |
| `scripts/monthly-check/` | **Not app code — runs on the office Mac.** `install.sh` makes the token (`~/.ascent-monthly-check/token`, same value as Vercel env `REVIEW_AGENT_TOKEN`) and a launchd job; `run.sh` runs hourly and, on review days after 9 am, runs the `/monthly-check` skill headless on Opus; `agent.mjs` is the skill's only door to `/api/invoice-review/agent`. Log `~/Library/Logs/ascent-monthly-check.log` |

