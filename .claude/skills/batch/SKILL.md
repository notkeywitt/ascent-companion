---
name: batch
description: Turn a long list of app changes (bugs, fixes, edits, new pages, questions) that the owner pastes or types into this session into ONE release — group the items, send each group to a subagent on the model it needs, merge every group onto one branch, and ship it as one deploy. Use whenever the owner's message holds three or more separate app changes, even with no command (a pasted list, numbered or not, one change per paragraph). Also for /batch. Not for App Feedback requests typed in the app — that is /queue.
argument-hint: "<the list>"
---

# A list of changes, one deploy

The owner dumps many changes at once. You plan, dispatch, merge and ship. The
subagents write the code. The whole list ships as ONE `npm run ship`, so it
lands as one Vercel deploy.

## Step 1 — the batch worktree

If the session is in the main folder, call `EnterWorktree` with the name
`batch-<YYYY-MM-DD>`. This worktree is the batch branch. Every group merges into
it. Note its branch name (`git rev-parse --abbrev-ref HEAD`).

## Step 2 — split the list

Number every item in the owner's order. Keep the owner's words. Tag each one:

| Tag | Meaning | Who does it |
|---|---|---|
| change | Code change | a group (Step 3) |
| question | "Why does X…", "is Y…" | you, in Step 5, read-only |
| sign-off | Touches a "Stop and ask" file, a NEW JobTread write path, or a schema change | not built — ask in the report |
| decision | Two reasonable readings that give different results | build the likely reading; name the other in the report |

A change that only reuses an existing write route is not sign-off.

## Step 3 — group

Read the "Task → where to look" table in `CODEBASE_MAP.md`. For each change,
name the files it touches. When the table does not answer it, send ONE Haiku
`Explore` agent for every unplaced item at once. Do not search file by file.

Rules:

- Items that touch the same file go in one group.
- An item that restructures what another item edits goes in the same group, or
  in a later wave.
- An item that spans many pages ("every page…") goes in a LAST wave, split by
  page cluster, and starts from the merged batch branch.
- Keep each wave to 7 groups or fewer. Merge small groups into a neighbour.

Choose each group's model by its hardest item:

| Model | Use for |
|---|---|
| `haiku` | Labels, links, removing an item, one-file copy or spacing |
| `sonnet` | Multi-file UI on existing patterns, layout, a page that copies another page's look, sorting and filtering |
| `opus` | A new page or data flow, a canvas or chart, an interaction with real design choices, anything subtle about money or time data |

Show the owner the plan as one table: group, items, files, model, wave. Then
go on. Do not wait for an answer.

## Step 4 — dispatch

Send every group of a wave in ONE message: one `Agent` call per group, with
`isolation: "worktree"`, `model` from the table, `run_in_background: true`.
Use this prompt, filled in:

```
You are making one group of app changes in the Ascent companion repo.
Work only in your worktree. Do NOT run `npm run ship`, do not push, do not
merge into any other branch.

First: git fetch -q origin && git checkout -B batch/<group-slug> <BASE>
(<BASE> is origin/main for wave 1, or the batch branch <batch-branch> for a
later wave.)

Read CLAUDE.md. For UI read the "Rules for writing UI" section of THEME.md.
Read the CODEBASE_MAP.md task table rows for these files: <files>.

The owner's items, verbatim:
<items>

Notes from the planner: <readings chosen, files, what other groups own — do not
edit those files unless you must, and say so>

Rules: no new JobTread write path (reuse existing routes only); no edits to
src/auth.ts, src/middleware.ts, src/lib/config.ts, src/lib/paveGateway.ts; no
schema change. If an item needs one, build the rest and report what is missing.
Desktop pages get a real wide layout, not a stretched phone layout.

Finish: npm run typecheck && npm test. Fix failures. Then stage your files by
name and commit: "companion: <what this group did>" with the Co-Authored-By
trailer. Report: branch name, commit sha, files changed, each item done / partly
done / not done with one line why.
```

While the agents run, answer the question items yourself (Step 5).

## Step 5 — questions

Read the code and the live data (the `jobtread` query tool is read-only) to
answer each question. If the answer is a bug, fix it in the batch worktree
yourself when it is small, or name it in the report.

## Step 6 — merge

When a wave's agents finish, in the batch worktree:

```
git merge --no-ff -m "companion: batch merge <group-slug>" batch/<group-slug>
```

Resolve each conflict by keeping both groups' intent. Then start the next wave.
After the last wave:

```
git merge origin/main
npm run typecheck && npm test && npm run build
```

Then lint. `npm run lint` lints nothing inside `.claude/worktrees`, and the
lander fails a batch on one lint error. Lint the changed files by name:

```
git diff --name-only --diff-filter=AM origin/main...HEAD -- 'src/*.ts' 'src/*.tsx' > files.txt
npx eslint --no-ignore --quiet <each file in files.txt>
```

Fix what fails. A worktree-isolated session cannot remove the agents'
worktrees. List their paths in the report; the owner clears them with
`git worktree prune` after removing the folders, or leaves them.

A later wave whose files do not overlap a still-running group may start
before that group finishes. Start it from the batch branch as merged so far.

## Step 7 — look, then ship once

Start `npm run dev` in the background in the batch worktree. Give the owner the
address. Ship when the owner says "ship it", or at once when the list itself
said to ship:

```
npm run ship -- "companion: batch — <short list of what changed>"
```

The worktree holds only merge commits, so nothing needs staging. One ship, one
deploy. Use `--now` only when the owner asked to push through.

`ship` only queues. Before you tell the owner it is live, check that it landed:
`git fetch origin && git merge-base --is-ancestor HEAD origin/main`. If the
branch shows under `stuck/`, read the lander run it names, fix, and ship again.

## Step 8 — report

One table: item number, the owner's words (short), done / partly / not built,
one line on where to see it or why not. Then the answers to the questions. Then
the sign-off and decision items, each as one question.
