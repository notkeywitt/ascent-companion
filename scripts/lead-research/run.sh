#!/bin/bash
# The launchd job's entry point: every 2 minutes and at login.
#
# Asks the app whether a lead is waiting for research (the Research button on
# /leads). If so, it runs the /lead-research skill once, headless, in Claude
# Code (Sonnet unless /ai-scripts says otherwise). One HTTP call when idle. Any Mac with this installed can take
# the run (the office Mac mini, the owner's MacBook); the app gives each run
# to the first Mac that claims it.
#
#   run.sh         what launchd runs
#   run.sh --now   run the skill now, whatever the app says
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PROGRESS="$REPO/scripts/agent-progress/agent-run.mjs"
DIR="$HOME/.ascent-lead-research"
LOCK="$DIR/lock"
mkdir -p "$DIR"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

say() { echo "$(date '+%F %T') $*"; }

# One run at a time on this Mac. A lock older than 3 hours is a dead run's.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then
    rm -rf "$LOCK" && mkdir "$LOCK"
  else
    exit 0
  fi
fi
trap 'rm -rf "$LOCK"' EXIT

# The AI Scripts page (/ai-scripts): paused, Run now, or carry on.
STATE="$(node "$PROGRESS" check lead-research)"
case "$STATE" in
  paused) exit 0 ;;
  now*) set -- --now ;;
esac

if [ "${1:-}" != "--now" ]; then
  DUE="$(node "$HERE/agent.mjs" due 2>&1)" || { say "due check failed: $DUE"; exit 1; }
  case "$DUE" in
    *'"due":true'*) ;;
    *) exit 0 ;;
  esac
fi

CLAUDE="$(command -v claude || true)"
if [ -z "$CLAUDE" ]; then
  CLAUDE="$(ls -d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1)"
fi
if [ ! -x "$CLAUDE" ]; then
  say "Claude Code not found"
  exit 1
fi

RUNLOG="$DIR/last-run.log"
say "lead research starting ($CLAUDE)"
cd "$REPO" || exit 1
rm -f .lead-research/run.json
# agent-run.mjs applies the page's model, instructions and max turns, and
# reports each step live. --model here is only the fallback.
node "$PROGRESS" run lead-research -- "$CLAUDE" -p "/lead-research" \
  --model sonnet \
  --allowedTools \
    "Bash(node scripts/lead-research/agent.mjs:*)" \
    "Read" "Glob" "Grep" \
    "Write(./.lead-research/**)" \
    "WebSearch" "WebFetch" \
  2>&1 | tee "$RUNLOG"
STATUS=${PIPESTATUS[0]}

if [ "$STATUS" -ne 0 ]; then
  say "lead research failed (exit $STATUS)"
  # Tells the office the run stopped; they can tap Research again.
  if [ "$STATUS" -eq 130 ]; then WHY="Stopped from the AI Scripts page."; else WHY="Claude Code exited with code $STATUS on $(hostname -s)."; fi
  [ -f .lead-research/run.json ] && node "$HERE/agent.mjs" fail "$WHY" >/dev/null 2>&1 || true
else
  say "lead research finished"
fi
exit "$STATUS"
