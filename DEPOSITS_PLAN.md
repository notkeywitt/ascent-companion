# DEPOSITS_PLAN.md — job deposits and client payments

The staged plan for showing each job's deposit and client payments in the
Assistant, and for applying part of a deposit to a client invoice.

Read 2026-10-05 against the live JobTread org, the Pave schema and both repos.
Every figure below came from a live query or the code, not from memory.
Read `CODEBASE_MAP.md` first.

## Status

| Stage | State |
|---|---|
| 1 — the read | **Built 2026-10-05.** `src/lib/deposits.ts` (+ 19 tests on the six jobs), `getJobDepositInputs`, `deposit_links`, `GET`/`POST /api/deposits` |
| 1b — deposits out of work totals | **Built 2026-10-05.** The review's cost-basis, margin, markup-drift and norms figures skip CD lines (`depositPart`/`isDepositLine` in `invoiceReview/checks/shared.ts`); `getJobDocumentRollup` nets CD lines out of the invoice rows (`netDepositLines`, so `/unbilled`, the digest and chat read work only); the job board's leaf and invoiced figures use `NOT_DEPOSIT_LINE`; the board rail skips CD |
| 2 — the board card | **Built 2026-10-05.** `src/app/trackingsheet/DepositCard.tsx`, beside the invoice panel. Shows client payments on every job that has them |
| 3 — the tracking sheet's Deposit row | Not started (appscript; `WebApp.js` needs the owner's ok) |
| 4 — apply a deposit (the JobTread write) | **Shipped 2026-10-05** on the owner's go: `planDepositDraw`/`suggestDraw` (+11 tests), `getInvoiceForDraw`, `resolveDepositLeaf`, `writeDepositDraw`, `POST /api/deposits/apply`, and the card's "Draw from the deposit" control (draft invoices only, a confirm first, hidden when the app's writes are off). The live probe could NOT run from the cloud session: it holds no app key, and the JobTread connector's grant lacks `createCustomerInvoice` and `updateJob`. So the FIRST real draw is the probe: it must drop the invoice price by exactly the draw and leave the tax alone, or it is undone and reported. `scripts/probe-deposit-line.mjs --live` still runs on any machine with `.env.local` |
| 5 — review checks | Not started |

Built as planned, with two refinements: Left reads "—" (null) when money was
drawn with nothing recorded to draw from (Ferron until its opening balance is
entered), and a deposit invoice billed but unpaid shows on the card without
counting toward Left.

### Next block, in order

1. **Owner, on the live card** (`/trackingsheet` → the job): on Bunkhouse,
   press "It's this job's deposit" on Berger's $128,842 payment; on Bunkhouse
   and Otis Perkins, enter the deposit left when the job moved to JobTread
   (from the tracking sheet). Answer section 6, items 1, 2, 5 and 7.
2. ~~Stage 1b, the rest~~ — done 2026-10-05.
3. ~~Stage 4~~ — shipped 2026-10-05. Watch the first real draw (Berger's
   September invoice). If it reports "totals did not move as planned", run the
   probe locally and record its answers here before trying again.
4. **Stage 3** (appscript) after Stage 4, so the Deposits tab carries real draws.

---

## 1. The answer

- **Yes, the API reaches payments.** Pave reads every payment, the invoices each
  payment paid, and the part still unapplied. It also writes payments and
  payment applications.
- **A payment belongs to a customer account, not a job.** A job reaches its
  payments only through the invoices they paid.
- **The office records deposits four ways today.** The app needs one model
  before it can show one balance per job.
- **JobTread documents two ways to take a deposit** (section 3): a payment on
  the customer's account, drawn down with Record Payment on each invoice; or a
  deposit invoice on a cost code mapped to an unearned-revenue account. It
  documents only the payment way for drawing a deposit down.
- **Recommendation:** take a deposit on a deposit invoice (JobTread's way), and
  draw it down with a **Contract Deposit (CD) line** on each client invoice
  (Intuit's QuickBooks way). Berger and Ferron already draw this way. The reason:
  in this org, payment applications made in JobTread do not reach QuickBooks.
- Show the balance on the Tracking Sheets board, and fill the Deposit row that
  the Google tracking sheets already keep by hand.

## 2. What the API offers

### Reads

| Need | Pave path | Notes |
|---|---|---|
| Every payment | `organization.payments` | `type` (`credit` = money in, `debit` = money out), `amount`, `amountApplied`, `amountUnapplied`, `paidAt`, `description`, `source`, `qboId`, `account` |
| What a payment paid | `payment.documentPayments` | each row: `amount`, `isLinkedToQbo`, `document`, `payment` |
| A job's payments | `organization.documentPayments` where `document.job.id` = the job | No `job.payments` and no `account.payments` connection exists |
| An invoice's paid and owed | `document.amountPaid`, `document.balance` | JobTread derives both from the invoice's document payments |
| Deposit lines | `costItems` where `costCode.id` = CD | Budget leaves (`document` null) and invoice lines |
| Cost code → QuickBooks item | `costCode.qboId` | CD → QuickBooks item 38, "construction:Contract Deposit" |
| Who applied a payment | `document.events`, type `documentPaymentCreated` | `createdByUser`, `createdByGrantName` |

### Writes

| Mutation | Input | Notes |
|---|---|---|
| `createPayment` | `organizationId`, `amount` > 0, `paidAt`, `type`; optional `accountId`, `description`, `externalId`, `source`, `attemptAutoMatch` | No job field |
| `createDocumentPayment` | `documentId`, `paymentId`, `amount` > 0, `isLinkedToQbo` (default false) | Applies part of a payment to one document |
| `updateDocumentPayment`, `deleteDocumentPayment` | `id` (+ `amount`) | |
| `updatePayment`, `deletePayment` | `id` | `type` cannot change |
| `createCostItem` with `documentId` | line fields + `jobCostItemId` | Adds one line to an existing document. Bills use it today. |
| `updateCostItem`, `deleteCostItem` | `id` | |

No purpose-built route uses a payment mutation today. The only code that
touches a payment is `_jtVoidDocument` (appscript `JobTread.js`), which removes
a voided bill's applications. The payment mutations sit on the office allowlist
of the generic `/api/pave` gateway only.

### Facts seen live that `JT_API_REFERENCE.md` does not carry

- `payment.feeAmount` exists (nullable number).
- A payment applied in JobTread's web app starts with `isLinkedToQbo: false`.
  JobTread linked only the first application of each deposit. **Five of the
  seven deposit applications in the org are not linked to QuickBooks.**
- Payments received in QuickBooks arrive with `source: "qbo"`, made by the
  "QuickBooks Online" user. Their `amountUnapplied` is usually money QuickBooks
  applied to an invoice JobTread never held. **`amountUnapplied` is not a
  deposit balance.** 14 customer payments carry unapplied money; 2 are deposits.
- A payment recorded in JobTread's web app goes to QuickBooks (Thomas's $17,000
  got QuickBooks id 44491). Berger's back-dated $128,842 did not (no `qboId`).
- `organization.qboIntegration` carries `showUnsyncedDocumentPaymentsAfter`
  (null today). Inference, unverified: setting it makes JobTread list the
  applications that never reached QuickBooks.
- `closeNegativePayable` also takes `createCreditPayment` (default true): a
  negative invoice closed as a credit becomes an unapplied payment.

## 3. What JobTread recommends

Source: JobTread's help tutorial "Cost-Plus: Deposits"
(<https://app.jobtread.com/help/cost-plus-deposits>, video
<https://www.youtube.com/watch?v=R9YE1dho7Wg>). The page could not be fetched
from this environment, so the wording below comes from search extracts.

| | Option 1 — payment on the customer's account | Option 2 — deposit invoice |
|---|---|---|
| Take it | Customer account → Payments → Payment. The money sits as "unapplied funds" that "can be used on any future invoice for that customer" | Add a Deposit line to the job budget on "a Cost Code that maps to a special QuickBooks account to be treated as unearned revenue". Send it on the Deposit Invoice template. Record the payment |
| Draw it down | On each invoice, Record Payment applies all of it or "a partial amount (e.g., $5,000) to leave a balance available for future invoices" | Not directly: "deposit invoices lock payments to that deposit document". To draw it, void the deposit invoice, then apply the freed payment (Option 1) |
| Belongs to | The customer | The job's budget |

Other findings:

- **JobTread does not describe a negative "Deposit" line** on later invoices.
  Intuit does: its "Record a retainer or deposit" article puts the deposit on a
  service item whose account is a liability, then enters that item "as a
  negative" on the later invoice
  (<https://quickbooks.intuit.com/learn-support/en-us/help-article/service-items/record-retainer-deposit/L6B5RsY6l_US_en_US>).
  Penny Lane, a JobTread partner, teaches the same (<https://jobcosting.com/customer-deposits/>).
- **Payment schedules** ("Payment and Bill Schedules", 2025-06-24) auto-create
  milestone invoices from a customer order. JobTread aims them at fixed-price
  jobs. All four jobs here are cost-plus.
- **Retainage** and **AIA-style payment applications** (`isPaymentApplication`)
  hold money back or bill progress. JobTread links neither to deposits.
- **Sync direction.** A payment taken in QuickBooks, or by Stripe, marks the
  JobTread invoice paid. A payment recorded in JobTread is pushed to QuickBooks.
  Consultants advise recording each payment in one system only. No JobTread
  source says what happens in QuickBooks when an existing payment is applied to
  a second invoice. In this org, those later applications stay unlinked
  (section 2).

## 4. What the org does today

The cost code is **CD, "Contract Deposit"** (`22PbMZGxCvxN`, added 2026-07-22).
Every CD line on an invoice posts to QuickBooks item 38.

| Job | How the deposit came in | How it is drawn down | Received in JT | Drawn in JT | Left per JT |
|---|---|---|---|---|---|
| Velorum — PreCon Budget (017) | Payment "Deposit for Pre Construction Services", check, 2026-06-10, $20,000 | Payment applied to #16 $2,543.15, #38 $10,872.90, #42 $6,583.95 | $20,000.00 | $20,000.00 | $0.00 |
| Ruhmann-Warren — Beach Shack PreCon (003) | Payment "PreConstruction Retainer", check, 2026-05-27, $20,000 | Payment applied to #22, #27, #38, #39 | $20,000.00 | $9,614.28 | $10,385.72 |
| Thomas — Patio Repair (30) | Deposit invoice #22: one CD line, $17,000, paid 2026-09-14 | Not drawn yet | $17,000.00 | $0.00 | $17,000.00 |
| Berger — Bunkhouse (002) | Payment "Deposit", check, dated 2026-01-01, $128,842. Entered in JobTread only, never applied | −$20,000 CD line on #320 | $128,842.00 | $20,000.00 | $108,842.00 * |
| Ferron — Otis Perkins Addition (004) | No receipt in JobTread. The budget's CD leaf says $123,000 | −$20,000 CD line on #386 | — | $20,000.00 | unknown * |
| Gormley — Studio (34) | Deposit invoice #8: one CD line, $270,975, pending, unpaid | — | $0.00 (billed $270,975) | $0.00 | $0.00 |

\* Both deposits predate JobTread. Draws on pre-JobTread invoices live in the
tracking sheet, not in JobTread. Ferron's October 2025 sheet already showed
$20,526.13 of $123,000 drawn (16.69%). Berger's balance needs the same check.

What the table shows:

1. **Two draw methods.** Velorum and Ruhmann-Warren apply a payment. Berger and
   Ferron put a negative CD line on the invoice.
2. **Berger can be credited twice.** Its deposit sits as an unapplied payment
   while its invoices take CD lines. Anyone who applies that payment in
   JobTread doubles the credit.
3. **A payment has no job.** Berger's account holds Bunkhouse and Main House.
   Velorum's holds three jobs.
4. **CD lines carry mixed cost:** +$16,079.69 (Thomas), +$229,639.97 (Studio),
   −$20,000 (Berger, Ferron). Line cost feeds `computeUnbilled`, the board's
   per-code invoiced figure and the review's cost-basis check (section 7, Stage 1b).
5. **Studio #8's CD line is taxable.** The other five are not. The invoice's
   tax rate is 0 today, so it charges no tax yet.
6. **Budget CD leaves disagree with the money.** Thomas: leaf $32,159.37,
   deposit billed $17,000. Ferron: two leaves ($123,000 and $0), and the draw
   line links to the $0 one. Berger: leaf $0.
7. **The draw amount is a rule the office sets per job.** Ferron's 2025 sheet
   drew the deposit by each month's P&O. Invoice #386 drew a flat $20,000.
   Velorum drew whole invoices until the deposit ran out.

How a draw is made today (Berger #320): Keillor built the invoice in JobTread,
then added the job's "Deposit" budget item as a −$20,000 line 26 seconds later,
while it was still a draft. The two payments for the net were recorded in
QuickBooks, which synced them back to JobTread.

## 5. The model

**A deposit is not work.** Deposit money never counts as billed work, billed
cost or revenue in any figure the app shows.

**One draw method: the CD line.** To draw $X from the deposit, the invoice gets
one line:

| Field | Value | Why |
|---|---|---|
| name | `Deposit` | What #320 and #386 say |
| cost code | CD | Posts to QuickBooks item 38 |
| `jobCostItemId` | the job's CD budget leaf | JobTread's budget shows the draw against the deposit |
| `unitPrice` | −X | |
| `quantity` | 1 | |
| `unitCost` | −X | Matches #320 and #386, so JobTread's invoice profit is unchanged |
| `isTaxable` | false | Tax stays on the work, not the deposit |

To cover a whole invoice from the deposit (Velorum's way), X = the invoice's
`priceWithTax` before the line. The CD line is not taxable, so it does not
change the tax.

Why the line, not a payment application:

| | CD line | Payment application |
|---|---|---|
| Documented by | Intuit (QuickBooks deposit method) | JobTread (Option 1) |
| Belongs to | the job | the customer account |
| Reaches QuickBooks | yes, with the invoice, as item 38 | 5 of 7 never did |
| Client sees it | yes, as a line on the invoice | only as "amount paid" |
| Works for a deposit taken by invoice (Thomas) | yes | only after the deposit invoice is voided |
| Office habit | Berger, Ferron | Velorum, Ruhmann-Warren |

The payment application is JobTread's own method, and it would be the choice
if it reached QuickBooks. It does not here. JobTread never linked Velorum's
later applications, so QuickBooks likely still shows #38 and #42 open
(decision 6).

Ruhmann-Warren still has $10,385.72 on a payment-method retainer. It finishes
the way it started, in JobTread's own UI. The app shows it and never writes it.

### The ledger, per job

| Figure | Rule |
|---|---|
| Agreed | Σ price of the job's CD budget leaves |
| Opening | Deposit left when the job moved into JobTread, entered once by the office (pre-JobTread deposits only) |
| Received | Paid part of positive CD lines on live invoices + deposit payments attributed to the job, less what they paid on deposit invoices |
| Drawn | Σ of negative CD lines on `pending`/`approved` invoices + deposit-payment applications to the job's other invoices |
| On a draft | Σ of negative CD lines on `draft` invoices. Shown, not counted |
| Left | Opening + Received − Drawn |

"Live" excludes `denied`, which is the void (#17 and #385 drop out). A job with
an Opening counts only JobTread entries dated after it.

**Deposit payment** = a customer payment whose description matches
`/deposit|retainer/i`, or one the office marks as a deposit. **Its job** = the
job of the invoices it paid; else the one open job on the account; else the job
the office picks.

**Draw rule, per job:** "whole invoice" (Thomas, Velorum: the client owes
nothing until the deposit runs out) or "fixed amount" (Berger, Ferron: $20,000
a month). The rule only sets the amount the app suggests. The office can type
any amount up to Left.

JobTread has no field for "this payment belongs to that job", for a
pre-JobTread opening balance, or for a draw rule. Those three facts live in one
small companion table (`deposit_links`: job, payment id, opening amount +
as-of date, draw rule, note, who, when). Every other figure is read live from
JobTread.

## 6. Decisions for the owner

1. **Draw method.** CD line (recommended) or payment application (JobTread's
   documented method). Choosing the payment application changes Stage 4's
   write to `createDocumentPayment`, and adds a QuickBooks probe first.
2. **QuickBooks item 38.** Ask the bookkeeper which account "construction:
   Contract Deposit" posts to. It must be a liability (Customer Deposits). If it
   is income, each deposit invoice books revenue before the work.
3. **Berger.** Confirm the $128,842 belongs to Bunkhouse, and the deposit left
   when JobTread started. Confirm the unapplied payment stays unapplied (the
   CD lines do the drawing).
4. **Ferron.** The deposit left when JobTread started, from the tracking sheet.
5. **Thomas.** Is $32,159.37 the full deposit (with $15,159.37 still to bill),
   or is $17,000 the whole deposit?
6. **QuickBooks check.** Do Velorum #38 and #42, and Beach Shack #27, #38 and
   #39, show as paid in QuickBooks? Their deposit applications never linked.
7. **Studio #8.** Make its deposit line non-taxable before the invoice is paid?
8. **Who may apply a deposit.** Office and admin (recommended), through the
   `recode` view.
9. **Optional:** remove the payment mutations from the `/api/pave` office
   allowlist, so the purpose-built route is the only deposit write
   (`src/lib/paveGateway.ts` — owner's ok required).

## 7. Stages

Each stage ships on its own and leaves the app working.

### Stage 1 — the read (no writes)

| Piece | Where | What |
|---|---|---|
| Ledger rules | `src/lib/deposits.ts` (pure) | `buildDepositLedger(inputs)` — section 5, nothing else |
| Tests | `src/lib/deposits.test.ts` | Golden vectors (fixed cases with known answers): the six jobs in section 4 as they stood on 2026-10-05 |
| JobTread read | `getJobDepositInputs(cfg, jobId)` in `src/lib/jobtread.ts` | Phase 1: CD budget leaves + CD lines on the job's customer invoices. Phase 2: customer `documentPayments` on those invoices. Phase 3: the account's `credit` payments. Phases keep the 413 rule; every walk uses `pageAll` |
| Route | `GET /api/deposits?jobId=` | `{ ledger, payments }`. Add to the `recode` view's `paths` |
| Payments list | same route | Every client payment on the job: date, amount, invoice, source (QuickBooks / check / JobTread), linked to QuickBooks or not |
| Links table | `deposit_links` in `src/db/schema.ts` + `src/lib/depositLinks.ts` | The three facts JobTread cannot hold (section 5), edited from the deposit card |

### Stage 1b — keep deposits out of work totals

Deposit lines and CD budget leaves distort four figures today. Fix each one
with a test that holds a CD line.

| Figure | Where | Fix |
|---|---|---|
| Unbilled cost | `computeUnbilled`, `src/lib/jobtread.ts` (used by `/unbilled`, the digest's `costVsInvoice`, chat) | Subtract the cost of CD lines on approved invoices |
| Job board | `getJobBoard`: `invoicedByJob`, and `leafPriceByJob` (the fallback budget, which counts a CD leaf's deposit amount as contract price) | Add `costCode.id` ≠ CD to both filters |
| Board rail | `_getJobCostDetailUncached` and `getJobBudget` | Leave CD out of the rail, budget and invoiced; the deposit card shows it |
| Review checks | `invoiceReview/checks/costBasis.ts`, `margin.ts`, `norms.ts` | Skip CD lines. Recognize a deposit line by cost code, never by name |

### Stage 2 — show it on the Tracking Sheets board

- A `DepositCard` beside `InvoiceReconcile` (`Board.tsx`, the mount at line
  2043). One `StatementBlock` (deposit left). A `MetaLine`: agreed · received ·
  drawn. A `ListCard` of entries: date, invoice, amount, method.
- A `Chip` only for an exception: drawn more than received, a deposit payment
  with no job, an application JobTread never linked to QuickBooks.
- `InvoiceReconcile` shows each invoice's paid and owed. It fetches
  `amountPaid` today and never shows it.
- Summary view: the month's draw next to the invoice links.
- The card hides on a job with no CD leaf, no CD line and no deposit payment.

### Stage 3 — fill the Google tracking sheet's Deposit row

The tracking-sheet template keeps a Deposit row under P&O and WSST, filled by
hand (Ferron's sheet; `BudgetImport.js` stops parsing at it). Its columns are
CONTRACT ESTIMATE (the deposit), TOTAL PREVIOUSLY INVOICED, CURRENT INVOICE,
TOTAL INVOICED TO DATE and % (drawn ÷ deposit).

- **The companion builds the rows. Apps Script files them.** That is the
  `LaborReport.js` pattern: one definition of the numbers.
- New WebApp action `writeTrackingDeposits { projectId, rows, summary }` writes a
  code-owned **Deposits** tab: one row per entry, plus the summary cells
  (agreed, opening, received, drawn before this invoice, drawn on this invoice,
  left).
- The Deposit row reads the tab with formulas, the way INVOICES reads
  'SubVendor Invoices'. Code never writes the main tab. `repairTrackingSheetLookups`
  can wire those formulas later.
- The board's "Sync to Tracking Sheet" pushes the tab, and so does every
  Stage 4 write.
- `finalizeTrackingSheetMonth` already copies the totals block, Deposit row
  included, into the month block. TOTAL PREVIOUSLY INVOICED keeps working as it
  does today.
- Stop and ask: this changes `WebApp.js`, so it ships with `./deploy.sh`.

### Stage 4 — apply part of a deposit to an invoice (the write)

**Probe first** (a one-off live test write): `scripts/probe-deposit-line.mjs`,
on a throwaway draft invoice on a test job. Confirm:

1. `createCostItem` on a customer invoice: is `jobCostItemId` required? It is
   for a bill.
2. A negative `unitPrice` with `isTaxable: false` on an invoice whose `taxRate`
   is above 0: the price drops by exactly X and the tax does not move (no carve).
3. `unitCost` −X lowers the document's `cost` by X.
4. A line on a draft invoice stays out of QuickBooks until the invoice leaves
   draft.
5. `updateCostItem` changes the amount and `deleteCostItem` removes it; the
   totals follow both.

**Route** `POST /api/deposits/apply { invoiceId, amount }`, office and admin,
on the `recode` view:

1. Refuse unless `writesEnabled()`.
2. Read the invoice. Refuse unless it is a `customerInvoice` in `draft`.
   A pending or approved invoice is already in QuickBooks; the office changes it
   in JobTread.
3. Build the ledger fresh. Refuse an amount ≤ 0, above Left (+ $0.005), or above
   the invoice's `priceWithTax`.
4. Keep one deposit line per invoice. Update the line if it exists; create it
   if not. Amount 0 removes it, with the `getLineJournalSnapshot` record first.
5. Resolve the job's CD budget leaf. Create a $0 leaf if none exists (the
   `resolveShopBuybackLeaf` pattern).
6. Write, re-read, verify price and tax. On a mismatch, remove the line and
   report.
7. Journal it: `openJournal("/api/deposits/apply")`, action
   `invoice.deposit.apply`, before and after amounts.
8. Push the Deposits tab (Stage 3).

**Never reuse `createLine`.** It forces the document's `taxRate` to 0 first,
which would erase the invoice's sales tax.

**If decision 1 picks the payment application instead,** the write is
`createDocumentPayment { documentId, paymentId, amount }` against the job's
deposit payment, and the probe must first answer one question: does
`isLinkedToQbo: true` put the application into QuickBooks, or does nothing
reach QuickBooks either way? Without a yes, that method leaves QuickBooks out
of step, as it already is for Velorum and Ruhmann-Warren.

**UI** on the `DepositCard`, beside the month's draft invoice: an amount field
(default from the job's draw rule, never above Left), "Apply to invoice #N",
and Change / Remove when the line exists.

Stop and ask before shipping: this is a JobTread write path.

### Stage 5 — review checks

One file per check in `src/lib/invoiceReview/checks/`, its config in
`settings.ts`, one line in `registry.ts`.

| Check id | Catches |
|---|---|
| `deposit-overdrawn` | Drawn exceeds Opening + Received |
| `deposit-line-taxable` | A CD line with `isTaxable` true |
| `deposit-line-uncoded` | A line named like "Deposit" that is not coded CD, or a CD line with no budget leaf |
| `deposit-double-draw` | A job that draws one deposit by CD line AND by payment application |
| `deposit-payment-unlinked` | A deposit-payment application JobTread never linked to QuickBooks |
| `payment-overapplied` | Already planned in `INVOICE_ACCURACY_PLAN.md` |

Each check replaces a standing ruling ("deposit draw — never has backup") with
a real test.

### Not planned

- **Creating invoices in the app.** The app links to JobTread's invoice builder
  on purpose (`jobtread.ts`, "no createDraftInvoice here"). A deposit invoice
  is a JobTread invoice with one CD line.
- **Recording client payments in the app.** Payments stay where the office
  records them now: QuickBooks, or JobTread's Record Payment.

## 8. Risks

- A draw made in the app and another in JobTread on the same invoice doubles
  the credit. The route updates the one CD line in place, and the card shows
  any line JobTread already has.
- A CD line added to a non-draft invoice changes a document QuickBooks already
  holds. The route refuses anything but a draft.
- A wrong Opening figure makes every later balance wrong. The office enters it
  once, with the tracking-sheet figure it came from in the note.

## 9. Files this plan touches

| Repo | File | Stage |
|---|---|---|
| companion | `src/lib/deposits.ts`, `deposits.test.ts` (new) | 1 |
| companion | `src/lib/jobtread.ts` (`getJobDepositInputs`, `computeUnbilled`, `getJobBoard`, cost detail) | 1, 1b |
| companion | `src/app/api/deposits/route.ts`, `src/app/api/deposits/apply/route.ts` (new) | 1, 4 |
| companion | `src/db/schema.ts` (`deposit_links`), `src/lib/depositLinks.ts` (new) | 1 |
| companion | `src/lib/views.ts` (`recode` paths) | 1, 4 |
| companion | `src/lib/invoiceReview/checks/*`, `settings.ts`, `registry.ts` | 1b, 5 |
| companion | `src/app/trackingsheet/DepositCard.tsx` (new), `Board.tsx`, `src/components/InvoiceReconcile.tsx` | 2, 4 |
| companion | `scripts/probe-deposit-line.mjs` (new) | 4 |
| appscript | `TrackingSheets.js` (Deposits tab writer), `WebApp.js` (route) | 3 |
