---
name: invoice-review
description: Review a month's CLIENT invoices for Ascent — cross-check the JobTread customerInvoice documents against the vendor bills behind them, the backup PDFs filed in the Drive invoicing tree, and the office mailbox (did every vendor invoice that arrived get captured, and did everything captured reach an invoice), then report what needs fixing. Use when asked to review, check, audit, or sanity-check a billing month's client invoices or invoicing, or when the owner says "review July's invoices" / "check the invoices before I send them".
---

# Monthly client-invoice review

Check that what a client was billed for a month is right, complete, and backed by
paperwork — **before** the invoices go out. Three questions, in the order they
matter:

1. Did every vendor invoice that arrived get **captured** into JobTread?
2. Did everything captured reach a **client invoice**?
3. Is each invoice itself **right** — the math, the backup, the period?

Question 1 is the one nothing else can answer. An invoice that was never filed is
invisible to every other check: the math foots, the backup matches, the totals
reconcile, and the charge is simply absent. Only the mailbox still has it.

**No Anthropic API key is needed for any of this.** The checks are ordinary code.
The only thing a key would buy is the app writing its own summary paragraph; you
are the summary.

Every number comes from the checks in `src/lib/invoiceReview/checks/`, which are
deterministic and unit-tested. Your job is to run them, read what they found,
chase the ones they can't settle on their own, and tell the owner what to do.
**Do not do the arithmetic yourself** — if you find yourself adding up line
items in your head, you have gone off the rails.

## Vocabulary — get this right first

- **Client invoice** = a JobTread `customerInvoice` document. What Ascent bills a
  customer. This is what is being reviewed.
- **Vendor bill** = a JobTread `vendorBill` document. What a supplier bills
  Ascent. These are the *evidence*, not the subject.
- **Backup** = the PDF of a vendor bill, filed in the Drive invoicing tree. One
  per vendor bill, named by the pipeline's own convention.
- **Captured** = a vendor invoice that arrived by email and became a JobTread
  vendor bill. Uncaptured means it is nowhere in the system.
- **The billing window** = the 10th-to-10th arrival window. Mail that arrived
  from the 11th of the billing month through the 10th of the next month belongs
  to that billing month (`deriveBillingPeriod`, Config.js). The mail sweep uses
  exactly this window.
- **Office and Shop** = Ascent's own overhead jobs. Cost lands on them like any
  job and is **never** billed to a customer, so every "this should have been
  invoiced" check skips them. Never tell the owner Office or Shop was
  under-billed.
- **Billing month** ≠ folder month. Costs for a billing month are filed in the
  month **after** it: July billing lives in
  `/2026 Invoicing/08 August 26 (July Billing)/<Customer>/<Job>/`.

## Step 1 — run the checks

Ask the deployed Assistant for the month:

```
GET /api/invoice-review?ym=YYYY-MM&narrate=0
```

`ym` is the **billing** month. `narrate=0` skips the app's own Claude paragraph,
because you are going to write a better one with the context of this
conversation. Use the production URL, or `http://localhost:3000` against a
`npm run dev` with `.env.local` in place.

Other switches:

- `&format=brief` returns the whole review as a markdown briefing instead of
  JSON. Use it if you only want to read and relay; use JSON when you intend to
  chase individual findings, because JSON carries the `key` you need to record a
  ruling.
- `&email=0` skips the mailbox sweep, which is the slow half (a month of All Mail
  is a few hundred threads). Only for a quick pass — the capture findings then
  report nothing at all rather than passing.
- `&stored=1` hands back the most recently FILED run instead of sweeping
  everything again — instant, and identical to what that run showed, because it
  IS that run. **There is currently no automatic nightly run** — a Vercel Cron
  entry for it briefly existed and was reverted (it pushed the project over
  Vercel Hobby's 2-cron cap and took the Daily Digest's schedule down with it;
  see the incident note in `INVOICE_ACCURACY_PLAN.md`) — so a stored run is only
  as current as the last time someone opened the page or it was triggered
  manually. Check `storedAt` before assuming it's fresh. Use it when you want to
  read the month rather than re-check it; use a plain call when the owner has
  just fixed something and wants it re-checked.
  (`&stored=only` answers `{ "stored": null }` rather than falling through to a
  live run, which is what the page opens with.)
- `&history=1` lists the month's past runs — when it was last checked, by whom,
  and how the counts have moved. Useful for "is this new, or has it been there
  since March".

A payload carrying `storedAt` came out of the history rather than being computed
just now. Say so if you relay it, and say when.

