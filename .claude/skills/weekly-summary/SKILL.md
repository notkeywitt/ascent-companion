---
name: weekly-summary
description: Draft the weekly Office summary email for Casey and Ty from the week's office mail, JobTread bills and invoices, and other office sources, and save it as a Gmail draft in the office account. Also learns from the office manager's edits to that draft. Use when the user types /weekly-summary, says "weekly summary", "office summary", "draft the week", or "learn from my edits" / "review my summary edits".
---

# Weekly Office summary

One email a week from the office to **Casey Zautke** (`casey@ascentbuildingco.com`)
and **Ty O'Steen** (`ty@ascentbuildingco.com`). Claude writes a rough draft into
the office Gmail as a **draft**. Keillor edits it there and sends it. Claude then
reads the edits and records what changed, so next week's draft starts closer.

Two modes. Pick one from what the user typed:

| User types | Mode |
|---|---|
| `/weekly-summary`, "draft the week", "weekly summary" | **Draft** |
| `/weekly-summary learn`, "learn from my edits", "review my summary edits" | **Learn** |
| `/weekly-summary 2026-11-02` (a date) | **Draft** for the week that holds that date |

**Never send the email.** Create a Gmail draft only. Keillor sends it.

## Files this skill owns

| File | What it holds | Who writes it |
|---|---|---|
| `preferences.md` | The house style: sections, order, tone, what to leave out. **Read it first, every run.** It overrides any default below. | Learn mode |
| `drafts/<week-end>-claude.md` | The draft exactly as Claude wrote it. Learn mode diffs against it. | Draft mode |
| `drafts/<week-end>-final.md` | The email as Keillor sent it (or left it). | Learn mode |

`<week-end>` is the Saturday that closes the week, `YYYY-MM-DD`.

## The week

Monday 00:00 to Saturday 23:59, Pacific. With no date given, use the most recent
**completed** Monday–Saturday. Gmail's `before:` is exclusive, so search
`after:<Mon> before:<Sun>`. JobTread `createdAt` is UTC: Pacific midnight is
`08:00Z` (`07:00Z` before the first Sunday of November).

## Draft mode

### 1. Read the style

Read `preferences.md`. Read the two newest `drafts/*-final.md` files for tone.

### 2. Collect

Run the reads in parallel. Each source feeds named sections.

