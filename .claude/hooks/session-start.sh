#!/bin/sh
# SessionStart — tell a new session where it stands. Everything it prints goes
# into Claude's context. Everything it does is local: a config line and a fetch.
#
#   1. Arm the git hooks. A fresh clone has core.hooksPath unset, which
#      disarms the pre-push refusal of a direct push to main.
#   2. Fetch origin, so the queue and main are current.
#   3. A session in the main folder is told to enter a worktree (a private copy
#      of the repo folder) before it edits. The main folder is the owner's own.
#   4. Report the release queue, the stuck branches and the last landed work.
set -u

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

if [ "$(git config core.hooksPath 2>/dev/null)" != ".githooks" ]; then
  git config core.hooksPath .githooks 2>/dev/null
fi

# Bounded by the hook timeout, and never fatal: an offline start still works.
git fetch --quiet --prune origin 2>/dev/null

echo "<release-queue>"
# In a worktree the git dir is .git/worktrees/<name>; in the main folder it is .git.
if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ] && [ -z "${CLAUDE_CODE_REMOTE:-}" ]; then
  echo "This session started in the MAIN folder. Before you edit a tracked file, call EnterWorktree, then work and ship from that worktree. A skill that writes only its own files (/monthly-check, /tool-batch, /weekly-summary) stays here."
else
  echo "branch: $(git rev-parse --abbrev-ref HEAD)"
fi

stuck=$(git for-each-ref --format='  %(refname:strip=3) — %(contents:subject)' refs/remotes/origin/stuck/)
if [ -n "$stuck" ]; then
  echo "STUCK — the lander could not land these. Fix each one (CLAUDE.md, \"A stuck branch\"):"
  echo "$stuck"
fi

queued=$(git for-each-ref --format='  %(refname:strip=3)' refs/remotes/origin/ready/)
[ -n "$queued" ] && echo "queued, waiting for the lander:" && echo "$queued"

echo "last on main:"
git log --no-merges -n 6 --format='  %h %ad %s' --date=short origin/main 2>/dev/null
echo "to ship: npm run ship -- \"companion: <message>\" (queues the branch; the lander deploys it)"
echo "</release-queue>"
exit 0
