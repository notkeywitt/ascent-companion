# Segment 1 — How the App Is Built

**Unit A · Orientation · about 40 minutes**

← [Course profile](README.md) · Next: Segment 2 — Sign-In and Roles

---

## 1. The question

> You tap an item on your phone. A number appears on the screen. Where does
> this number come from? What steps happen before the number appears?

After this segment, you can answer these 2 questions for any screen in the
app. You can also name the exact files that do the work.

---

## 2. The idea

### The app is a viewer. The app is not a filing cabinet.

Here is the most important fact about the Ascent Assistant: **the app does not
store your business data.**

The app has no database of bills. The app has no copy of your jobs. Look at
the Unbilled screen. This screen can show an amount, for example $47,320, for
costs not yet on a customer invoice. The app did not get this amount from
storage. The app got this amount from JobTread a few seconds before. The app
will get this amount from JobTread again, the next time a user opens the
screen.

This design has 2 results. Result one: the app data can never go out of date
compared to JobTread, because the app keeps no data of its own to go out of
date. Result two: the app is only as fast as JobTread is. This is the reason
the code uses many **caches**. A cache is a temporary store. A cache holds an
old answer for a short time, so the app does not have to ask again right away.
More on caches follows below.

### The app has 3 back ends

The app is a **front end**. A front end is a program that shows data from
other systems to a user. The app gets data from 3 back-end systems. Almost
every screen combines data from 1 or more of these systems.

| Back end | What it stores | How the app reaches it | Which system is correct |
|---|---|---|---|
| **JobTread** (the "Pave" API) | Jobs, budgets, cost items, vendor bills, customer invoices, payments, time entries, contacts | An HTTPS request to `api.jobtread.com/pave` | JobTread. **JobTread holds the correct value for all money data.** |
| **Google Sheets and Google Drive** | The employee roster, the tool list, the mileage log, safety sign-in records, requisitions, the Expenditure archive, PDF files | An HTTPS request to the Apps Script web app, in the sibling code repository `ascent-appscript` | Ascent's Google Workspace |
| **The companion database** | The data with no other home: RFIs, feature requests, the sign-in allow list, leave balances, lead follow-ups, editable page text. 18 tables in total. | A direct database query (Drizzle over libSQL) | This app |

A simple rule decides which system stores a fact. Learn this rule now. This
rule explains many decisions in the code:

> **Check JobTread first. Use Sheets only if the data was already there. Use
> the companion database only if JobTread and Sheets have no place for the
> data.**

This rule explains the design of the Time Off feature. JobTread has no object
for a leave request. So the app stores a leave request in the companion
database. But an approved leave request becomes hours worked on a job.
JobTread does have an object for this: the **time entry**. So the app writes
an approved leave request into JobTread, as a time entry.

### The fourth part: the app's own server

There is a fourth part of this system. Many users do not know about this
part. This part is the key to Segment 2 and Segment 4.

Your phone does **not** send requests to JobTread. Your phone cannot do this
safely. JobTread requires a **grant key** for every request. A grant key acts
like a password. A grant key gives access to all the company's money data. A
browser can be read by any person who holds the phone. For this reason, a
grant key must never reach the browser.

Instead, the system has 2 separate halves:

```
  YOUR PHONE                    VERCEL (the app's server)              THE WORLD
  ──────────                    ─────────────────────────              ─────────
  the screen        ──asks──►   a server route                ──asks──► JobTread
  (a "client                    (the only place the                     Sheets/Drive
   component")                   secret key is used)                    the database
                    ◄─plain──                              ◄─data────
                      numbers
```

The left half is public. Any person who holds the phone can see this half. The
right half is private. This half runs on Vercel's servers. This half holds
every secret key. Every piece of data, for every screen, crosses this line
exactly 1 time.

Remember this diagram. Almost every design rule in this code comes from this
1 fact.

---

## 3. The evidence

This part follows 1 real screen through the full system. The example is the
Jobs cost browser, at the route `/jobs`. A **route** is the address of a
screen. This screen shows a job's budget against the job's actual cost. This
screen has the same layout as the office Tracking Sheet.

### Hop 1 — The page (11 lines)

