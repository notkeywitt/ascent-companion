---
name: tool-batch
description: Fill in the details of tools from their photos — new tools captured with Batch add on the Tools page, and tools already on the list that the office asked Claude to update. Read each tool's photos (the tool, its serial plate, any extras, its current Drive photo), work out its name, type, tool group, serial number, accessories and condition, and write it to the Tools list. Runs on its own from the office Mac (scripts/tool-batch/), or from a prompt copied on the Tools page into any Claude Code session, phone included. Use when the owner types /tool-batch, pastes a tool-batch prompt, or asks to "analyze the tool batch", "fill in the batch tools" or "process the tool photos".
model: sonnet
argument-hint: "[itemId …]"
---

# Fill in tools from their photos

Field staff catalog tools fast on a phone: scan the QR sticker (or skip it),
photograph the tool, photograph its serial plate, add extra pictures. Nothing
else is typed. The office can also ask Claude to update a tool already on the
list. You read the photos and fill each tool in. The app writes it to the
Tools list.

Every tool is one of two modes:

- **ADD** — a new tool. The app creates it with your fields and its tool photo.
- **UPDATE** — a tool already on the list. You see its current fields. The app
  writes only the fields you fill in that differ from them. A blank field keeps
  the current value. A new tool photo, if one was taken, replaces the old one.

The app sets each tool's Location from the phone's GPS. Never write a location.

Every call to the app goes through one helper. It holds the token:

```
node scripts/tool-batch/agent.mjs <command> …
```

(If `node` is not found, prefix: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null;`)

## Step 1 — take the tools

The prompt you were given names the item ids, or says "all". Run:

```
node scripts/tool-batch/agent.mjs begin [itemId …]
```

No ids takes every waiting tool. It moves them to this run, downloads the
photos to `.tool-batch/<toolId>/<n>-<role>.jpg` and prints, per tool: its
`itemId`, `toolId`, mode, photo paths and, for UPDATE, the current fields and
`0-current.jpg` (its Drive photo, when it could be read). It also prints the
types, tool groups and conditions in use. `.tool-batch/run.json` holds the
same, plus `catalog.tools`: every listed tool's id, name, type and group.

If it says `0 tool(s)`, run `agent.mjs finish "Nothing waiting."` and stop.

**If it says "No token"** (a cloud session): stop and tell the owner to add
`REVIEW_AGENT_TOKEN` as an environment secret, and to allow the domain
`ascent-companion.vercel.app` in the environment's network settings, then start
a new session. A blocked network shows as a connection error on the same call.

## Step 2 — read each tool

Open every photo of the tool with Read. Then decide:

| Field | What to write |
|---|---|
| `name` | Brand, model and what it is, as the catalog writes names. Look at `catalog.tools` for the pattern (e.g. "DeWalt DCD791 20V Drill"). Include the model number when the plate shows it. Required for ADD. |
| `type` | One of the types in use, spelled exactly. Make a new type only when none fits, and say so in `note`. |
| `toolGroup` | One of the tool groups in use, or "" when unsure. |
| `serial` | The serial number exactly as printed (S/N, SER, Serial). Not the model number, not a date code. "" when the plate is missing or unreadable — never guess a character. |
| `accessories` | What is visibly with it: case, batteries, charger, blades, hoses. "" when nothing. |
| `condition` | One of the conditions in use, judged from the photos. "" when unsure. |
| `note` | One short line: anything the office should check (a serial you are unsure of, a new type). |

For UPDATE, fill a field only when the photos show something better than the
current value: a missing serial, a vague name made exact, a wrong type. Leave
a field "" to keep it. Never replace a readable current serial with a guess.

Do not change `toolId`. A `noqr-…` id means the QR scan was skipped; the
office replaces it later.

Park a tool instead of writing it when the photos do not show a tool, are too
blurred to name it, or there is nothing to read. Give the reason.

## Step 3 — write the results and submit

Write `.tool-batch/results.json`, one entry per tool:

```json
[
  { "itemId": "…", "fields": { "name": "…", "type": "…", "toolGroup": "…", "serial": "…", "accessories": "…", "condition": "…" }, "note": "…" },
  { "itemId": "…", "skip": "Tool photo is blurred; retake it." }
]
```

Then:

```
node scripts/tool-batch/agent.mjs submit .tool-batch/results.json
```

It writes each tool and prints which fields changed. A tool it could not write
(for example, an ADD whose id is already listed) is parked for the office with
the reason; do not retry it.

## Step 4 — close the run

```
node scripts/tool-batch/agent.mjs finish "N written, M parked"
```

It closes this run only. Any of this run's tools you did not report on is
parked as a problem. If something broke before Step 3, run
`agent.mjs fail "what broke"` instead; that hands this run's tools back.

Report in one short list: what was added or updated (toolId → name, the
changed fields), and what was parked and why.

## What you must not do

- Do not edit files outside `.tool-batch/`.
- Do not invent a serial number or a model number the photos do not show.
- Do not delete a tool, or change a tool this run was not given.
