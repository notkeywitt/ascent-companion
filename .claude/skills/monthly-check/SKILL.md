---
name: monthly-check
description: Run the COMPLETE monthly invoice check on Opus in Claude Code — make sure the month has a fresh coded run in the app (JobTread + Drive + mailbox), chase every finding with the JobTread, Gmail and Drive tools, reconcile each legacy client's Google Tracking Sheet (bills and labor) against JobTread, then post a verdict per finding, the month's reading and the full report back to the app's /invoice-review page. Runs on its own on review days from the office Mac (scripts/monthly-check/). Use when the owner types /monthly-check, or asks to "run the monthly check", "run the full invoice check", or "check the month on Opus".
model: opus
argument-hint: "[YYYY-MM]"
---

# The complete monthly check

This replaces the app's old Anthropic-API "Investigate" button and summary
paragraph. The coded checks still run in the app, because only the app holds
the JobTread, Drive/Gmail-bridge and database keys. You do the Claude part and
post it back, and the `/invoice-review` page shows it.

Read `.claude/skills/invoice-review/SKILL.md` first. Its vocabulary, its Step 3
(how to chase each kind of finding) and its "What you must not do" list all
apply here. This file only replaces how you get the run and where the result goes.

Every call to the app goes through one helper. It holds the token, so the token
never appears in a command:

```
node scripts/monthly-check/agent.mjs <command> …
```

(If `node` is not found, prefix: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null;`)

## Never report a JobTread invoice that does not exist yet

The office **stages** each month's client invoice in the app: the Tracking
Sheets board builds a virtual invoice from the month's bills and labor. The
invoice is created in JobTread **last**, because JobTread does not carry later
bill edits into an invoice that already exists. So during the review window:

- "This job has no JobTread invoice yet" is normal. Never report it.
- A JobTread **draft** invoice is not a built invoice. Bills and labor "not on"
  it are staging, not misses. Never report them.
- Report a bill or labor as left off only when the job has a **built** (non-draft)
  JobTread invoice for the month. The coded check already follows this rule
  (`countDraftInvoices`, checks/uninvoiced.ts); older runs may still carry
  `job-not-invoiced` / `bill-uninvoiced` / `scope-uninvoiced` findings made
  under the old rule — give those `probably-fine` with the reason "staging".

## Link every item to where it is fixed

Each line in the report and each verdict's `suggestedAction` names the page the
office opens to fix it. Use full links:

| To fix | Link |
|---|---|
| A bill: code it, approve it, void it, move it | `https://ascent-companion.vercel.app/bill/<billId>?jobId=<jobId>` |
| A job's month: staged invoice, labor, coding | `https://ascent-companion.vercel.app/trackingsheet?jobId=<jobId>&ym=<ym>` |
| Re-sync a Tracking Sheet | `https://ascent-companion.vercel.app/tracking-sheet?jobId=<jobId>&ym=<ym>` |
| A bill or invoice in JobTread | `https://app.jobtread.com/jobs/<jobId>/documents/<docId>` |
| A job in JobTread | `https://app.jobtread.com/jobs/<jobId>` |
| A Google Tracking Sheet tab | the sheet URL from `agent.mjs tracking`, plus `#gid=` when known |
| A vendor invoice email | the Gmail `viewUrl` from the thread |
| This month's findings | `https://ascent-companion.vercel.app/invoice-review?ym=<ym>` |

A finding's own `sourceLink` (relative, e.g. `/bill/…`) is already the right
page: prefix it with `https://ascent-companion.vercel.app`. Never invent an
id; when you do not have one, link the job's Tracking Sheets page.

**A Tracking Sheet discrepancy gets both sides.** The fix is sometimes on the
sheet (a rate, a missing row, a formula) and sometimes in the app or JobTread (a
bill, a time entry, a pay type, a re-sync). Link the sheet AND the page for the
other side on every such line:

- bills: the bill(s) behind it (`/bill/<billId>?jobId=…` and the JobTread
  document), plus the job's Tracking Sheet sync page;
- labor: the job's Tracking Sheets board (`/trackingsheet?jobId=…&ym=…`, where
  time entries are approved, recoded and given a pay type) and the JobTread job;
