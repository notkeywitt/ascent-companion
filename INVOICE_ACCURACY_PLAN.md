# INVOICE_ACCURACY_PLAN.md — from "monthly review" to "perfect bookkeeper"

The staged plan for expanding the Assistant's Claude capabilities until client
invoicing mistakes stop happening. Centered on JobTread, learning as it goes.

**Read `CODEBASE_MAP.md` and `.claude/skills/invoice-review/SKILL.md` first.** This
document assumes the v1 review exists — it does — and is about what comes next.

---

## 1. What already exists (v1, shipped)

Don't rebuild any of this. The foundation is good.

| Piece | Where | What it does |
|---|---|---|
| 18 deterministic checks | `src/lib/invoiceReview/checks.ts` (688 lines) | Backup, math, period/scope, mailbox. Pure + unit-tested (`checks.test.ts`, 646 lines). |
| Evidence gathering | `src/lib/invoiceReview/evidence.ts` | Vendor bills for the month, client invoices + their `costItems`, the Drive backup folder, an All-Mail sweep. |
| The memory | `src/lib/invoiceReview/rulings.ts` + `invoice_review_rulings` | Suppression only: "we know, it's fine, here's why." Scopes `finding` / `job-kind`. |
| Claude | `src/lib/invoiceReview/narrate.ts` | **One** call, no tools, writes the opening paragraph over the findings. |
| The hand-off | `brief.ts` + the skill | A markdown briefing a human pastes into Claude, so the review works with no API key. |
| Read-only Drive + Gmail | `ascent-appscript/ClientInvoiceReview.js` | Lookup-only twins of the ingestion helpers. Creates nothing. |

The design invariant that makes it trustworthy, and which everything below keeps:
**the review cannot edit what it reviews.** Its only write anywhere is a ruling row.

---

## 2. The three gaps

### Gap A — it checks the invoice against the *bills*, never against the *contract*

This is the big one. Every v1 check answers "does this invoice agree with the vendor
bills and paperwork behind it?" **None answers "does this invoice agree with what the
customer agreed to pay?"** That is where client invoicing mistakes actually live, and
JobTread already holds the answer in documents the review never loads:

- **`customerOrder` documents** — the contract and its change orders. Never read. So
  over-billing the contract, billing unapproved CO work, and a signed CO nobody ever
  billed are all invisible today.
- **`job.priceType`** (`fixed` | `costPlus`) — never read. The review applies one
  mental model to both, but a cost-plus job bills cost × markup and a fixed-price job
  bills a schedule of values. Different jobs, different error classes.
- **`document.profitBreakdown`** — markup. A line billed at cost with the markup
  silently dropped is the classic money leak, and nothing looks for it.
- **`job.defaultRetainagePercentage` / `job.retainageCostItem`** — retainage. Held?
  At the right rate? Ever released? Unchecked.
- **`document.allowanceCostItem` / `allowanceDeductionCostItem`** — allowance draws
  and overage. Unchecked.
- **`costItem.jobCostItem`** — the link from an invoice line to the budget leaf it
  bills against. Unread, so "billed to a line with no budget" and unit-price drift
  vs. the estimate can't be seen.
- **Tax policy** — v1 checks only the *arithmetic* (`priceWithTax − price == tax`).
  It never asks whether the *rate* is right, whether `taxIsLocked` was overridden, or
  whether tax landed on labor.
- **Delivery and payment** — `documentRecipient.emailDeliveryStatus`,
  `documentLastViewedAt`, `signedAt`, `documentPayments`. An invoice that bounced, was
  never sent, or took a payment twice is an invoicing mistake with real cash cost.

### Gap B — the memory only makes it quieter, never smarter

`rulings.ts` is one-directional. A ruling suppresses; nothing ever *adds* scrutiny.
Three things it structurally cannot do:

1. Learn a **pattern** rather than an instance (it has `job-kind`, but no
   customer-level or vendor-level scope).
2. Learn a **new check** from a mistake the office caught that the system missed.
   There is nowhere to even record such a miss.
