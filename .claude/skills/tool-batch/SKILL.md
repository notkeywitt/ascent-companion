---
name: tool-batch
description: Fill in the details of tools captured with Batch add on the Tools page — read each tool's photos (the tool, its serial plate, any extras), work out its name, type, tool group, serial number, accessories and condition, and add it to the Tools list. Runs on its own from the office Mac (scripts/tool-batch/) when the office taps "Analyze Tools Batch" or captures go quiet. Use when the owner types /tool-batch, or asks to "analyze the tool batch", "fill in the batch tools" or "process the tool photos".
model: opus
---

# Fill in a tool batch

Field staff catalog tools fast on a phone: scan the QR sticker (or skip it),
photograph the tool, photograph its serial plate, add extra pictures. Nothing
else is typed. You read the photos and fill the tool in. The app then adds it
to the Tools list (Apps Script `createTool`) with its tool photo.

Every call to the app goes through one helper. It holds the token:

```
node scripts/tool-batch/agent.mjs <command> …
```

(If `node` is not found, prefix: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null;`)

## Step 1 — take the batch

```
node scripts/tool-batch/agent.mjs begin
```

It moves every waiting tool to this run, downloads the photos to
`.tool-batch/<toolId>/<n>-<role>.jpg` and prints, per tool, its `itemId`, its
`toolId` and its photo paths. It also prints the types, tool groups and
conditions already in use. `.tool-batch/run.json` holds the same, plus
`catalog.tools`: every existing tool's id, name, type and group.

If it says `0 tool(s)`, run `agent.mjs finish "Nothing waiting."` and stop.

## Step 2 — read each tool

Open every photo of the tool with Read. Then decide:

| Field | What to write |
|---|---|
| `name` | Brand, model and what it is, as the catalog writes names. Look at `catalog.tools` for the pattern (e.g. "DeWalt DCD791 20V Drill"). Include the model number when the plate shows it. |
| `type` | One of the types in use, spelled exactly. Make a new type only when none fits, and say so in `note`. |
| `toolGroup` | One of the tool groups in use, or "" when unsure. |
| `serial` | The serial number exactly as printed (S/N, SER, Serial). Not the model number, not a date code. "" when the plate is missing or unreadable — never guess a character. |
| `accessories` | What is visibly with it: case, batteries, charger, blades, hoses. "" when nothing. |
| `condition` | One of the conditions in use, judged from the photos. "" when unsure. |
| `note` | One short line: anything the office should check (a serial you are unsure of, a new type). |

Do not change `toolId`; the phone set it. A `noqr-…` id means the QR scan was
skipped; the office replaces it later.

Park a tool instead of adding it when the photos do not show a tool, are too
blurred to name it, or there is no tool photo. Give the reason.

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

It adds each tool and prints how each went. A tool it could not add (for
example, its id is already on the Tools list) is parked for the office, with
the reason; do not retry it.

## Step 4 — close the run

```
node scripts/tool-batch/agent.mjs finish "N added, M parked"
```

Any tool you did not report on is parked as a problem. If something broke
before Step 3, run `agent.mjs fail "what broke"` instead; that hands the tools
back to the queue.

Report in one short list: what was added (toolId → name), what was parked and why.

## What you must not do

- Do not edit files outside `.tool-batch/`.
- Do not invent a serial number or a model number the photos do not show.
- Do not delete or change an existing tool. This run only adds.
