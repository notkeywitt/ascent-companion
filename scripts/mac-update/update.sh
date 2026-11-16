#!/bin/bash
# Keeps this Mac's repo copy on the newest main, so the scripts launchd runs
# (scripts/*/run.sh) change when a change ships. launchd runs it every 10
# minutes and at login. It reports what it did to the AI Scripts page.
#
# It only ever fast-forwards, and it skips (and says why on the page) when:
#   - the folder is not on main (someone is working on a branch here),
#   - a tracked file has edits nobody committed,
#   - a script is running (bash reads a script as it goes; changing run.sh
#     under a running copy can break that run),
#   - main here has commits origin does not (it never merges or rebases).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

say() { echo "$(date '+%F %T') $*"; }
report() { node "$REPO/scripts/agent-progress/agent-run.mjs" code "$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" "$1" >/dev/null 2>&1 || true; }

cd "$REPO" || exit 1

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
if [ "$BRANCH" != "main" ]; then
  say "skipped: on branch $BRANCH, not main"
  report "not updated: the folder is on branch $BRANCH"
  exit 0
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  say "skipped: uncommitted edits"
  report "not updated: the folder has uncommitted edits"
  exit 0
fi
if pgrep -f "scripts/[a-z0-9-]+/run\.sh" >/dev/null 2>&1; then
  say "skipped: a script is running"
  report "waiting: a script is running"
  exit 0
fi

if ! git fetch -q origin main 2>/dev/null; then
  say "fetch failed"
  report "not updated: could not reach GitHub"
  exit 0
fi
BEFORE="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$(git rev-parse origin/main)" ]; then
  report "up to date"
  exit 0
fi
if git merge -q --ff-only origin/main 2>/dev/null; then
  say "updated ${BEFORE:0:7} -> $(git rev-parse --short HEAD)"
  report "updated from ${BEFORE:0:7} $(date '+%b %-d %H:%M')"
else
  say "skipped: main here has commits origin does not"
  report "not updated: this copy of main has its own commits"
fi
exit 0