3. Learn a **normal** — this customer's usual markup, this job's usual tax rate — so
   an anomaly no fixed threshold can express stays invisible.

And underneath all three: **no run is ever persisted.** There is no history, so there
is no baseline, no month-over-month comparison, and nothing to learn from. The Daily
Digest already persists every run to `daily_digest`; the invoice review does not.

### Gap C — Claude narrates; it doesn't investigate

Today's Claude call is one shot, no tools, handed only the finished findings, writing
a paragraph. Meanwhile `SKILL.md` tells a *human* driving Claude Code to go chase
misfiled PDFs, check alternate vendor spellings, and open both invoices on a suspected
duplicate. **The app itself can do none of that.** The investigation only happens when
a person happens to run the skill.

> **A concrete bug to fix first.** `narrate.ts` sets `MAX_TOKENS = 600` and does not
> pass a `thinking` parameter. `src/lib/digest/claude.ts` documents at length that
> omitting `thinking` runs *adaptive* thinking, that thinking tokens are drawn from
> `max_tokens` before any text block is emitted, and that this took out the digest
> summary on 2026-08-31 **at 900 tokens** — a higher ceiling than the review's. The
> review's failure path is silent by design (falls back to `fallbackSummary`), so if
> it is failing, nobody has been told. Verify against a real run, then raise the
> ceiling and make the fallback say *why* — exactly the fix commit `0946f15` already
> made for the digest.

---

## 3. The stages

Each stage ships on its own branch through the normal preview → merge loop, and each
is useful without the ones after it.

### Stage 0 — Fix and instrument (small)

The foundation for everything else is *history*. Nothing can learn without it.

