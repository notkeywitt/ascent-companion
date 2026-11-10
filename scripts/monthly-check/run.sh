#!/bin/bash
# The launchd job's entry point. launchd calls it hourly and at login.
#
# On a review day (the app's own schedule: 5th, 8th, 11th to send day) it runs
# the /monthly-check skill once, headless, in Claude Code on Opus. Nothing
# happens before 9 am, so the app's own 8 am run is on file first.
#
#   run.sh            what launchd runs
#   run.sh --now      run now: ignore the schedule, the hour and today's stamp
#   run.sh --now YYYY-MM   same, for one billing month
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DIR="$HOME/.ascent-monthly-check"
TODAY="$(date +%F)"
STAMP="$DIR/done-$TODAY"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

say() { echo "$(date '+%F %T') $*"; }

FORCE=""
YM=""
if [ "${1:-}" = "--now" ]; then FORCE=1; YM="${2:-}"; fi

if [ -z "$FORCE" ]; then
  [ -f "$STAMP" ] && exit 0
  [ "$(date +%H)" -lt 9 ] && exit 0
  SCHEDULE="$(node "$HERE/agent.mjs" schedule 2>&1)" || { say "schedule check failed: $SCHEDULE"; exit 1; }
  YM="$(printf '%s' "$SCHEDULE" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.due?j.due.ym:"")})')"
  [ -z "$YM" ] && exit 0
fi

CLAUDE="$(command -v claude || true)"
if [ -z "$CLAUDE" ]; then
  CLAUDE="$(ls -d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1)"
fi
[ -x "$CLAUDE" ] || { say "Claude Code not found"; exit 1; }

say "monthly check starting${YM:+ for $YM} ($CLAUDE)"
cd "$REPO" || exit 1
"$CLAUDE" -p "/monthly-check ${YM}" \
  --model opus \
  --allowedTools \
    "Bash(node scripts/monthly-check/agent.mjs:*)" \
    "Read" "Grep" "Glob" \
    "Write(./.monthly-check/**)" \
    "mcp__claude_ai_JobTread_x_Ascent__query" \
    "mcp__claude_ai_Gmail__search_threads" "mcp__claude_ai_Gmail__get_thread" "mcp__claude_ai_Gmail__get_message" \
    "mcp__claude_ai_Google_Drive__search_files" "mcp__claude_ai_Google_Drive__get_file_metadata" \
    "mcp__claude_ai_Google_Drive__read_file_content"
STATUS=$?

if [ $STATUS -eq 0 ]; then
  mkdir -p "$DIR" && touch "$STAMP"
  say "monthly check finished"
else
  say "monthly check failed (exit $STATUS); launchd tries again next hour"
fi
exit $STATUS
