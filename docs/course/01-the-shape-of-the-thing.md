# Segment 1 — The shape of the thing

**Unit A · Orientation · ~40 minutes**

← [Course profile](README.md) · Next: Segment 2 — The door

---

## 1. The question

> When you tap something on your phone and a number appears on the screen —
> what actually happened, and where did that number come from?

By the end of this segment you'll be able to answer that for any screen in the
app, and name the specific files involved.

---

## 2. The idea

### The app is a lens, not a filing cabinet

The most important thing to understand about the Ascent Assistant is what it
*doesn't* do: **it doesn't store your business data.**

There's no "Ascent Assistant database of bills." There's no copy of your jobs.
When the Unbilled screen shows you $47,320 of uninvoiced cost on a job, that
number did not come out of storage. It was fetched from JobTread seconds ago,
and it will be fetched again the next time someone opens the screen.

That's a deliberate design choice with a real consequence: **the app can never
be out of sync with JobTread**, because it has nothing of its own to fall out of
sync. It also means the app is only as fast as JobTread is — which is why
caching shows up so much in the code (more on that below).

### The three back ends

"The app" is really a front end sitting in front of three different places where
data lives. Almost every screen is a combination of these:

| Back end | What lives there | How the app reaches it | Who owns it |
|---|---|---|---|
| **JobTread** (the "Pave" API) | Jobs, budgets, cost items, vendor bills, customer invoices, payments, time entries, contacts | HTTPS request to `api.jobtread.com/pave` | JobTread. **Source of truth for anything financial.** |
| **Google Sheets & Drive** | Employee roster, tool inventory, mileage log, safety sign-ins, requisitions, the Expenditure archive, PDFs | HTTPS request to the Apps Script web app in the sibling repo `ascent-appscript` | Ascent's Google Workspace |
| **The companion database** | The leftovers: RFIs, feature requests, the sign-in allowlist, leave balances, lead follow-ups, editable page text — 18 tables | Direct database queries (Drizzle over libSQL) | This app |

The rule that decides which one a piece of data belongs in is simple, and it's
worth internalizing now because it explains a *lot* of file placement:

> **JobTread first. Sheets if it was already there. The companion database only
> if neither of the other two has a home for it.**

That's why leave *requests* live in the companion database (JobTread has no
concept of a PTO request) but approved leave gets *posted into JobTread* as a
time entry (JobTread does have a concept of hours against a job).

### The fourth thing: the app's own server

Here's the piece that's easy to miss, and it's the key to everything in
Segment 2 and Segment 4.

Your phone does **not** talk to JobTread. It can't — the JobTread key is a
password to your entire company's financial data, and anything sent to a browser
can be read by whoever holds the phone.

Instead there are two halves:

```
  YOUR PHONE                    VERCEL (the app's server)              THE WORLD
  ──────────                    ─────────────────────────              ─────────
  the screen        ──asks──►   a server route                ──asks──► JobTread
  (a "client                    (the only place the                     Sheets/Drive
   component")                   secret key is used)                    the database
                    ◄─plain──                              ◄─data────
                      numbers
```

The left half is public — anyone with the phone can see it. The right half is
private — it runs on Vercel's servers with the secrets. Every single piece of
data on every screen crosses that line exactly once.

Keep that diagram in your head. Nearly every architectural rule in this codebase
is a consequence of it.

---

## 3. The evidence

Let's follow one real screen all the way through. We'll use **the Jobs cost
browser** (`/jobs`) — the screen that shows a job's budget vs. actual laid out
like the office Tracking Sheet.

### Hop 1 — The page (11 lines)

`src/app/jobs/page.tsx` — the entire file:

```tsx
import { JobsBrowser } from "./JobsBrowser";

export default function JobsPage() {
  return <JobsBrowser />;
}
```

That's it. **This is the pattern for every screen in the app**: a tiny
`page.tsx` that runs on the *server*, whose only job is to hand off to a bigger
component that runs in the *browser*.

Why the split? Because the server half is where secrets would be safe, and the
browser half is where buttons and taps live. Splitting them makes the boundary
visible in the file structure itself. On some screens the `page.tsx` passes
something down (a non-secret bit of context like the JobTread org id); here it
has nothing to pass, and the comment in the file says so explicitly.