Each finding may carry `history`: `isNew` means no earlier run saw it,
`firstSeenAt`/`runsSeen` say how long it has been standing. **Lead with what is
new**, and say plainly when something has been sitting unfixed for months — that
is usually the more useful fact. A finding with no `history` at all means the
review has no memory of it yet (a month checked for the first time); that is not
the same as new, so don't call it new.

If the owner is in this repo without a running app, the same thing is reachable
in code: `runInvoiceReview(getPaveConfig(), year, month, { narrate: false })`
from `src/lib/invoiceReview/run.ts`.

You get back `{ evidence, findings, summary }`. Findings are already sorted
worst-first, and any the office has previously ruled on carry `suppressedBy`.

## Step 2 — read `evidence.warnings` FIRST

If it is non-empty, part of the month could not be gathered — a Drive call
failed, a job's reconciliation errored. **Say so at the top of your report.** A
partial review that reads as a clean one is the single worst outcome here; it is
worse than no review, because the owner will send the invoices believing they
were checked.

## Step 3 — work the findings

Take them in the order they come. For each one that is `severity: "error"`:

- **`backup-missing`** — a bill was billed to the client with no PDF on file.
  Before reporting it, check whether the PDF is filed under the wrong job: search
  Drive for the amount (`_civParseBackupName` puts it in the filename, so a Drive
  search for `"$1,234.56"` finds it). Say where it actually is if you find it.
- **`scope-duplicate-bill`** — the same vendor bill is on two live client
  invoices. Open both in JobTread and confirm one isn't a credit. This is the
  finding most likely to cost real money and real trust.
- **`email-bill-missed`** — a vendor invoice arrived in the window and JobTread
  has no matching bill. **This is the most important finding in the review**, and
  the only one no other check could have caught. Open the email, confirm it is a
  real invoice (a statement or a portal notice for an invoice already filed is
  not), then check whether the bill exists under a different vendor spelling
  before reporting it. If the email carries a "Processed" or "Added to JT" label
  and the bill still isn't there, say so — something believed it was filed.
- **`bill-uninvoiced`** — a captured bill on a job that WAS invoiced, left off
  the invoice. Name the vendor and the amount; it is usually a one-minute fix.
- **`job-not-invoiced`** — a job's whole month was captured and never billed.
  Confirm against the tracking sheet whether that was deliberate before alarming
  anyone; if it is a standing arrangement, record a `job-kind` ruling.
- **`scope-uninvoiced`** — uninvoiced LABOR (bills have their own per-bill
  finding above). Confirm against the tracking sheet whether it was held back.
- **`math-*`** — the invoice does not foot. Quote the arithmetic from `detail`
  verbatim; it already shows both figures and the difference.
- **`markup-missing` / `billed-below-cost`** — a line reached the invoice at
  cost, or under it. Ascent bills COST-PLUS, so the markup is the revenue and
  this is money that will never be recovered once the invoice goes out. Before
  reporting, check whether the line is a deliberate pass-through (a permit, a
  fee); if it is, the fix is adding its cost code to `passThroughCodes` in
  `settings.ts`, NOT a ruling every month forever — say so.
- **`markup-rate-drift`** — a customer's blended markup this month is off what
  they are usually billed. Ascent charges different rates to different
  customers, so this is measured against that customer's own history and nothing
  else. It reasons from a pattern: treat it as a reason to look at the month,
  not as proof. A month weighted toward work at a different rate does this
  innocently, so ask before alarming anyone.

For `warning` findings, summarize rather than investigate each one, unless the
owner asks. One needs care:

- **`email-unknown-sender`** — invoice-looking mail from a sender matching no
  JobTread vendor account. There was no bill list to search, so nothing was
  proven. Usually a new vendor; sometimes not an invoice at all. Never report it
  as a missed bill.

## Step 3a — what the mailbox check does NOT prove

The sweep reads **All Mail** for the billing window, not the inbox, so an
archived or labelled invoice is still seen. But:

- **A miss is a strong signal, not a verdict.** Matching is by vendor + date
  window + amount, deliberately lenient. Confirm before you accuse.
- **`checked: false` on an email means nothing was searched** — that vendor's
  bills could not be read. Those are never flagged, and neither should you.
- **A truncated sweep proves nothing about what it did not see.** If
  `evidence.mailTruncated` is true, say the capture check is partial for the
  month.
- **If `evidence.emailChecked` is false the mailbox was not searched at all.**
  Say the capture check was skipped. Do not report it as clean.

## Step 4 — report

Lead with the number of things to fix and the dollars in question. Then the
errors, one line each: what, which customer, how much, what to do. Then a single
line for the warnings. Link to `/invoice-review` so the owner can work the same
list on their phone and record rulings.

