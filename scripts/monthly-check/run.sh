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
  SCHEDULE="$(node "$HERE/agent.mjs" schedule 2>&1)" || {
    say "schedule check failed: $SCHEDULE"
    node "$HERE/agent.mjs" log error "The office Mac could not reach the app: ${SCHEDULE:0:300}" >/dev/null 2>&1 || true
    exit 1
  }
  YM="$(printf '%s' "$SCHEDULE" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.due?j.due.ym:"")})')"
  [ -z "$YM" ] && exit 0
fi

# Each start and outcome is posted to the app (/invoice-review shows them), so
# a failure is visible without this Mac's log file.
report() { node "$HERE/agent.mjs" log "$@" >/dev/null 2>&1 || true; }

CLAUDE="$(command -v claude || true)"
if [ -z "$CLAUDE" ]; then
  CLAUDE="$(ls -d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1)"
fi
if [ ! -x "$CLAUDE" ]; then
  say "Claude Code not found"
  report error "Claude Code was not found on the office Mac." "$YM"
  exit 1
fi

RUNLOG="$DIR/last-run.log"
mkdir -p "$DIR"
say "monthly check starting${YM:+ for $YM} ($CLAUDE)"
report started "Scheduled check started on the office Mac." "$YM"
cd "$REPO" || exit 1
"$CLAUDE" -p "/monthly-check ${YM}" \
  --model opus \
  --allowedTools \
    "Bash(node scripts/monthly-check/agent.mjs:*)" \
    "Read" "Grep" "Glob" \
    "Edit(./.monthly-check/**)" "Write(./.monthly-check/**)" \
    "mcp__jobtread__query" "mcp__claude_ai_JobTread_x_Ascent__query" \
    "mcp__claude_ai_Gmail__search_threads" "mcp__claude_ai_Gmail__get_thread" "mcp__claude_ai_Gmail__get_message" \
    "mcp__claude_ai_Google_Drive__search_files" "mcp__claude_ai_Google_Drive__get_file_metadata" \
    "mcp__claude_ai_Google_Drive__read_file_content" \
    "mcp__claude_ai_Google_Sheets__get_values" "mcp__claude_ai_Google_Sheets__get_spreadsheet" \
  2>&1 | tee "$RUNLOG"
STATUS=${PIPESTATUS[0]}

# Exit 0 is not proof: a headless run that hits a blocker can stop to ask a
# question and still exit 0, leaving the month claimed and nothing posted.
# Only a pass the app records as done counts. Anything else is released so
# the next hourly run can claim the month again.
if [ "$STATUS" -eq 0 ]; then
  PASS="$(node "$HERE/agent.mjs" pass "$YM" 2>/dev/null || echo unknown)"
  if [ "$PASS" != "done" ]; then
    [ "$PASS" = "running" ] && node "$HERE/agent.mjs" fail "$YM" "The run ended without posting its pass." >/dev/null 2>&1
    STATUS=3
  fi
fi

if [ "$STATUS" -eq 0 ]; then
  touch "$STAMP"
  say "monthly check finished"
  report done "Scheduled check finished." "$YM"
else
  say "monthly check failed (exit $STATUS); launchd tries again next hour"
  report error "Claude Code exited with code $STATUS. It tries again next hour." "$YM" "$RUNLOG"
fi
exit "$STATUS"