**Naming convention worth learning now:** in this framework, a folder under
`src/app/` *is* a URL. `src/app/jobs/page.tsx` → `/jobs`. `src/app/time-off/page.tsx`
→ `/time-off`. `src/app/bill/[docId]/page.tsx` → `/bill/22ABC123` (the square
brackets mean "anything goes here"). That's the whole routing rule — 39 folders,
39 screens.

### Hop 2 — The browser asks the app's own server

`src/app/jobs/JobsBrowser.tsx:1` starts with:

```tsx
"use client";
```

Those two words are the border marker. Everything in a file that begins with
`"use client"` runs **on the phone**. No secrets may appear here, ever.

At `src/app/jobs/JobsBrowser.tsx:293`, when the screen loads:

```tsx
fetch("/api/jobs/browser")
```

Read that carefully — it's asking for `/api/jobs/browser`, **a route on the
Ascent Assistant itself**, not on JobTread. The phone has no idea JobTread
exists. It asks its own app a question and gets an answer.

Later, at line 341, when you pick a specific job:

```tsx
fetch(`/api/jobs/cost-detail?jobId=${encodeURIComponent(id)}`)
```

Same idea — one more question to the app's own server, this time with a job id
attached.

### Hop 3 — The server route (the secret side)

`src/app/api/jobs/browser/route.ts` — 41 lines, and the whole file is worth
reading. The core of it:

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

In English, line by line:

- `getPaveConfig()` — reach into the server's environment variables and pull out
  the JobTread grant key and org id. This function lives in `src/lib/config.ts:4`
  and its comment says *"Never import this into client components"* — i.e. never
  let this run on a phone.
- `getJobs(cfg, true)` and `getJobPhaseMap(cfg)` — two questions to JobTread,
  asked at the same time (`Promise.all` = "do both, wait for both").
- `jobs.map(...)` — stitch the two answers together: attach each job's Phase to
  the job.
- `revalidate: 300` — **cache this answer for 300 seconds (5 minutes).** The next
  person to open the Jobs screen inside that window gets the stored answer
  instantly, without JobTread being asked again.

The file's own comment explains why it exists at all, and it's a good window
into how this codebase thinks:

> *"Doing the join here instead of in the browser is the load-time fix: the
> client used to page `organization.jobs` (up to 10 gateway round trips) and then
> page the Status custom field (up to 20 more) on every single page load. Now it
> is one fetch."*

Thirty round trips from a phone on job-site cell service became one. That's the
kind of decision that's invisible on screen and enormous in practice.

### Hop 4 — Asking JobTread

`getJobs` is in the big shared JobTread module, `src/lib/jobtread.ts:1911`:

```ts
export function getJobs(cfg: PaveConfig, includeClosed = false): Promise<JobRef[]> {
  return cachedRef(`jobs:${cfg.orgId}:${includeClosed}`, 5 * 60_000, () =>
    _getJobsUncached(cfg, includeClosed),
  );
}
```

A *second* cache — this one inside the app's own memory, also 5 minutes
(`5 * 60_000` milliseconds). Job lists are read on nearly every office screen, so
they're worth remembering twice.

The real work is `_getJobsUncached` at line 1916, and this is the first time
you'll see what a question to JobTread actually looks like:

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

This is JobTread's query language ("Pave"). You don't need to write it yet, but
you should be able to *read* it, because it's remarkably literal:

> "From the **organization** with this id, get its **jobs**. For each one, give me
> the **id**, **name**, **number**, **closedOn** date, and from its **location**,
> the **account's name** and the **formatted address**."

The empty braces `{}` mean "just the value, nothing nested inside it." The `$`
key means "arguments" — the parameters for that part of the request. That's
essentially the whole grammar, and Segment 3 covers it properly.

Note the loop around it: `for (let page = 0; page < 50; page++)`. JobTread hands
back at most **100 records at a time**, plus a `nextPage` token — a bookmark. The
loop keeps asking, feeding the bookmark back, until JobTread stops handing out
bookmarks. Ascent has more than 100 jobs, so this genuinely loops. It's capped at
50 pages (5,000 jobs) as a runaway guard.

### Hop 5 — The actual network call

Finally, `pave()` at `src/lib/jobtread.ts:39` is the one function in the entire
codebase that talks to `https://api.jobtread.com/pave` (`src/lib/jobtread.ts:15`).
Its first line:

```ts
const body = JSON.stringify({ query: { $: { grantKey: cfg.grantKey }, ...query } });
```

