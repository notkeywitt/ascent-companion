#!/bin/bash
# The launchd job's entry point: every 10 minutes and at login.
#
# Asks the app whether a batch analysis is due (the Analyze Tools Batch button,
# or captures that have gone quiet for 30 minutes). If so, it runs the
# /tool-batch skill once, headless, in Claude Code on Sonnet. One HTTP call when idle.
#
#   run.sh         what launchd runs
#   run.sh --now   run the skill now, whatever the app says
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DIR="$HOME/.ascent-tool-batch"
mkdir -p "$DIR"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

say() { echo "$(date '+%F %T') $*"; }

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
say "tool batch starting ($CLAUDE)"
cd "$REPO" || exit 1
"$CLAUDE" -p "/tool-batch" \
  --model sonnet \
  --allowedTools \
    "Bash(node scripts/tool-batch/agent.mjs:*)" \
    "Read" "Glob" \
    "Write(./.tool-batch/**)" \
  2>&1 | tee "$RUNLOG"
STATUS=${PIPESTATUS[0]}

if [ "$STATUS" -ne 0 ]; then
  say "tool batch failed (exit $STATUS)"
  # Hands any tool still being analyzed back to the queue; the timer retries later.
  node "$HERE/agent.mjs" fail "Claude Code exited with code $STATUS on the office Mac." >/dev/null 2>&1 || true
else
  say "tool batch finished"
fi
exit "$STATUS"