1. **Fix `narrate.ts`**: raise `MAX_TOKENS` to 16_000 (a ceiling is not a spend —
   you're billed for tokens generated), and report the reason on fallback instead of
   failing silently.
2. **Persist every run** — new table `invoice_review_runs`: `ym`, `ranAt`, `runBy`,
   the findings JSON, per-severity counts, the evidence warnings, and a hash of the
   evidence so an unchanged month is recognisable. Mirrors `daily_digest`.
3. **Move the heavy run to cron**, page reads the stored row. The route is already at
   `maxDuration = 300` — the ceiling — and Stage 2 will blow it. This is the same
   architecture the digest already uses (`/api/digest/run` + the `daily_digest`
   table), so it's a known-good pattern, not a new idea.

### Stage 1 — Registry the checks (medium, no behavior change)

`checks.ts` is a 688-line monolith and this plan roughly doubles the check count.
Refactor it into the shape `src/lib/digest/` already proves out:

```
src/lib/invoiceReview/
  checks/<id>.ts     one file per check, pure, its own tests
  settings.ts        POLICY: enabled, severity, thresholds — one editable file
  registry.ts        the one list
```

Why it's worth doing before Stage 2: it gives every check an id-keyed settings block,
which is what lets the office tune a threshold or mute a check at `/admin` with no
deploy (precedent: `digest_settings_overrides`), and it's what Stage 3's precision
tracking attaches to.

### Stage 2 — SKIPPED (owner's decision, 2026-09)

**Ascent bills cost-plus.** An estimate is given, but there is no contractual
ceiling on spending a client's money, so the whole contract family —
`contract-overbilled`, `co-billed-unapproved`, `co-approved-unbilled`,
`contract-balance-drift` — is checking for a failure mode that does not exist
here. Skipped, not deferred.

**One piece of it is worth revisiting.** The MARGIN checks (`markup-missing`,
`markup-rate-drift`, `billed-below-cost`) are arguably *more* relevant to
cost-plus, not less: cost × markup is the entire revenue model, so a line that
reaches a client invoice at cost is silent lost revenue with nothing else in the
system to catch it. Left out with the rest by decision, and recorded here so it
is a choice rather than an oversight.

The retainage, allowance, tax-policy and delivery families remain unbuilt and
unjudged — they were never the reason Stage 2 was skipped.

<details>
<summary>The original Stage 2, kept for reference</summary>

### Stage 2 — Close the evidence gaps (large — this is the substance)

**Precondition to verify first:** does the org actually keep contracts and change
orders as `customerOrder` documents in JobTread, consistently? If not, half of this
stage is inert, and the real first move is a data-hygiene one. **Check this against
the live org before building anything here.** All the additions below are *reads*;
introspect each unfamiliar field via the JobTread MCP connector to confirm it before
use (reads may be trusted from introspection — only *writes* need a live probe, and
this feature has none).

**2a — load the contract.** Extend `evidence.ts` with `customerOrder` documents per
job, `job.priceType` / `defaultRetainagePercentage` / `retainageCostItem` /
`closedOn`, `document.profitBreakdown`, `documentRecipients`, `documentPayments`, and
the budget cost items (`document == null`) for the `jobCostItem` join. Respect the 413
rule: fetch heavy connections in a second phase and join by id, as `loadInvoice`
already does.

**2b — the new check families.** ~19 checks, each grounded in a named field:

| Family | Check id | Catches |
|---|---|---|
| Contract | `contract-overbilled` | Invoiced-to-date exceeds contract + approved COs |
| | `co-billed-unapproved` | Billing work from a change order nobody signed |
| | `co-approved-unbilled` | A signed CO that was never billed |
| | `contract-balance-drift` | Contract balance doesn't foot against invoices to date |
| Margin | `markup-missing` | A cost-plus line billed at cost — markup dropped |
| | `markup-rate-drift` | Markup off this job's established rate |
| | `billed-below-cost` | A line priced under the cost behind it |
| Retainage | `retainage-not-held` | Job has a retainage % and the invoice holds none |
| | `retainage-rate-wrong` | Held at a rate that isn't the job's |
| | `retainage-never-released` | Job closed, retainage still held |
| Allowance | `allowance-overdrawn` | Draws exceed the allowance line |
| | `allowance-not-deducted` | Allowance billed without its deduction |
| Tax | `tax-rate-unexpected` | Rate differs from this job's norm |
| | `tax-on-labor` | Tax applied to a labor-coded line |
| | `tax-lock-overridden` | `taxIsLocked` was turned off on this invoice |
| Cumulative | `duplicate-across-months` | Same vendor bill billed in two different months |
| | `jtd-overbilled` | Job-to-date billing exceeds job-to-date cost × markup |
| | `unbilled-cost-aging` | Captured cost sitting uninvoiced past N days |
| Budget | `line-no-budget` | Invoice line codes to no budget leaf |
| | `line-price-drift` | Unit price differs from the estimate line |
| Delivery | `invoice-never-sent` | Approved invoice with no recipient |
| | `invoice-bounced` | `emailDeliveryStatus` failed |
| | `invoice-unviewed` | Sent, unpaid, never opened after N days |
| | `payment-overapplied` | `amountPaid` exceeds `priceWithTax` |

Every one ships at `warning` severity (see Stage 3's promotion rule), and every
number it produces comes from a pure, unit-tested function — golden vectors in the
style of `BILLING_VECTORS` for any new dated or rate-based rule.

</details>

### Stage 3 — The learning layer (medium — this is what "learns as it goes" means)

Four **separate** memories, deliberately not one table, because they fail differently
and only one of them is allowed to silence anything.

1. **Rulings** *(exists — extend)*. Human-authored, "this is fine, forever." Add
   `customer-kind` and `vendor-kind` to the existing `finding` / `job-kind` scopes, so
   a standing arrangement can be recorded once at the level it actually holds at.

2. **Norms** *(new — `invoice_review_norms`)*. Machine-learned baselines computed
   from run history: per customer / job / vendor, the typical markup, tax rate,
   monthly invoice count, backup coverage ratio, days-to-send. Each row carries its
   sample size and spread. Norms drive the anomaly checks that no fixed threshold can
   express — *"this job's markup is 12% and has been 22% for nine months."*

3. **The miss log** *(new — `invoice_review_misses`)*. **The important one.** When
   the office catches an error the review didn't, they record it: which invoice, what
   was wrong, the dollars, and how it should have been caught. This is the training
   set. Claude reads the accumulated log and proposes a new check specification with
   test vectors; a human accepts it and it becomes a file in `checks/`. That is the
   actual learn-as-it-goes loop — the system gets a *new sense*, not just a quieter one.

4. **Standing instructions** *(new — mirrors `digest_instructions`)*. Durable prose
   preferences injected into every Claude pass ("always lead with anything touching
   the Ferron job", "we never bill Shop"). Memory *for Claude*, not a note the owner
   reads back.

**Two rules that keep this safe, and they are not negotiable:**

> **Learning may only ADD scrutiny automatically. Removing scrutiny is always a human
> ruling.** No model output ever suppresses a finding.

> **New checks ship at `warning` and are promoted to `error` only on evidence.** Each
> check accrues a confirmed/overruled tally from the rulings and miss logs — a
> precision score, visible at `/admin`. High precision promotes; low precision demotes
> to `info`. Demotion re-ranks a noisy check, it never hides it. A false positive
> erodes trust faster than a miss does, and this is the mechanism that keeps the list
> worth reading in month nine.

### Stage 4 — Claude as investigator, not narrator (medium)

Give the review its own read-only tool loop. The engine already exists
(`src/lib/anthropic.ts`) and `chatTools.ts` shows the tool shape.

| Tool | Why |
|---|---|
| `get_finding_context(key)` | The evidence behind one finding |
| `search_drive_backup(amount \| vendor)` | Chase a misfiled PDF — `SKILL.md` currently asks a *human* to do this by hand |
| `get_contract(jobId)` | Contract + change orders |
| `get_job_history(jobId, months)` | From the Stage 0 run history |
| `get_norms(scope, key)` | The learned baselines |
| `get_bill_detail(docId)` | Already exists in `chatTools.ts` |

Claude's job becomes **triage and disposition** — per finding: `confirmed` /
`probably-fine, because…` / `needs-human` — producing a ranked, explained worklist
instead of a paragraph. Keep the boundary `narrate.ts` already states, word for word:

> **The checks own every number. Claude owns the judgement about which numbers matter
> and why.** Claude never computes a figure that appears in a finding.

### Stage 5 — Move it left: stop mistakes instead of catching them (medium)

A month-end review is a *late* catch — by then the invoice may already be with the
client. Same checks, earlier:

- **A pre-send gate.** Run the review for a single invoice at draft time on
  `/trackingsheet`'s ClientInvoicing panel, before it goes out. Findings surface at the
  point of creation, which is the only place a mistake is cheap.
- **Mid-month cron.** Run around the 10th–15th so window and capture problems surface
  while there's still time to fix them.
- **Re-enable the digest's billing checks.** `registry.ts` notes they ship OFF by
  default; with contract-aware checks behind them they earn their place in the morning
  brief.

### Stage 6 — Trust the paperwork, don't just parse its filename (small)

`_civParseBackupName` reads the amount out of the PDF's *filename*. That's the
pipeline's own convention, so it's usually right — but a mis-named file matches
happily. Confirm the amount **inside** the PDF against the JobTread bill for
high-value or already-flagged items, using the extraction path that already exists in
the appscript repo.

---

## 4. Data model additions

All in the companion DB. JobTread stays untouched — the review still writes nothing
to it, and nothing here races the hourly mirror.

| Table | Holds |
|---|---|
| `invoice_review_runs` | One row per run: month, findings, counts, evidence hash |
| `invoice_review_norms` | Learned baselines per customer/job/vendor + metric |
| `invoice_review_misses` | Errors the office caught that the review didn't |
| `invoice_review_instructions` | Standing prose preferences for the Claude pass |
| `invoice_review_check_stats` | Per-check confirmed/overruled tally → precision |

---

## 5. Risks, honestly

- **Budget.** The route is already at `maxDuration = 300`, the ceiling. Stage 2
  materially increases per-job calls. This is why Stage 0's cron + persistence comes
  first, not last. Add incremental runs — skip jobs unchanged since the last run.
- **413.** More nested connections is exactly the shape that triggers it. Two-phase
  fetch and join by id, every time.
- **Contract data quality.** Stage 2's whole contract family assumes `customerOrder`
  documents are kept consistently. Verify before building; if they aren't, the honest
  first deliverable is a data-hygiene report, not a check.
- **False positives.** The real failure mode of an ambitious reviewer. Warning-first
  plus precision tracking is the mitigation, and it should not be skipped to ship
  faster.
- **Scope creep into writes.** Every stage here is read-only. The moment the review
  can fix what it finds, it stops being trustworthy as a reviewer. Keep the rulings
  row as the only write.

---

## 6. Sequencing

| Stage | Ships | Size | Status |
|---|---|---|---|
| 0 | Fixed narration, run history, cron | Small | ✅ **Landed** |
| 1 | Check registry + settings | Medium | ✅ **Landed** |
| 2 | Contract/margin/retainage/tax/delivery checks | Large | ⏭️ **Skipped** — cost-plus |
| 3 | Norms, miss log, instructions, precision | Medium | ✅ **Landed** |
| 4 | The investigating Claude loop | Medium | Next |
| 5 | Pre-send gate + mid-month run | Medium | |
| 6 | PDF amount confirmation | Small | |

**What landed in 0 and 1.** `narrate.ts` raised to a 16k ceiling at low effort
and now reports why it fell back instead of failing silently;
`invoice_review_runs` keeps every run (appended, many per month), written by the
review route and by a nightly `/api/invoice-review/run`; the page opens onto the
last filed run, stamped, with "Check again" to sweep live. The 688-line
`checks.ts` is now eight files under `checks/`, a `settings.ts` holding every
threshold and an `enabled` flag per check, and a `registry.ts` that asserts no
two checks share a finding kind and catches a throwing check onto
`evidence.warnings` rather than losing the whole review. `checks.test.ts` kept
every assertion it had (247 passing, unchanged) and `registry.test.ts` adds 11
for the new machinery.

**What landed in 3.** Four memories, kept separate because they fail
differently, and only one of them can silence anything.

*Derived — nobody has to do anything.* `invoice_review_finding_state` watches
findings appear and disappear, so every row now says whether it is new or has
been standing since March, and per-check precision falls out of what the office
does next (a finding that stops appearing was fixed; one that gets a ruling was
set aside — counted separately and never merged). `norms.ts` learns vendor
cadence from the stored payloads, which made `vendor-silent` possible: a vendor
who bills four months in five and billed nothing this month. For a cost-plus
builder that is missing *revenue*, and it is the one failure with no evidence
anywhere — an invoice that was never sent leaves no email, no bill, no PDF, only
a hole in a pattern.

*Written by the office.* The **miss log** (`invoice_review_misses`) records
mistakes the review did not catch — the only input a genuinely new check can
come from — and `/api/invoice-review/learn` hands it to Claude with the current
check list and asks what would have caught them. The answer is a **proposal a
person implements**; nothing writes a check. **Standing instructions** shape how
the month is read out, never what is found. Rulings gained a `customer-kind`
scope for arrangements that belong to the client rather than to one job.

**Still true, and load-bearing:** learning only ever ADDS scrutiny
automatically. Removing it is always a human ruling with a reason attached.

**Not built yet, from this stage's original sketch:** severity promotion and
demotion. The precision numbers now exist and are exposed at
`/api/invoice-review/accuracy`, but nothing acts on them — a check's severity is
still fixed in its own file. That is deliberate: there is no history to promote
*from* until the review has been running for a few months, and wiring an
automatic demotion before there is data to drive it would just be a random
number generator with a good story.

Stages 0 and 1 are prerequisites for everything. Stage 2 is where mistakes actually
start getting caught. Stage 3 is what makes it improve without being rebuilt.
