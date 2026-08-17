# Reading Your Own App — a course profile

> 📱 **Reading on a phone?** This whole course is on 1 page. This page remembers
> your place in the course:
> <https://claude.ai/code/artifact/f22e41ff-8e79-4920-845c-54a5bafb1135>
>
> The markdown files in this folder are the master copy of this course.
> `index.html` is a second copy, made for the web. When a segment changes,
> both copies change together, at the same URL.

This is a course about the code in **`ascent-companion`**. The name of the app
is the Ascent Assistant. This course is written for the owner of the
business. The app was built for this owner.

---

## Who this course is for

You know the business well. You know what a vendor bill is. You know why an
uncoded bill is a problem. You know what "unbilled cost" means at the end of
a month. You know why JobTread must hold the correct value for money data.
You are **not** a professional programmer. You do not need to become one for
this course.

This is a good starting point for this course. Understanding this code has
2 parts. Part one: knowledge of the real business work. Part two: knowledge
of the code's map. You already have part one. This course gives you part
two. The map shows which file does which job. The map shows where each piece
of data comes from. The map shows what is safe to change. The map shows what
can break, and how.

## What this course is *not*

- **Not a Next.js tutorial.** This course does not teach you to build a web
  app from the start. This course explains a framework idea only when the
  idea explains a fact about *this* app. Example: why does 1 screen use 2
  files, `page.tsx` and `JobsBrowser.tsx`?
- **Not a course in programming syntax.** This course does not require you
  to memorize TypeScript. Code appears in this course as evidence only. A
  plain explanation sits next to each piece of code.
- **Not a plan to rewrite the app.** Some parts of the app have known weak
  points. For these parts, this course points to the file
  `ARCHITECTURE_REVIEW.md`. This course does not try to fix these parts.
  The goal of this course is understanding, not repair.

## What you can do after this course

This list states the goals of this course:

1. **Open any screen in the app. State the source of each number on the
   screen.** Is the source JobTread? Is the source the Google Sheet? Is the
   source the companion database? Does the app calculate the number at that
   moment?
2. **Follow 1 user action through the whole system.** Example action: a tap
   on the phone. Trace the path: the phone, Vercel, the server route,
   JobTread's API, back to the screen. Name the file at each step.
3. **Explain the money system in the app's own words.** Explain the
   difference between budget and actual cost. Explain the difference
   between a cost item and a document. Explain why the app calculates the
   unbilled amount, instead of storing this amount.
4. **Know the dangerous parts of the code.** Know which code paths write
   data into the live JobTread system. Know the job of the 2 write
   switches. Know why the app reads data by default, and writes data only
   in approved cases.
5. **Ask for a change in exact, useful terms.** Good example: "Add a column
   to the Unbilled page. Get the data from the job's cost items." Weak
   example: "Make the Unbilled screen better."
6. **Judge a proposed change, from any source, including an AI.** Decide if
   the change fits the existing design. Decide if the change creates a
   conflict with the JobTread-to-Sheet sync process.

## The spine — 5 ideas behind the whole app

Every segment in this course connects to 1 of these 5 ideas. Remember these
5 ideas above all other facts in this course:

1. **The app stores almost no data of its own.** The app is a viewer for
   other systems. JobTread holds the money data. Google Sheets and Google
   Drive hold the office records. A small companion database holds only the
   data with no other home.
2. **A secret key stays on the server. A secret key never reaches the
   browser.** The JobTread key sits in Vercel's environment settings. Your
   phone never sees this key. Your phone asks the app's own server for
   data. The server then asks JobTread for the data.
3. **A read action is open to any signed-in user. A write action needs
   special permission.** This design makes an accidental write action
   difficult.
4. **The server, not the screen design, controls who can see what data.**
   The app checks a user's role before the app runs a page or a route. 1
   file holds this rule. All other code in the app follows this 1 file.
5. **Do not create a conflict with the sync process.** A separate system,
   named `ascent-appscript`, copies data from JobTread to the Sheet and to
   Drive. This copy runs every hour. A new write path can create a conflict
   with this copy process. This conflict is the main risk to the
   correctness of this whole system.

## The program — 12 segments, 4 units

