---
name: invoice-review
description: Review a month's CLIENT invoices for Ascent — cross-check the JobTread customerInvoice documents against the vendor bills behind them, the backup PDFs filed in the Drive invoicing tree, and the office mailbox, then report what needs fixing. Use when asked to review, check, audit, or sanity-check a billing month's client invoices or invoicing, or when the owner says "review July's invoices" / "check the invoices before I send them".
---

# Monthly client-invoice review

Check that what a client was billed for a month is right, complete, backed by
paperwork, and actually sent — **before** the invoices go out.

**No Anthropic API key is needed for any of this.** The checks are ordinary code.
The only thing a key would buy is the app writing its own summary paragraph; you
are the summary.

Every number comes from `src/lib/invoiceReview/checks.ts`, which is deterministic
and unit-tested. Your job is to run it, read what it found, chase the ones it
can't settle on its own, and tell the owner what to do. **Do not do the
arithmetic yourself** — if you find yourself adding up line items in your head,
you have gone off the rails.

## Vocabulary — get this right first

- **Client invoice** = a JobTread `customerInvoice` document. What Ascent bills a
  customer. This is what is being reviewed.
- **Vendor bill** = a JobTread `vendorBill` document. What a supplier bills
  Ascent. These are the *evidence*, not the subject.
- **Backup** = the PDF of a vendor bill, filed in the Drive invoicing tree. One
  per vendor bill, named by the pipeline's own convention.
- **Trace** = a thread in the office mailbox that looks like this invoice going
  out. Its absence is weak evidence, not proof — see the email step.
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

Two other switches:

- `&format=brief` returns the whole review as a markdown briefing instead of
  JSON. Use it if you only want to read and relay; use JSON when you intend to
  chase individual findings, because JSON carries the `key` you need to record a
  ruling.
- `&email=0` skips the mailbox sweep, which is the slow half (up to two Gmail
  searches per invoice). Only for a quick pass — the email findings then report
  nothing at all rather than passing.

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
- **`scope-uninvoiced`** — billable cost left off every invoice. Confirm against
  the tracking sheet whether it was held back deliberately.
- **`math-*`** — the invoice does not foot. Quote the arithmetic from `detail`
  verbatim; it already shows both figures and the difference.

For `warning` findings, summarize rather than investigate each one, unless the
owner asks. Two of them need care:

- **`email-client-replied`** — the client wrote back and nobody answered. Read
  the thread before advising: a "thanks, received" needs no action and a "this
  is the second time you've billed me for this" needs it today. If the finding
  says the match was on the customer name rather than the invoice number, the
  thread may not be about this invoice at all — check before alarming anyone.
- **`email-not-sent`** — no trace of this invoice, while others in the same
  month DO have one. Worth a look, but a forwarded PDF or a phone call leaves no
  trace either. Never state it as "this was never sent".

## Step 3a — the email finding you must NOT over-read

**`email-no-trace`** (severity `info`) means not one invoice in the whole month
appears in the office mailbox. That is almost always because JobTread emails
invoices itself without copying the office — **it is not a fault**, and the
checks deliberately report it once rather than flagging every invoice.

Relay it as context in a single clause and move on. Do not build a
recommendation around it, and never tell the owner their invoices weren't sent
on the strength of it.

If `evidence.emailChecked` is `false`, the mailbox was not searched at all.
**Say the email leg was skipped.** Do not report it as clean.

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

## Step 5 — the memory

When the owner overrules a finding ("that's fine, that client's allowance draws
never have vendor backup"), **record it** so it never comes back:

```
POST /api/invoice-review
{ "key": "<finding.key>", "kind": "<finding.kind>", "jobId": "<finding.jobId>",
  "scope": "finding" | "job-kind", "reason": "<their words>" }
```

- `scope: "finding"` — this one thing. The default; use it unless told otherwise.
- `scope: "job-kind"` — every finding of this kind on this job, forever. Only for
  a standing arrangement, never to quiet one awkward month.

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
  `evidence.warnings` is empty *and* `evidence.emailChecked` is true. If the
  mailbox leg was skipped, the month is "clean on everything checked", and you
  must say which part wasn't.
- **Never read a message body.** The Apps Script side returns headers only, by
  design. If you need what a thread says, open it in Gmail — don't try to get
  the body through the review.

## Where the parts live

| Piece | File |
| --- | --- |
| The checks (pure, tested) | `src/lib/invoiceReview/checks.ts` |
| Evidence gathering (JobTread + Drive + Gmail) | `src/lib/invoiceReview/evidence.ts` |
| The paste-into-Claude briefing | `src/lib/invoiceReview/brief.ts` |
| Rulings / the memory | `src/lib/invoiceReview/rulings.ts` |
| The route | `src/app/api/invoice-review/route.ts` |
| The page | `src/app/invoice-review/InvoiceReview.tsx` |
| The Drive + Gmail reads (other repo) | `ascent-appscript/ClientInvoiceReview.js` |

## Known limitation, worth saying out loud

The Drive folder is looked up by the JobTread **customer name**. A job routed to
a different folder by `FOLDER_KEY_OVERRIDES` in the Apps Script config (today:
`PROJ_024` → `Electrical`) will report `backup-folder-missing` with the path it
looked in. That is a false positive, and the fix is a `job-kind` ruling on that
job — not a change to the checks.