**This is the moment the key is attached.** Every other file in the app composes
questions *without* the key; `pave()` stamps it on at the last second, on the
server, and sends it. That single choke point is why the security promise is
credible — there's exactly one place to check.

`pave()` also handles what happens when things go wrong, and the comments are
worth reading in full. The short version: **a read that fails is retried up to
three times; a write is never retried.** Because if you re-send "create a bill"
after a timeout, you might create two.

### The whole trip, at a glance

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

**Six files. Two caches. One place the key appears.** Every screen in this app is
a variation on that trip.

### One thing that is *not* on this trip

Notice what never happened: the phone never sent a JobTread key, never knew a
JobTread URL, and couldn't have asked JobTread anything even if the code were
tampered with. That property is what Segment 4 is entirely about protecting.

---

## 4. Check yourself

Try these before looking at the answers below.

1. A colleague says "the app's copy of the job list is stale — can you re-import
   it?" What's wrong with the question?
2. You open the Jobs screen, then open it again 90 seconds later. How many times
   did JobTread get asked for the job list? Why?
3. Which of these files could safely contain the JobTread grant key, and which
   could not?
   - `src/app/jobs/page.tsx`
   - `src/app/jobs/JobsBrowser.tsx`
   - `src/app/api/jobs/browser/route.ts`
4. What URL does the file `src/app/time-off/page.tsx` serve?
5. Why is a failed *read* to JobTread retried automatically, but a failed *write*
   is not?
6. An RFI lives in the companion database, but an approved PTO day gets written
   into JobTread. Using the rule from section 2, explain why each one lives where
   it does.

---

## 5. What this unlocks

You can now:

- **Locate any screen's code from its URL.** `/unbilled` → `src/app/unbilled/`.
  This alone makes the other 11 segments navigable.
- **Read a request the right way round.** When someone says "the page is slow,"
  you now have five specific places to ask about: the phone's request, the
  route, the cache, the JobTread query, and JobTread itself.
- **Ask for changes precisely.** "The Jobs browser should also show the job's
  Phase" is answerable — you know it's already fetched, in
  `src/app/api/jobs/browser/route.ts`.
- **Spot a dangerous suggestion.** If any proposal involves the browser talking
  to JobTread directly, or storing a JobTread key anywhere a phone can reach,
  it's wrong. No exceptions, and you don't need more context to say so.

**Next up — Segment 2: The door.** How the app decides who gets in, what four
roles mean, and why a Field employee doesn't just have the Financials screens
*hidden* — they're locked before the page ever runs.

---

## Answers

1. **There is no copy to re-import.** The app holds no job list of its own. If
   the list looks stale it's either a cache holding an answer for up to 5
   minutes, or JobTread itself is behind — and the fix is to wait or clear the
   cache, never to "re-import."

2. **Once.** Both caches (Next's route cache at 300 seconds, and the in-memory
   `cachedRef` at 5 minutes) still hold the answer at 90 seconds, so JobTread
   isn't asked again. This is also why a job created in JobTread can take a few
   minutes to appear in the app — a known, deliberate trade.

3. Only **`src/app/api/jobs/browser/route.ts`** could — and it does, indirectly,
   via `getPaveConfig()`. `JobsBrowser.tsx` is marked `"use client"`, so it runs
   on the phone and the key would be exposed. `page.tsx` technically runs on the
   server, but by convention nothing in a `page.tsx` uses the key — it exists to
   hand off, so that the one thing it hands to a client component is never a
   secret. Keeping key use confined to `src/app/api/**` is what makes the rule
   auditable.

4. **`/time-off`.** The folder path under `src/app/` is the URL.

5. Because a read that never completed changed nothing — asking again is free and
   safe. A write that timed out is ambiguous: it may have landed in JobTread
   before the connection dropped. Re-sending it risks a duplicate bill, line, or
   payment. `pave()` makes this decision automatically by inspecting whether the
   query contains a mutation (`src/lib/jobtread.ts:39` onward).

6. **RFIs:** JobTread has no RFI object at all, and RFIs aren't part of the
   pre-existing Sheets world, so the companion database is the only home left.
   **PTO:** the *request and approval workflow* has no JobTread equivalent, so
   that part lives in the companion database — but once approved, the result is
   simply *hours against a job*, which is exactly what a JobTread time entry is.
   So it posts there, where the rest of the company's labor cost already lives,
   and shows up in job costing like any other hours.