| # | Segment | You can explain… | Primary files |
|---|---|---|---|
| **Unit A — Orientation** ||||
| 1 | **How the App Is Built** | The app's 3 back ends. 1 full request, from a tap on the phone to the answer on the screen. | `README.md`, `src/app/jobs/*`, `src/app/api/jobs/browser/route.ts` |
| 2 | **Sign-In and Roles** | Sign-in rules. The 4 roles. Why the server, not the screen, blocks a page. | `src/auth.ts`, `src/middleware.ts`, `src/lib/views.ts` |
| **Unit B — The JobTread layer** ||||
| 3 | **The JobTread Query Language** | The Pave query grammar. The code that sends and reads queries. Retries. Caches. Costly mistakes to avoid. | `src/lib/jobtread.ts`, `JT_API_REFERENCE.md` |
| 4 | **The Gateway and Write Rules** | The 1 general door into JobTread. The 2 write switches. The rule list for each role. | `src/app/api/pave/route.ts`, `src/lib/paveGateway.ts`, `src/lib/config.ts` |
| 5 | **How the App Tracks Money** | Jobs, budgets, cost items, documents. Why the app calculates the unbilled amount, instead of storing it. | `src/lib/jobtread.ts`, `src/app/unbilled/*`, `src/lib/billing.ts` |
| **Unit C — The workflows** ||||
| 6 | **The Billing Process** | A bill's full life: it arrives, gets a code, gets approval, becomes part of an invoice. Screen by screen. | `src/app/recode/*`, `src/app/bill/[docId]/*`, `src/app/add-bill/*` |
| 7 | **The Sheets and Drive System** | The Apps Script bridge. The shared secret. The hourly sync. The rule: do not create a conflict with this sync. | `src/lib/appsScript.ts`, `CODEBASE_MAP.md` |
| 8 | **The Companion Database** | What earns a place in the app's own database. The PTO and sick-leave system, as the worked example. | `src/db/schema.ts`, `src/lib/leave.ts`, `src/lib/leaveService.ts` |
| 9 | **The Field Screens** | Time entries, mileage, safety sign-in, tools. Data goes in from the phone. Data goes out to JobTread and to Sheets. | `src/app/employee-time/*`, `src/app/mileage-tracker/*`, `src/app/safety-meeting/*` |
| **Unit D — Around the edges** ||||
| 10 | **The AI Features** | Gemini reads invoices. Claude answers questions. Why the assistant only reads data; it never writes data. | `src/lib/gemini.ts`, `src/lib/anthropic.ts`, `src/lib/chatTools.ts` |
| 11 | **The Design System and Editable Text** | Why every screen matches. The on-screen text a user can edit, with no new deployment. | `src/components/ui.tsx`, `src/lib/copy.ts` |
| 12 | **Deployment and Known Problems** | Branches. Preview builds. Production. Environment variables. Tests. The known weak points in the code. | `DEPLOY.md`, `ARCHITECTURE_REVIEW.md`, `vitest.config.mts` |

### The fast path

Segment **1, 2, 4, 5, 6, and 7** form the core of this course. These 6
segments give you 2 results: understanding of the app, and understanding of
its risks. The other segments add detail about the parts of the app you use
the most.

## How each segment is built

Every segment has the same 5 parts. This design helps you know your place in
the course at all times:

1. **The Question.** This part states 1 plain question. The segment answers
   this question.
2. **The Idea.** This part explains 1 concept in plain business terms. This
   part contains no code.
3. **The Evidence.** This part shows real code, in small pieces. A plain
   explanation sits next to each piece. This part gives real file paths and
   line numbers. You can open these files yourself.
4. **Check Yourself.** This part asks a small set of questions. The answers
   are at the end of the segment. Try each question before you read the
   answer.
5. **What This Unlocks.** This part lists new things you can now ask for.
   This part lists new risks you can now recognize.

Read the segments in order, if you can. You can also read 1 segment alone,
later, as a review. Plan **30 to 45 minutes** for each segment. If you also
read the real files during the segment, plan double this time. This extra
time also doubles how much you remember.

## How to read the code

You do not need a development setup for this course. Here are 3 options, in
order of ease:

- **Option 1: GitHub, on your phone.** Every file path in this course maps
  to an address: `github.com/notkeywitt/ascent-companion/blob/main/`, then
  the path. You can read the code well through this method.
- **Option 2: Ask Claude.** Example request: "Show me `src/lib/views.ts`,
  lines 220 to 240. Explain the purpose of `OFFICE_VIEWS`." This method
  works well for 1 segment at a time.
- **Option 3: Run the code on your own computer.** Commands:
  `npm install`, then `npm run dev`.

A note on notation: the text `src/lib/views.ts:234` has 1 meaning: the file
`src/lib/views.ts`, at line 234. This course uses this format in many
places.

## The docs you already have

This repository already has many clear documents. This course does not
replace these documents. This course teaches you to use these documents.

| Doc | What it is | Course uses it in |
|---|---|---|
| `CODEBASE_MAP.md` | An index. This file states the job of each file in the code. | Every segment |
| `README.md` | A description of the app, screen by screen. | Segment 1 |
| `CLAUDE.md` | The rules for any person, or any AI, that changes this code. | Segments 4, 12 |
| `JT_API_REFERENCE.md` | The full JobTread API reference, about 82,000 words. | Segment 3 |
| `FRONTEND_ARCHITECTURE.md` | The reason for the general gateway in the code. | Segment 4 |
| `USER_MANUAL.md` | Instructions for staff. How to use each screen. | Segments 6, 9 |
| `ARCHITECTURE_REVIEW.md` | A review of the code structure. A checklist for cleanup work. | Segment 12 |
| `DEPLOY.md` | Instructions for Vercel setup, environment variables, and sign-in setup. | Segment 12 |

## The size of the app, for scale

These numbers come from the current branch of the code:

- **228** TypeScript and TSX files. About **53,500** lines of code in total.
- **39** `page.tsx` files. Each file is 1 screen. These screens use 37
  top-level routes.
- **98** server API routes.
- **18** tables in the companion database.
- **8** test files. These tests check the pure-logic parts of the code.
- **3** back-end systems: JobTread, the Apps Script engine, the companion
  database.

This is a real, large application. The size is larger than most people
expect, for "an app for a contractor business." But the code has clear
organization. After Segment 4, you can place any of these 228 files into its
correct category, with no need to open the file.

---

**Start here → [Segment 1: How the App Is Built](01-the-shape-of-the-thing.md)**
