#!/bin/sh
# ship — put this branch in the release queue.
#
#   npm run ship                       queue the committed work
#   npm run ship -- "companion: msg"   commit what is staged first, then queue
#   npm run ship -- --now ["msg"]      express lane: the lander deploys it alone, first
#
# Runs typecheck and tests (seconds), then pushes HEAD to ready/<name>. The
# lander (scripts/land.sh) merges the queue onto main, builds once and deploys.
# It never rebases and never pushes main, so two sessions never collide here;
# they meet only in the lander, which handles a conflict by moving that one
# branch to stuck/<name>.
set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ship: not inside a git repository" >&2
  exit 1
}

prefix=""
if [ "${1:-}" = "--now" ]; then
  prefix="now-"
  shift
fi
msg="${1:-}"

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "HEAD" ]; then
  echo "ship: detached HEAD — check out a branch first" >&2
  exit 1
fi
name=$(echo "$branch" | sed -e 's#^worktree-##' -e 's#^claude/##' -e 's#^ready/##' -e 's#^stuck/##' -e 's#^now-##' -e 's#/#-#g')

if [ "$(git config core.hooksPath 2>/dev/null)" != ".githooks" ]; then
  git config core.hooksPath .githooks
fi

if [ -n "$msg" ] && ! git diff --cached --quiet; then
  git commit -q -m "$msg" || { echo "ship: commit failed" >&2; exit 1; }
fi

# Ship only what is committed. Anything left over would be missing from the
# queue while the session believes it shipped.
if [ -n "$(git status --porcelain)" ]; then
  echo "ship: uncommitted changes — stage them by name and pass a message, or commit them first:" >&2
  git status --short >&2
  exit 1
fi

git fetch -q origin main 2>/dev/null
if [ "$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 1)" = "0" ]; then
  echo "ship: nothing to ship — main already has every commit on $branch"
  exit 0
fi

# A skill on the office Mac commits on local main (/weekly-summary). Queue it
# under its own name; local main fast-forwards once the lander has merged it.
[ "$name" = "main" ] && name="main-$(git rev-parse --short HEAD)"

npm run -s typecheck || { echo "ship: typecheck FAILED — not queued" >&2; exit 1; }
npm test --silent || { echo "ship: tests FAILED — not queued" >&2; exit 1; }

n=0
until git push -q origin "HEAD:refs/heads/ready/$prefix$name"; do
  n=$((n + 1))
  [ "$n" -ge 4 ] && { echo "ship: push failed — see the output above" >&2; exit 1; }
  sleep $((1 << n))
done
# A re-shipped stuck branch is no longer stuck. Fails quietly when there is none.
git push -q origin ":refs/heads/stuck/$name" 2>/dev/null
echo "ship: queued ready/$prefix$name — the lander merges and deploys it."
