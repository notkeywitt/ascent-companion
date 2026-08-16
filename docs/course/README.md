# Reading Your Own App — a course profile

A guided program of study through **`ascent-companion`** (the Ascent Assistant),
written for the person who owns the business the app was built for.

---

## Who this is for

You know the business cold: what a vendor bill is, why an uncoded bill is a
problem, what unbilled cost means at month end, why JobTread has to stay the
source of truth. You are **not** a professional developer, and you don't need to
become one.

That's actually the ideal starting position for this course, because the hard
half of understanding this codebase is knowing what the work *is*. You already
have that half. What's missing is the map: which file does which job, where the
data actually comes from, what's safe to touch, and what would break if it moved.

## What this course is *not*

- **Not a Next.js tutorial.** You will not learn to build web apps from scratch.
  Framework concepts show up only when they explain something about *this* app
  (e.g. "why is this file split into two, `page.tsx` and `JobsBrowser.tsx`?").
- **Not a syntax course.** You won't be asked to memorize TypeScript. Code
  appears as *evidence*, always with a plain-English translation next to it.
- **Not a rewrite plan.** Where the app has known weak points, the course points
  at `ARCHITECTURE_REVIEW.md` and moves on. This is about comprehension, not
  renovation.

## What you'll be able to do at the end

Concretely — these are the outcomes the segments are built backwards from:

1. **Open any screen in the app and say where its numbers come from.** JobTread?
   The Google Sheet? The companion database? Computed on the spot?
2. **Follow one click through the whole system** — phone tap → Vercel → server
   route → JobTread's API → back to the screen — and name the file at each hop.
3. **Explain the money model in the app's own terms**: budget vs. actual, cost
   items vs. documents, why "unbilled" is a subtraction and not a stored field.
4. **Know what's dangerous.** Which code paths write to live JobTread, what the
   two write flags do, and why "read-only by default" is the house rule.
5. **Ask for a change in terms a developer (or Claude) can act on immediately** —
   "add a column to the Unbilled page, sourced from the job's cost items" rather
   than "make the unbilled screen better."
6. **Judge a proposed change.** When someone (including an AI) suggests
   something, you'll recognize whether it fights the architecture — especially
   the JobTread↔Sheet mirror — or works with it.

## The spine — five ideas the whole app hangs on

Every segment is a variation on one of these. If you only ever remember five
things, remember these:

1. **The app owns almost no data.** It is a *lens*. JobTread holds the money,
   Google Sheets/Drive hold the office records, and a small companion database
   holds only the leftovers JobTread has no home for.
2. **Secrets live on the server, never in the browser.** The JobTread key sits in
   Vercel's environment. Your phone never sees it — it asks the app's own server,
   and the server asks JobTread.
3. **Reads are cheap and open; writes are gated.** Reading JobTread is allowed
   for anyone signed in. Writing is deliberately hard to do by accident.
4. **Who-sees-what is enforced on the server, not hidden in the UI.** Roles are
   checked before a page or route ever runs, in one file that everything else
   defers to.
5. **Don't race the mirror.** A separate automated back end (`ascent-appscript`)
   already syncs JobTread → Sheet → Drive every hour. New write paths that fight
   that loop are the main way this system can corrupt itself.

## The program — twelve segments, four units