- sheet-only problems (`#N/A`, a mislinked sheet): the sheet, plus the job's
  Tracking Sheet sync page where the sheet's link is set.

**Ascent's own items go last.** Office and Shop are never billed to anyone, so
list their items after every client's, under their own heading.

## Step 1 — pick the month

- `$ARGUMENTS` holds a `YYYY-MM` → use it.
- Otherwise run `agent.mjs schedule`. Use `due.ym` if set, else `currentYm`.

## Step 2 — get a fresh coded run

1. `agent.mjs read <ym>`. It prints a compact digest and saves the full run to
   `.monthly-check/<ym>.json`.
2. If `storedAt` is not today (local date), run `agent.mjs run <ym>`, wait for
   it (up to 5 minutes), then `read` again. A run filed earlier today (the
   app's 8 am scheduled run) is fresh enough.

Read `evidence.warnings` first, as the invoice-review skill says.

## Step 3 — claim the pass

`agent.mjs begin <ym> "Claude Code (Opus)"`. The page now says a pass is
running. A 409 means another pass is running: stop and say so.

From here on, if you cannot finish, run `agent.mjs fail <ym> "<reason>"` before
you stop. A pass left "running" blocks the month for an hour.

## Step 4 — chase the findings

Work every live `error` finding as invoice-review Step 3 describes. Then the
`warning` findings, as far as cheap evidence goes. Use these tools, read-only:

| Question | Tool |
|---|---|
| Does the bill exist under another vendor spelling, amount or job? Is one half a credit? | `mcp__claude_ai_JobTread_x_Ascent__query` |
| Is the email a real invoice? Does it carry a "Processed" / "Added to JT" label? | Gmail `search_threads`, `get_thread`, `get_message` |
| Is the backup PDF filed under another job? | Drive `search_files` for the amount (`"$1,234.56"`), `get_file_metadata` |
| Does a legacy client's Tracking Sheet match JobTread? | Step 4b — Google Sheets `get_values` |

Give each finding you looked at one verdict:

- `confirmed` — checked, and it is real.
- `probably-fine` — you found a benign explanation. `why` states it.
- `needs-human` — the evidence cannot settle it. `why` says what is missing.

`why`: one or two sentences with the concrete thing you found (document number,
date, amount, where). `suggestedAction`: one line, what the office does next.
Never change anything. Never record a ruling. A verdict is not a ruling.

## Step 4b — the legacy clients' Google Tracking Sheets

The sheets drift from JobTread. The usual causes: the sync missed a bill, a cost
code has no column or row on the sheet, a spreadsheet formula is broken, or the
Labor tab prices a code at a different rate than JobTread costed the hours. The
server does every comparison (`src/lib/invoiceReview/sheetCompare.ts`). You only
read the cells and post them. **Never add up sheet figures yourself.**

1. `agent.mjs tracking` lists each job with a sheet: `jtJobId`, `spreadsheetId`, label.
2. For each job, read with Google Sheets `get_values`:
   - `'Sub/Vendor Invoices'!A1:EZ150`
   - `'Labor'!A1:I80`
   - `'Tracking Sheet'!A7:FZ9` (the header rows)
   - `'Tracking Sheet'!A10:A300` (the code column)
3. Write `.monthly-check/<ym>.sheet.<jtJobId>.json` as
   `{ "jtJobId": "…", "headers": <the A7:FZ9 values> }`, then run
   `agent.mjs sheet-columns <ym> <that file>`. It answers which column letters
   hold LABOR and INVOICES for the CURRENT INVOICE block and the month's block.
4. Read each of those columns, rows 10–300 (for example `'Tracking Sheet'!EQ10:EQ300`).
5. Rewrite the same file with every read **copied verbatim** from the tool results
   (the `values` arrays, unchanged):

   ```json
   { "jtJobId": "…", "subVendor": [...], "labor": [...], "headers": [...],
     "codes": [...], "columns": { "EQ": [...], "EP": [...] }, "firstRow": 10 }
   ```

6. `agent.mjs sheet-check <ym> <that file>`. It prints the totals and each
   discrepancy with the JobTread bills behind it.
7. Before you report a discrepancy, re-read the one cell it names to rule out a
   copying slip.

What each kind means and what the office does:

| kind | Meaning | Fix |
|---|---|---|
| `not-synced` | JobTread's code total ≠ the sheet's A:C rows | Re-sync the job (Tracking Sheet page); if it persists, the bill line is the cause — name it |
| `uncoded-in-jt` | A JobTread line has no cost code | Code the line, then re-sync |
| `no-column` | Code has rows but no column in row 1 | Add the code's column |
| `column-total-off` | A code column's total ≠ its rows | Repair the column's FILTER/total formula |
| `not-on-tracking-tab` | Code has money but no row on the Tracking Sheet tab | Add the code's row |
| `tracking-tab-off` | A LABOR/INVOICES cell ≠ what feeds it | Fix that cell's lookup formula |
| `labor-hours-off` | Labor tab hours ≠ JobTread | Re-run the labor report; check entries coded or dated after it ran |
| `labor-rate-off` | Sheet rate ≠ the rate JobTread costed | Decide which is right: the sheet's code rate, or the person's pay rate on the entries |
| `labor-cost-off` | Same hours and rate, different total | Formula on that Labor row |
| `labor-row-math` / `labor-total-off` | A Labor row or its totals don't add up | Formula repair |
| `sheet-error` | A cell shows `#REF!`, `#N/A`, … | Formula repair |

A difference under $1 with matching hours is rounding; the server already ignores it.

## Step 5 — post it

Write the full report to `.monthly-check/<ym>.report.md`. The page shows it
above the findings list, and it is the only account of the month on the page —
**no summary section, no headline totals**. It is a list of things to do. Markdown:
`##` headings, `-` bullets, `|` tables, `**bold**`, `[text](url)` links.
Sections, in this order, each item one bullet with its fix link:

1. **To fix**: confirmed findings — what, job, amount, the action, the link.
2. **Tracking Sheets**: one table row per job (JobTread vs sheet, bills and
   labor), then each discrepancy with its fix and the link to the sheet or the
   job's Tracking Sheets page.
3. **Worth confirming**: `needs-human`, and `probably-fine` where the office
   should check your reading.
4. **False alarms**: one line per group, with the reason.
5. **Not checked**: what was skipped or partial.

Then write `.monthly-check/<ym>.verdicts.json`:

```json
{
  "model": "Claude Code (Opus)",
  "reportFile": ".monthly-check/<ym>.report.md",
  "dispositions": [
    { "key": "<finding.key>", "verdict": "confirmed", "why": "…", "suggestedAction": "… <link>" }
  ]
}
```

Follow the owner's standing instructions from the digest. Apply the
invoice-review rule on calling a month clean.

Then `agent.mjs finish <ym> .monthly-check/<ym>.verdicts.json`. It answers with
`saved` and `rejected`. A rejected key does not match the filed run; fix it and
post again.

## Step 6 — report

Reply with the "To fix" list, plus the link
`https://ascent-companion.vercel.app/invoice-review?ym=<ym>` where the owner
reads the full report and records rulings. When run on schedule, this reply goes
to `~/Library/Logs/ascent-monthly-check.log`, and the run's start and outcome
appear on the page under "Scheduled runs".

## The schedule

`scripts/monthly-check/install.sh` installs a launchd job (a macOS login item)
that calls `run.sh` hourly while the owner is logged in. `run.sh` asks the app
whether today is a review day (the 5th, the 8th, and daily from the 11th to send
day on the 15th). After 9 am it runs this skill once with `claude -p` on Opus.
`run.sh --now [YYYY-MM]` runs it immediately.