| Source | Tool | Feeds |
|---|---|---|
| Office mail, the week | Gmail `search_threads` with `after:/before:` and `-category:promotions -category:social`, `THREAD_VIEW_SUMMARY`, page until no `nextPageToken`. Read in full (`get_thread`, `PLAIN_TEXT`) only the threads that a section needs. | every section |
| Bills and invoices created this week | JobTread `query`: `documents` with `createdAt` in the week, nodes `type name number status cost price issueDate job{name number} account{name}`. Map job numbers to customers through `jobs{ location{ account{name} } }`. A second query with `count` and `sum` gives totals; do not add numbers by hand. | Billing, Invoicing |
| Requisitions | Not reachable from a Claude Code session today (Apps Script web app behind the app's sign-in). Write one line under Requisitions: "Not checked — open /requisitions." unless the user pastes the list. | Requisitions |
| Signal chats | Not reachable from a Claude Code session today (messages live in the companion DB, sent by the office Mac mini). Same treatment as requisitions. If the user pastes an export, use it. | any section |
| Calendar, next week | Google Calendar `list_events` on the office calendar, Mon–Sat after the summary week. Only meetings Casey or Ty attend. | Coming up |

Status words in JobTread: `denied` **is** a voided bill. Never call it "deleted"
or "rejected".

### 3. Sort into sections

Default sections, in this order. `preferences.md` wins where it differs.
Drop a section that has nothing in it. Do not write "Nothing this week".

1. **Needs you** — decisions or replies Casey or Ty owe. Name who. Max 5 items.
2. **Billing (vendor bills in)** — count and total of bills entered, the large
   ones (≥ $2,500) by vendor, job and amount, bills voided and re-entered and
   why, invoices that arrived but are not in JobTread yet, invoices still
   requested from vendors.
3. **Invoicing (to clients)** — client invoices and change orders drafted or
   sent, by customer and job. Billing-cycle status (the 10th cutoff, the 15th send).
4. **Leads** — new inquiries: name, place, scope, budget/start if given, who
   replied.
5. **Requisitions** — new, ordered, received.
6. **People & payroll** — payroll run, time entries, new hires, insurance and
   benefits paperwork.
7. **Office upkeep** — snacks, coffee, supplies, equipment, subscriptions,
   renewals.
8. **Systems** — Apps Script failures, app issues, AscentBot questions it
   could not answer. One line each.
9. **Coming up** — next week's dates and deadlines.

Leave out: marketing mail, newsletters, vendor receipts already captured as
bills, personal mail, verification codes, spam pitches.

### 4. Write

- Plain, short, scannable. Bullets, not paragraphs. One fact per bullet.
- Lead each bullet with the job or vendor name in bold.
- Amounts as `$1,234.56`. Jobs as "Customer — Job" (e.g. "Moon Spring — Pole Barn").
- Open with one line: the week's dates. Close with `-Keillor`.
- Mark anything uncertain with `(check)` rather than guessing.

### 5. Save and draft

1. Write the body as Markdown to `drafts/<week-end>-claude.md`. Top line:
   `<!-- gmail-draft-id: <id> -->` once you have the id (step 3).
2. Convert to simple HTML (`<h3>`, `<ul>`, `<li>`, `<b>`; no CSS, no colours).
3. Gmail `create_draft`: to Casey and Ty, subject
   `Office Weekly Summary — <Mon Mon-DD>–<Sat Mon-DD>, <YYYY>`, `htmlBody` plus a
   plain-text `body`, `includeSignature: false`.
4. Put the draft id on the first line of the `-claude.md` file.
5. Commit the `-claude.md` file and push (see "Saving" below).
6. Reply with the draft link and a list of what you could not check.

## Learn mode

1. Find the newest `drafts/*-claude.md` that has no matching `-final.md`.
2. Find Keillor's version, in this order:
   - Sent mail: `in:sent subject:"Office Weekly Summary"` in the week after
     `<week-end>`. Read it with `get_thread` (`PLAIN_TEXT`).
   - Else the draft by id (`get_draft`, `PLAIN_TEXT`) — it is still unsent.
   - Else ask the user.
3. Save Keillor's version to `drafts/<week-end>-final.md`.
4. Compare the two. List each change as one of:
   - **Cut** — what was removed. Ask: is this a kind of item to leave out every week?
   - **Added** — what Keillor added that Claude missed. Ask: which source holds it?
   - **Reworded** — tone, length, names, format.
   - **Moved** — section order or which section an item belongs in.
5. Turn each change that is a **pattern**, not a one-off fact, into a rule in
   `preferences.md` under the right heading. A rule says what to do, in one line.
   Example: "Do not list Sunset receipts one by one; give the count and total."
   Skip changes that are only this week's facts.
6. Add one dated line to the `## Changelog` in `preferences.md` naming the rules
   added or changed.
7. Show the user the new rules and ask "Keep these?" before you commit.
   Edit as told. Then commit and push.

A rule that contradicts an older rule replaces it. Keep `preferences.md` under
80 lines; merge rules that overlap.

## Saving

These files are docs, not app code, but `main` is production and the push hook
runs the full checks. Stage only this skill's files by name:

```
git add .claude/skills/weekly-summary/preferences.md .claude/skills/weekly-summary/drafts/<file>
git commit -m "companion: weekly summary <draft|learn> <week-end>"
npm run ship
```

If `npm run ship` fails for a reason outside these files, leave the commit
local and tell the user.