| # | Segment | You'll be able to explain… | Primary files |
|---|---|---|---|
| **Unit A — Orientation** ||||
| 1 | **The shape of the thing** | What the app is, its three back ends, and one complete round trip from tap to screen | `README.md`, `src/app/jobs/*`, `src/app/api/jobs/browser/route.ts` |
| 2 | **The door** — who gets in, who sees what | Sign-in, roles, per-user overrides, and why gating happens server-side | `src/auth.ts`, `src/middleware.ts`, `src/lib/views.ts` |
| **Unit B — The JobTread layer** ||||
| 3 | **Talking to JobTread** | The Pave API's query grammar, the client that speaks it, retries, caching, and the expensive gotchas | `src/lib/jobtread.ts`, `JT_API_REFERENCE.md` |
| 4 | **The gateway and write safety** | The one generic door into JobTread, the two write flags, and the per-role allowlist | `src/app/api/pave/route.ts`, `src/lib/paveGateway.ts`, `src/lib/config.ts` |
| 5 | **The money model** | Jobs, budgets, cost items, documents, and why unbilled is a subtraction | `src/lib/jobtread.ts`, `src/app/unbilled/*`, `src/lib/billing.ts` |
| **Unit C — The workflows** ||||
| 6 | **The billing workflow** | A bill's whole life: arrives → coded → approved → invoiced, screen by screen | `src/app/recode/*`, `src/app/bill/[docId]/*`, `src/app/add-bill/*` |
| 7 | **The other back end** — Sheets & Drive | The Apps Script bridge, the shared secret, the hourly mirror, and the "don't race it" rule | `src/lib/appsScript.ts`, `CODEBASE_MAP.md` |
| 8 | **The companion database** | What earns a place in the app's own database, using PTO/sick accrual as the worked example | `src/db/schema.ts`, `src/lib/leave.ts`, `src/lib/leaveService.ts` |
| 9 | **The field apps** | Time, mileage, safety sign-ins, tools — phone hardware in, JobTread and Sheets out | `src/app/employee-time/*`, `src/app/mileage-tracker/*`, `src/app/safety-meeting/*` |
| **Unit D — Around the edges** ||||
| 10 | **The AI parts** | Gemini reading invoices, Claude answering questions, and why the assistant is read-only | `src/lib/gemini.ts`, `src/lib/anthropic.ts`, `src/lib/chatTools.ts` |
| 11 | **The look and the words** | The design system, why every screen matches, and the text you can reword without a deploy | `src/components/ui.tsx`, `src/lib/copy.ts` |
| 12 | **How it ships, how it breaks** | Branches, previews, production, environment variables, tests, and the known weak points | `DEPLOY.md`, `ARCHITECTURE_REVIEW.md`, `vitest.config.mts` |

### If you want the fast path

Segments **1, 2, 4, 5, 6, 7** are the core. Those six get you to "I understand
what this program does and what's risky about it." The rest add depth on the
parts you touch most.

## How each segment is built

Every segment follows the same five-part shape, so you always know where you are:

1. **The question** — one plain sentence the segment answers.
2. **The idea** — the concept in business terms, no code.
3. **The evidence** — the actual code, in small excerpts, each with a translation.
   Real file paths and line numbers, so you can open them yourself.
4. **Check yourself** — a handful of questions. Answers at the bottom of the
   segment; don't peek until you've tried.
5. **What this unlocks** — what you can now ask for, or now recognize as risky.

Segments are meant to be read in order but stand alone well enough to revisit.
Budget **30–45 minutes** each. Reading the referenced files as you go roughly
doubles that — and roughly doubles what sticks.

## How to actually read the code

You don't need a development setup. Three options, in order of convenience:

- **On GitHub, on your phone.** Every file path in these segments maps directly
  to `github.com/notkeywitt/ascent-companion/blob/main/<path>`. Tapping through
  is genuinely fine for reading.
- **Ask Claude.** "Show me `src/lib/views.ts` lines 220–240 and explain what
  `OFFICE_VIEWS` is doing" is a perfectly good way to work through a segment.
- **Locally**, if you ever want it: `npm install && npm run dev`.

A note on notation: `src/lib/views.ts:234` means *file `src/lib/views.ts`, line
234*. That colon-number convention is used throughout.

## The docs you already have, and how this course relates

This repo is unusually well documented. The course doesn't replace those docs —
it teaches you to use them.

| Doc | What it is | Course uses it in |
|---|---|---|
| `CODEBASE_MAP.md` | The index: which file does what | Every segment |
| `README.md` | What the app does, screen by screen | Segment 1 |
| `CLAUDE.md` | The working rules for anyone (human or AI) changing the code | Segments 4, 12 |
| `JT_API_REFERENCE.md` | The complete JobTread API schema (~82k words) | Segment 3 |
| `FRONTEND_ARCHITECTURE.md` | Why the generic gateway exists | Segment 4 |
| `USER_MANUAL.md` | How each screen is used, for staff | Segments 6, 9 |
| `ARCHITECTURE_REVIEW.md` | Standing structural critique + cleanup checklist | Segment 12 |
| `DEPLOY.md` | Vercel, environment variables, sign-in setup | Segment 12 |

## The size of the thing, for scale

Measured on the current branch:

- **228** TypeScript/TSX files, **~53,500** lines
- **39** `page.tsx` files (screens), across 37 top-level routes
- **98** server API routes
- **18** tables in the companion database
- **8** test files covering the pure-logic modules
- **3** back ends: JobTread, the Apps Script engine, the companion database

That's a real application — bigger than most people assume when they hear "an
app my contractor business uses." But it is *organized*, and by Segment 4 you'll
be able to place any one of those 228 files into a category without opening it.

---

**Start here → [Segment 1: The shape of the thing](01-the-shape-of-the-thing.md)**