Here is the file `src/app/jobs/page.tsx`. This is the entire file:

```tsx
import { JobsBrowser } from "./JobsBrowser";

export default function JobsPage() {
  return <JobsBrowser />;
}
```

This file shows the pattern for every screen in the app. Each screen has a
small file named `page.tsx`. This file runs on the server. This file has 1
job: to send control to a larger component. This larger component runs in the
browser. The server part is the safe place for secret keys. The browser part
shows buttons and receives taps. This design puts the border, between safe
code and unsafe code, directly into the file structure.

Learn this naming rule now: a folder under `src/app/` becomes a URL. The
folder `src/app/jobs/` becomes the URL `/jobs`. The folder
`src/app/time-off/` becomes the URL `/time-off`. The folder
`src/app/bill/[docId]/` becomes a URL such as `/bill/22ABC123`. The square
brackets mean: put any value here. This is the full routing rule. The app has
39 folders of this kind. The app has 39 screens. This course page is proof of
the rule: this page lives at `src/app/course/`.

### Hop 2 — The browser asks the app's own server

The file `src/app/jobs/JobsBrowser.tsx` starts with these words:

```tsx
"use client";
```

These 2 words mark a border. Every file that starts with these words runs
**on the phone**. A file with these words must never contain a secret key.

When the screen loads, this file sends a request:

```tsx
fetch("/api/jobs/browser")
```

Read this request with care. This request asks for `/api/jobs/browser`. This
is **a route on the Ascent Assistant server**, not a route on JobTread. The
phone does not know that JobTread exists. The phone sends a request to its own
app. The app sends an answer back to the phone.

Later, when a user picks 1 job, the same file sends a second request:

```tsx
fetch(`/api/jobs/cost-detail?jobId=${encodeURIComponent(id)}`)
```

This is the same pattern. The phone sends a request to the app's own server.
This request also carries the job's ID.

### Hop 3 — The server route (the side with the secret key)

Here is the file `src/app/api/jobs/browser/route.ts`. This file has 41 lines.
Read the full file for more detail. Here is the main part of the file:

```ts
const getCachedJobBrowserList = unstable_cache(
  async () => {
    const cfg = getPaveConfig();
    const [jobs, phases] = await Promise.all([getJobs(cfg, true), getJobPhaseMap(cfg)]);
    return jobs.map((j) => ({ ...j, phase: phases[j.id] ?? null }));
  },
  ["api-jobs-browser"],
  { revalidate: 300, tags: ["jt-jobs"] },
);
```

Here is an explanation, in plain words, for each line:

- `getPaveConfig()` reads the server's environment variables. These variables
  hold the JobTread grant key and the organization ID. This function lives in
  `src/lib/config.ts:4`. A comment in this file states a rule: never import
  this function into a client component. A client component runs on the
  phone.
- `getJobs(cfg, true)` and `getJobPhaseMap(cfg)` each send 1 request to
  JobTread. The code sends both requests at the same time. The instruction
  `Promise.all` does this: it starts both requests together, then waits for
  both answers.
- `jobs.map(...)` joins the 2 answers into 1 result. This step adds each
  job's Phase value onto the matching job record.
- `revalidate: 300` sets a cache time of 300 seconds. This means: store this
  answer for 300 seconds, which is 5 minutes. During these 300 seconds, give
  this stored answer to any user who opens the Jobs screen. Do not ask
  JobTread again during this time.

A comment in this file explains the reason for this design. This comment
gives a clear view into the design choices in this code:

> *"Doing the join here instead of in the browser is the load-time fix: the
> client used to page `organization.jobs` (up to 10 gateway round trips) and
> then page the Status custom field (up to 20 more) on every single page
> load. Now it is one fetch."*

In plain words: the old code asked `organization.jobs` from the browser, in up
to 10 separate requests. The old code then asked for the Status custom field,
in up to 20 more requests. The new code asks 1 time only. A change of this
kind is not visible on the screen. But this kind of change makes a large
difference in practice, for example on a job site with a weak phone signal.

### Hop 4 — The request to JobTread

The function `getJobs` is in the file `src/lib/jobtread.ts:1911`:

```ts
export function getJobs(cfg: PaveConfig, includeClosed = false): Promise<JobRef[]> {
  return cachedRef(`jobs:${cfg.orgId}:${includeClosed}`, 5 * 60_000, () =>
    _getJobsUncached(cfg, includeClosed),
  );
}
```

This function has a **second** cache. This cache lives in the app's own
memory. This cache also stores an answer for 5 minutes
(`5 * 60_000` milliseconds). Almost every office screen reads the job list.
For this reason, the app stores this answer in 2 separate caches.

The real work happens in `_getJobsUncached`, at line 1916. Here, for the
first time, is what a request to JobTread looks like:

```ts
const r = await pave(cfg, {
  organization: {
    $: { id: cfg.orgId },
    id: {},
    jobs: {
      $: args,
      nextPage: {},
      nodes: {
        id: {},
        name: {},
        number: {},
        closedOn: {},
        location: { account: { name: {} }, formattedAddress: {} },
      },
    },
  },
});
```

JobTread reads a special data language, named **Pave**. A message in this
language is named a **query**. You do not need to write a query yet. You can
read a query now, because the words in this language are plain:

> "Get the organization with this ID. From this organization, get the list
> of jobs. For each job, give the ID, the name, the number, and the
> `closedOn` date. For each job, also get the location. From the location,
> give the account name and the formatted address."

An empty pair of braces, `{}`, has 1 meaning: give this value only, with no
data nested inside it. The symbol `$` has 1 meaning: here are the arguments
for this part of the query. This is almost the whole grammar of the Pave
language. Segment 3 explains this language in full.

Look at the loop around this query:
`for (let page = 0; page < 50; page++)`. JobTread sends back a maximum of
**100 records in 1 answer**. JobTread also sends a `nextPage` token. A token
of this kind works like a bookmark. The code sends this token back in the
next query. The code repeats this action until JobTread sends no more tokens.
Ascent has more than 100 jobs, so this loop truly runs more than 1 time. The
loop stops after 50 rounds, as a safety limit.

### Hop 5 — The actual network call

The function `pave()`, in `src/lib/jobtread.ts:39`, is the only function in
the whole code that sends data to the address
`https://api.jobtread.com/pave` (`src/lib/jobtread.ts:15`). Here is the first
line of this function:

```ts
const body = JSON.stringify({ query: { $: { grantKey: cfg.grantKey }, ...query } });
```

**This line adds the grant key to the query.** Every other file in the app
writes a query without the grant key. The function `pave()` adds the grant
key at the last step, on the server. Then this function sends the query to
JobTread. This design has 1 result: the code has only 1 place to check for
the grant key. This design makes the security rule easy to trust.

The function `pave()` also controls repeat attempts. Read the comments in the
file for the full detail. Here is the plain rule: **the app repeats a failed
read up to 3 times. The app never repeats a failed write.** A read does not
change stored data. A write does change stored data, for example a request to
create a bill. If a write times out, and the app repeats the write, the
result can be 2 bills instead of 1.

### The full trip, in 1 view

```
  /jobs on your phone
    │
    ├─ src/app/jobs/page.tsx ................. server, 11 lines, hands off
    ├─ src/app/jobs/JobsBrowser.tsx .......... "use client" — runs on the phone
    │     └─ fetch("/api/jobs/browser") ...... asks its OWN server
    │              │
    │              ▼            ┄┄┄┄ the security line ┄┄┄┄
    ├─ src/app/api/jobs/browser/route.ts ..... server, has the secrets, 5-min cache
    │     └─ getJobs() ....................... src/lib/jobtread.ts:1911, 5-min cache
    │           └─ _getJobsUncached() ........ composes the Pave query, pages by 100
    │                 └─ pave() .............. src/lib/jobtread.ts:39 — attaches the key
    │                       └─► api.jobtread.com/pave
    ▼
  numbers on the screen
```

This trip uses **6 files**. This trip uses **2 caches**. The grant key appears
in **1 place** only. Every screen in the app follows a similar trip.

### One fact that is not part of this trip

Notice what did not happen. The phone did not send a grant key. The phone did
not know the JobTread address. Even a broken copy of the app on the phone
could not send a query to JobTread. Segment 4 explains how the app protects
this rule.

