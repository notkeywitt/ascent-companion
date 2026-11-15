#!/bin/sh
# UserPromptSubmit — a prompt that looks like a list of app changes (four or
# more non-empty lines, 400+ characters, not a slash command) gets one line of
# context pointing at the batch skill. Stdout goes into Claude's context.
node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let p = "";
  try { p = JSON.parse(s).prompt || ""; } catch { return; }
  if (p.trimStart().startsWith("/")) return;
  const lines = p.split("\n").filter((l) => l.trim()).length;
  if (lines >= 4 && p.length >= 400)
    console.log("This prompt may be a list of app changes. If it holds three or more separate changes, run the batch skill (.claude/skills/batch).");
});
'
exit 0
