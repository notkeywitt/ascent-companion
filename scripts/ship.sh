#!/bin/sh
# ship — end a session: rebase onto live main, verify, push, close the ledger.
#
# `main` is production. Roughly forty commits a day land on it, so a branch cut
# an hour ago is already behind, and a straight `git push` is what turns into
# the conflict. This does the four steps in the order that avoids that, every
# time, so the order never has to be remembered:
#
#   1. commit whatever the ledger has staged
#   2. fetch + rebase onto origin/main   ← the conflict, resolved before the push
#   3. regenerate SESSIONS.md, mark the session shipped
#   4. push HEAD:main, retrying a network failure, rebasing a rejected push
#
# It does NOT run typecheck and build itself — .githooks/pre-push does that on
# every push to main, and running them twice doubles the slowest step. If the
# hook is not armed, this arms it first.
#
#   npm run ship
#
# Nothing here force-pushes or rewrites history that is already on origin.
set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ship: not inside a git repository" >&2
  exit 1
}

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "HEAD" ]; then
  echo "ship: detached HEAD — check out a branch first" >&2
  exit 1
fi

echo "ship: $branch → origin/main"

# The pre-push gate is the only thing between a bad commit and field staff, and
# a fresh clone has it disarmed.
if [ "$(git config core.hooksPath 2>/dev/null)" != ".githooks" ]; then
  git config core.hooksPath .githooks
  echo "ship: armed .githooks (pre-push typecheck + build)"
fi

ledger=$(node scripts/session.mjs path 2>/dev/null || true)

# ── 1. commit the ledger ────────────────────────────────────────────────────
# post-commit stages each entry but cannot commit it. Anything left is this
# session's own record, and it must travel with the work.
if [ -n "$ledger" ] && ! git diff --quiet -- "$ledger" 2>/dev/null; then
  git add -- "$ledger"
fi
if [ -n "$ledger" ] && ! git diff --cached --quiet -- "$ledger" 2>/dev/null; then
  SESSION_LEDGER_SKIP=1 git commit -q --only -m "companion: log session $(basename "$ledger" .md)" -- "$ledger" \
    || { echo "ship: could not commit the session ledger" >&2; exit 1; }
  echo "ship: committed the session ledger"
fi

# ── 2. a clean tree, then rebase ────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "ship: the working tree has uncommitted changes — commit or stash them first:" >&2
  git status --short >&2
  exit 1
fi

n=0
until git fetch origin main; do
  n=$((n + 1))
  [ "$n" -ge 4 ] && { echo "ship: could not fetch origin/main" >&2; exit 1; }
  sleep $((1 << n))
done

behind=$(git rev-list --count HEAD..origin/main)
if [ "$behind" != "0" ]; then
  echo "ship: rebasing onto origin/main (+$behind)"
  if ! git rebase origin/main; then
    # SESSIONS.md is generated from the session files, so a conflict in it is
    # never a real disagreement — regenerate and carry on. Any other conflict
    # is a genuine one and stays for a human (or Claude) to resolve.
    conflicts=$(git diff --name-only --diff-filter=U)
    if [ "$conflicts" = "SESSIONS.md" ]; then
      node scripts/session.mjs board --write >/dev/null
      git add SESSIONS.md
      GIT_EDITOR=true git rebase --continue >/dev/null 2>&1 \
        || { echo "ship: rebase still blocked — resolve it, then run ship again" >&2; exit 1; }
      echo "ship: regenerated SESSIONS.md through the rebase"
    else
      echo "ship: rebase conflict — resolve these, \`git rebase --continue\`, then run ship again:" >&2
      echo "$conflicts" >&2
      exit 1
    fi
  fi
fi

# ── 3. close the ledger on top of live main ─────────────────────────────────
if [ -n "$ledger" ]; then
  node scripts/session.mjs set status shipped >/dev/null
  ledger=$(node scripts/session.mjs path)
fi
node scripts/session.mjs board --write >/dev/null
git add -- SESSIONS.md ${ledger:+"$ledger"}
if ! git diff --cached --quiet; then
  SESSION_LEDGER_SKIP=1 git commit -q -m "companion: close session $(basename "${ledger:-session}" .md)"
fi

# ── 4. push ─────────────────────────────────────────────────────────────────
# Branch → remote main directly. Merging into a local `main` first is what
# breaks in an ephemeral container, where the local ref is stale or unrelated.
#
# Three ways a push fails, and only one of them is worth retrying:
#   · the pre-push gate said no  → a real failure; retrying just rebuilds it
#   · the remote moved           → rebase once, push again
#   · the network                → back off and retry
log=$(mktemp)
trap 'rm -f "$log"' EXIT
n=0
while :; do
  # Captured, not piped: a pipeline's exit status is `tee`'s, so the push's own
  # failure would be swallowed and every push would look like it worked.
  if git push origin "HEAD:main" >"$log" 2>&1; then
    cat "$log"
    echo "ship: pushed — $(git rev-parse --short HEAD) is deploying to production"
    exit 0
  fi
  cat "$log" >&2

  if grep -qE "pre-push|hook declined" "$log"; then
    echo "ship: the pre-push gate blocked this push — fix what it reported, then run ship again" >&2
    exit 1
  fi

  if [ "$n" -eq 0 ] && grep -qiE "rejected|non-fast-forward|fetch first" "$log"; then
    echo "ship: main moved — rebasing and retrying"
    git fetch origin main && git rebase origin/main || {
      echo "ship: rebase conflict on retry — resolve it, then run ship again" >&2
      exit 1
    }
    n=1
    continue
  fi

  n=$((n + 1))
  [ "$n" -ge 5 ] && { echo "ship: push failed — see the output above" >&2; exit 1; }
  echo "ship: push failed — retrying in $((1 << n))s"
  sleep $((1 << n))
done