---

## 4. Check yourself

Try each question before you read the answer.

1. A coworker says this: "The app's copy of the job list is old. Please
   re-import the list." What is wrong with this request?
2. You open the Jobs screen. You open the Jobs screen again, 90 seconds
   later. How many times did the app ask JobTread for the job list? Why?
3. Look at these 3 files: `src/app/jobs/page.tsx`,
   `src/app/jobs/JobsBrowser.tsx`, and `src/app/api/jobs/browser/route.ts`.
   Which file can safely hold the JobTread grant key? Which files cannot?
4. What URL comes from the file `src/app/time-off/page.tsx`?
5. Why does the app repeat a failed read to JobTread, but never repeat a
   failed write?
6. An RFI stays in the companion database. An approved PTO day goes into
   JobTread. Use the rule from Part 2. Explain the reason for each choice.

---

## 5. What this unlocks

After this segment, you can do these 4 things:

- **Find the code for any screen, from its URL alone.** The URL `/unbilled`
  points to the folder `src/app/unbilled/`. This 1 skill makes the other 11
  segments easier to follow.
- **Trace a slow request in the correct order.** A person may say: "The page
  is slow." You now know 5 places to check: the phone's request, the route,
  the cache, the JobTread query, and JobTread itself.
- **Ask for a change in exact, useful terms.** Good example: "Add the job's
  Phase to the Jobs browser." You know that the app already reads this
  value, in the file `src/app/api/jobs/browser/route.ts`.
- **Find a dangerous proposal.** Some proposals are always wrong. A proposal
  is wrong if it lets the browser send a query to JobTread directly. A
  proposal is wrong if it stores a grant key where a phone can read it. You
  do not need more information to reject a proposal of this kind.

**Next up — Segment 2: Sign-In and Roles.** This segment explains how the app
decides who can sign in. This segment explains the 4 roles. This segment
explains 1 more fact: for a Field employee, the Financials screens are not
just hidden. The server blocks these screens before the page runs.

---

## Answers

1. **The app has no copy of the job list to re-import.** The app holds no job
   list of its own. The list can look old for 1 of 2 reasons. Reason one: a
   cache holds an old answer, for up to 5 minutes. Reason two: JobTread
   itself has old data. The correct fix is to wait, or to clear the cache.
   The correct fix is never to "re-import" data.

2. **1 time.** Two caches store the answer: the route cache, for 300
   seconds, and the in-memory cache (`cachedRef`), for 5 minutes. At 90
   seconds, both caches still hold the answer. JobTread is not asked again.
   For this same reason, a new job in JobTread can take a few minutes to
   appear in the app. This is a known, accepted result of the design.

3. Only **`src/app/api/jobs/browser/route.ts`** can safely hold the grant
   key. This file does hold the grant key, through the function
   `getPaveConfig()`. The file `JobsBrowser.tsx` has the mark `"use client"`.
   This file runs on the phone. A grant key in this file would become
   visible to the phone. The file `page.tsx` runs on the server. But, by
   design rule, this file never holds a grant key. This file has 1 job: to
   send control to another component. The app keeps all grant-key use
   inside the folder `src/app/api/`. This rule makes the security design
   easy to check.

4. **`/time-off`**. The folder path under `src/app/` becomes the URL.

5. A read does not change stored data. If a read fails, the read changed
   nothing. A repeat of the read is safe. A write does change stored data,
   for example a new bill. If a write times out, the app cannot know the
   true result. The write may have reached JobTread before the connection
   failed. A repeat of the write can create a second bill, a second line, or
   a second payment. `pave()` checks the query for this reason, before it
   decides whether to repeat a failed request.

6. **RFI:** JobTread has no object for an RFI. The Sheets system also has no
   place for an RFI. For this reason, the companion database is the only
   correct home for RFI data.
   **PTO:** JobTread has no object for a PTO request, and no object for a PTO
   approval step. For this reason, the companion database stores the request
   and the approval step. But an approved PTO day becomes hours worked on a
   job. JobTread does have an object for this: the time entry. For this
   reason, the app writes the approved PTO day into JobTread, as a time
   entry. All other labor-cost data already lives in this same place.
