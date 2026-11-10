---
name: monthly-check
description: Run the COMPLETE monthly invoice check on Opus in Claude Code — make sure the month has a fresh coded run in the app (JobTread + Drive + mailbox), chase every finding with the JobTread, Gmail and Drive tools, then post a verdict per finding and the month's reading back to the app's /invoice-review page. Runs on its own on review days from the office Mac (scripts/monthly-check/). Use when the owner types /monthly-check, or asks to "run the monthly check", "run the full invoice check", or "check the month on Opus".
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

Give each finding you looked at one verdict:

- `confirmed` — checked, and it is real.
- `probably-fine` — you found a benign explanation. `why` states it.
- `needs-human` — the evidence cannot settle it. `why` says what is missing.

`why`: one or two sentences with the concrete thing you found (document number,
date, amount, where). `suggestedAction`: one line, what the office does next.
Never change anything. Never record a ruling. A verdict is not a ruling.

## Step 5 — post it

Write `.monthly-check/<ym>.verdicts.json`:

```json
{
  "model": "Claude Code (Opus)",
  "note": "<the month's reading>",
  "dispositions": [
    { "key": "<finding.key>", "verdict": "confirmed", "why": "…", "suggestedAction": "…" }
  ]
}
```

`note` is what the page shows as "Claude Code's reading". Six lines at most,
plain words, readable on a phone. Lead with how many things to fix and the
dollars in question. Then the worst items, one per line. Say what was NOT
checked (`emailChecked` false, `mailTruncated`, evidence warnings). Follow the
owner's standing instructions from the digest. Apply the invoice-review rule on
calling a month clean.

Then `agent.mjs finish <ym> .monthly-check/<ym>.verdicts.json`. It answers with
`saved` and `rejected`. A rejected key does not match the filed run; fix it and
post again.

## Step 6 — report

Reply with the same reading, plus the link
`https://ascent-companion.vercel.app/invoice-review?ym=<ym>` where the owner
records rulings. When run on schedule, this reply goes to
`~/Library/Logs/ascent-monthly-check.log`.

## The schedule

`scripts/monthly-check/install.sh` installs a launchd job (a macOS login item)
that calls `run.sh` hourly while the owner is logged in. `run.sh` asks the app
whether today is a review day (the 5th, the 8th, and daily from the 11th to send
day on the 15th). After 9 am it runs this skill once with `claude -p` on Opus.
`run.sh --now [YYYY-MM]` runs it immediately.