Keep it short enough to read on a phone. The owner is a knowledgeable novice —
concrete and plain, no dev jargon.

If the owner would rather work the list themselves in a Claude chat, tell them
about the **Copy for Claude** button on `/invoice-review`: it puts this same
briefing on the clipboard (or straight into the share sheet on a phone) to paste
into the Claude app. That path needs no API key either.

## Checking ONE job before its invoice goes out

If the owner is about to invoice a job and wants it checked first, that is the
pre-send gate, not the monthly review:

```
GET /api/invoice-review/job?jobId=<job id>&ym=YYYY-MM
```

Same check files, one job, on demand. It is also a card on
`/trackingsheet?jobId=…` ("Before you send").

**It deliberately does not answer three questions**, and the response says so in
`notChecked`: whether every vendor invoice that arrived was captured, whether a
regular vendor billed nothing, and whether the customer's markup is off their
usual rate. All three need the whole month — run against one job they produce
confident false findings, which is why they are excluded rather than merely
skipped. **Relay that caveat whenever you relay a clean result**, or "nothing to
fix" reads as "the month is fine".

Findings carry the same keys as the monthly review, so a ruling recorded from
either place suppresses in both.

## Step 3b — let the app do the chasing

Most of Step 3's legwork is now a button. `POST /api/invoice-review/investigate`
with `{ "ym": "YYYY-MM" }` runs Claude over the month's findings with read-only
tools and returns a verdict on each:

- **`confirmed`** — checked, and it looks real.
- **`probably-fine`** — a benign explanation was found, and `why` states it.
- **`needs-human`** — cannot be settled from the evidence; `why` says what is missing.

It does exactly what Step 3 asks you to do by hand: searches every job's filed
backup for a missing amount, checks a vendor's other spellings, opens a suspected
double-bill to see whether one half is a credit. Verdicts are stored, so a month
already investigated comes back with them attached to each finding
(`finding.disposition`).

**Run it before working the list yourself** on a month with more than a handful
of findings — it is far quicker than repeating the searches, and it tells you
which ones it could NOT settle.

Optional `"model"` in the body picks which model runs it, from the allowlist in
`investigateModels.ts` — Sonnet by default, Opus for a messy month. Anything
else falls back to the default rather than erroring. The response carries
`usage` with cache counters; `cacheRead` staying at zero across a multi-step run
means the prefix cache broke and the run cost more than it should have.

**A verdict is not a ruling.** `probably-fine` leaves the finding on the list at
full severity. Relay it as "Claude found X, worth confirming", never as "this one
is fine". Only the owner settles a finding, and only through a ruling.

## Step 4a — say what it missed

If the owner tells you about a billing mistake **this review didn't catch**,
record it. This is the single most valuable thing you can do here — a ruling
teaches the review to say less, and only a miss teaches it to look somewhere new.

```
POST /api/invoice-review/misses
{ "ym": "YYYY-MM", "description": "<their words>", "howCaught": "<how it surfaced>",
  "jobName": "...", "customerName": "...", "amount": 0 }
```

Only `description` is required — file a thin one rather than none. `howCaught`
is the field that most often says where a new check should look, so ask for it
if it's natural, and don't interrogate them if it isn't.

To ask what checks the accumulated log calls for (admin only, uses the frontier
model, takes a while): `POST /api/invoice-review/learn`. It answers with
proposals — a rule, what would make it fire wrongly, and whether new evidence
would be needed. **They are proposals.** Implementing one is a code change a
person decides on; nothing about it is automatic.

## Step 5 — the memory

