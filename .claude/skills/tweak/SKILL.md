---
name: tweak
description: Make one small change to the app with the least reading — a label, a spacing fix, a link, a colour, a one-file bug. Use when the owner types /tweak followed by the change. Not for a new page, a new route, a schema change or anything on the "Stop and ask" list in CLAUDE.md.
model: sonnet
argument-hint: "<the change>"
---

# One small change

1. If the session is in the main folder, call EnterWorktree.
2. Find the file. Read only the "Task → where to look" table in
   `CODEBASE_MAP.md`. For a UI change, also read "Rules for writing UI" in
   `THEME.md`. Read nothing else unless the change does not make sense without it.
3. Make the change. Shortest diff that works.
4. Run `npm run typecheck`.
5. Tell the owner to look: `npm run dev` prints the address.
6. When the owner says to ship: stage the changed files by name, then
   `npm run ship -- "companion: <message>"`.

Stop and say so when the change turns out to need more than two files, a new
route, a schema change, or a file on the "Stop and ask" list. That is a normal
session, not a tweak.
