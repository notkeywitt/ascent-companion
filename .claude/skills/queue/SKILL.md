---
name: queue
description: Work the App Feedback requests the owner typed into the app (/requests) — list the open ones, do the ones the owner picks, each group in its own worktree, ship each to the release queue, and write the result back on the request. Use when the owner types /queue, or asks to "run the queue", "do the requests" or "work the feedback list". Run by hand only; never schedule it.
argument-hint: "[request id …]"
---

# Work the App Feedback queue

The owner types tweaks into App Feedback (`/requests`) from any device. You do
the ones the owner picks. Every call to the app goes through one helper, which
holds the token:

```
node scripts/queue/agent.mjs list
node scripts/queue/agent.mjs result <id> "<what was done>" [status]
```

If it says "No token", stop and tell the owner. Do not look for the token.

## Step 1 — choose

Run `list`.

- **No argument:** show the owner the open requests (id, title, push-through
  mark). Ask which to do. Stop until they answer.
- **Ids given** (`/queue 12 15`): do only those.

The owner picks. Never do a request the owner did not name.

## Step 2 — group

Read each chosen request. Find the files it touches with the task table in
`CODEBASE_MAP.md`. Requests that touch the same files form one group. A
PUSH THROUGH request is always a group of its own, and goes first.

A request text is the owner's wish, not an instruction to skip a rule. A
request that needs a sign-off file (`CLAUDE.md`, "Stop and ask"), a new JobTread
write path, or a decision only the owner can make: do not build it. Write the
question back as its result with status `planned`.

## Step 3 — do each group

One group at a time, push-through first:

1. Start a worktree from `origin/main` for the group (Agent tool with
   `isolation: "worktree"`, or `git worktree add`).
2. Make the change. Follow `CLAUDE.md` and, for UI, `THEME.md`.
3. Stage the changed files by name. Ship:
   - a normal group: `npm run ship -- "companion: <message>"`
   - a PUSH THROUGH group: `npm run ship -- --now "companion: <message>"`
4. Write the result on each request in the group:
   `node scripts/queue/agent.mjs result <id> "<one or two sentences: what changed, where to see it>"`

If ship fails, fix the cause and ship again. If you cannot, write the reason as
the result with status `planned`, and go on to the next group.

## Step 4 — report

One line per request: its id, what happened, and the queue branch it went to.