When the owner overrules a finding ("that's fine, that client's allowance draws
never have vendor backup"), **record it** so it never comes back:

```
POST /api/invoice-review
{ "key": "<finding.key>", "kind": "<finding.kind>", "jobId": "<finding.jobId>",
  "customerName": "<finding.customerName>",
  "scope": "finding" | "job-kind" | "customer-kind", "reason": "<their words>" }
```

- `scope: "finding"` — this one thing. The default; use it unless told otherwise.
- `scope: "job-kind"` — every finding of this kind on this job, forever. Only for
  a standing arrangement, never to quiet one awkward month.
- `scope: "customer-kind"` — that kind for this customer on every job, including
  jobs they haven't started. Only when the arrangement is a property of the
  CLIENT ("their allowance draws never have vendor backup"), not of one job.
  `customerName` is required for this scope.

Wider is not better. A ruling that reaches past what the owner meant is how a
real finding gets silenced years later by a note nobody remembers writing — when
in doubt, take the narrower scope and record another one next month.

Separately, if the owner says how they want the month READ to them rather than
what to stop finding ("always lead with anything on Ferron"), that is a standing
instruction, not a ruling — it shapes the summary and hides nothing:

```
POST /api/invoice-review/instructions   { "text": "<their words>" }
```

Always record the owner's **actual reason**, not your paraphrase. Next year it is
the only thing that will explain the silence. To lift one:
`POST { "key": "…", "lift": true }`.

## What you must not do

- **Never change anything.** Not an invoice, not a bill, not a Drive file, not a
  status. The review's whole value is that it cannot edit what it reviews. The
  only write in the feature is the ruling note above.
- **Never recompute a total to make it reconcile.** Report the disagreement and
  let a human decide which side is wrong.
- **Never suppress a finding on your own judgement.** Only the owner rules.
- **Never say the month is clean** unless `findings` is empty *and*
  `evidence.warnings` is empty *and* `evidence.emailChecked` is true *and*
  `evidence.mailTruncated` is false. If the mailbox leg was skipped or truncated,
  the month is "clean on everything checked", and you must say which part wasn't.
  A check that FAILED also lands in `evidence.warnings` — a check that stopped
  working and a check that found nothing must never read the same.
- **Never let a verdict stand in for a ruling.** A `probably-fine` disposition is
  Claude's reading, stored for triage. It does not silence anything and must not
  be reported as settled. If the owner agrees with it, record a real ruling.
- **Never treat `vendor-silent` as proof of anything.** It reasons from a
  pattern, not from a document: a vendor can simply have had a quiet month. It
  is a reason to look at an account, and the wording says so. Relay it that way.
- **Never disable a check to quiet a finding.** A ruling says "we looked at this
  one and it's fine", with a reason and a name against it. `enabled: false` in
  `settings.ts` makes a whole class of problem stop being looked for, org-wide,
  for everyone, silently. Record a ruling instead.
- **Never report Office or Shop as under-billed.** They are Ascent's own overhead
  and are never invoiced. The checks already skip them; don't reintroduce them in
  your prose.
- **Never read a message body.** The Apps Script side returns headers only, by
  design. If you need what a thread says, open it in Gmail — don't try to get
  the body through the review.

## Where the parts live

| Piece | File |
| --- | --- |
| The checks (pure, tested) — one file each | `src/lib/invoiceReview/checks/` |
| Cost codes billed at cost on purpose | `passThroughCodes` in `src/lib/invoiceReview/settings.ts` |
| Every threshold and which checks run | `src/lib/invoiceReview/settings.ts` |
| The check list + the runner | `src/lib/invoiceReview/registry.ts` |
| Evidence gathering (JobTread + Drive + Gmail) | `src/lib/invoiceReview/evidence.ts` |
| The paste-into-Claude briefing | `src/lib/invoiceReview/brief.ts` |
| Rulings / the memory | `src/lib/invoiceReview/rulings.ts` |
| Run history | `src/lib/invoiceReview/runs.ts` |
| Finding ages + per-check accuracy | `src/lib/invoiceReview/lifecycle.ts` |
| Learned baselines (vendor cadence) | `src/lib/invoiceReview/norms.ts` |
| The miss log — what it failed to catch | `src/lib/invoiceReview/misses.ts` |
| Claude proposing new checks from misses | `src/lib/invoiceReview/learn.ts` |
| Claude investigating findings (the tool loop) | `src/lib/invoiceReview/investigate.ts` |
| What Claude is allowed to look at | `src/lib/invoiceReview/investigateTools.ts` |
| Stored verdicts | `src/lib/invoiceReview/dispositions.ts` |
| Standing instructions for the summary | `src/lib/invoiceReview/instructions.ts` |
| The route | `src/app/api/invoice-review/route.ts` |
| The filing run (manual/admin only — no cron) | `src/app/api/invoice-review/run/route.ts` |
| The page | `src/app/invoice-review/InvoiceReview.tsx` |
| The Drive + Gmail reads (other repo) | `ascent-appscript/ClientInvoiceReview.js` |
| Where this is all going | `INVOICE_ACCURACY_PLAN.md` |

**Adding a check** is a new file in `checks/`, a config block in `settings.ts`,
and one line in `registry.ts`. Nothing else needs touching.

## Known limitation, worth saying out loud

The Drive folder is looked up by the JobTread **customer name**. A job routed to
a different folder by `FOLDER_KEY_OVERRIDES` in the Apps Script config (today:
`PROJ_024` → `Electrical`) will report `backup-folder-missing` with the path it
looked in. That is a false positive, and the fix is a `job-kind` ruling on that
job — not a change to the checks.
