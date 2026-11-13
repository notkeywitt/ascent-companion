#!/bin/sh
# land — merge the release queue onto main. Run by .github/workflows/lander.yml,
# one run at a time, on a full clone with main checked out.
#
# The queue is every ready/* branch. Express branches (ready/now-*) land first,
# in a batch of their own, and are pushed alone, so they deploy ahead of the
# rest. Then the rest land oldest first and push as one batch: one build here,
# one deploy on Vercel, however many tweaks it carries.
#
# Per batch: merge each branch, run typecheck, tests, build and lint ONCE, push.
# A branch that conflicts moves to stuck/<name> at once. When the batch fails a
# check, each branch is re-tried alone to find the one that broke it; that one
# moves to stuck/<name> and the rest still land. A stuck branch gets one empty
# commit on top whose message is the reason. Each push is atomic: main moves,
# and the landed ready/* branches are deleted, only if nobody pushed to them
# during the run.
set -u

git fetch -q --prune origin '+refs/heads/ready/*:refs/remotes/origin/ready/*' '+refs/heads/main:refs/remotes/origin/main'
git checkout -q -B main origin/main

RUN_URL="${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
refspecs=""
summary=""

say() {
  echo "$*"
  summary="$summary
- $*"
}

# Merge or commit as the person whose branch it is. Vercel can refuse to
# deploy a commit whose author is not on the team, and the bot is not.
as_author() {
  GIT_AUTHOR_NAME=$(git log -1 --format=%an "$1") GIT_AUTHOR_EMAIL=$(git log -1 --format=%ae "$1")
  GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL
  export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
}

failed=""
installed=$(git rev-parse HEAD) # the workflow ran `npm ci` on this commit
verify() {
  if ! git diff --quiet "$installed" HEAD -- package-lock.json; then
    npm ci --silent || { failed="npm ci"; return 1; }
    installed=$(git rev-parse HEAD)
  fi
  for step in typecheck test build lint; do
    if ! npm run -s "$step"; then
      failed=$step
      git reset -q --hard HEAD
      return 1
    fi
  done
  # A build can rewrite tracked config. The next merge needs a clean tree.
  git reset -q --hard HEAD
}

retire() { # name sha — delete ready/<name>, but only if it still points at sha
  refspecs="$refspecs --force-with-lease=refs/heads/ready/$1:$2 :refs/heads/ready/$1"
}

stuck() { # name sha reason
  as_author "$2"
  note=$(git commit-tree "$2^{tree}" -p "$2" -m "lander: stuck — $3")
  refspecs="$refspecs +$note:refs/heads/stuck/${1#now-}"
  retire "$1" "$2"
  say "stuck/${1#now-} — $3"
}

merge_one() { # name — merge origin/ready/<name> onto HEAD, or move it to stuck
  sha=$(git rev-parse "origin/ready/$1")
  as_author "$sha"
  git merge -q --no-ff -m "companion: land $1" "$sha" && return 0
  files=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
  git merge --abort
  stuck "$1" "$sha" "conflicts with main in: $files"
  return 1
}

land_batch() { # names…
  base=$(git rev-parse HEAD)
  merged=""
  for n in "$@"; do
    merge_one "$n" && merged="$merged $n"
  done
  [ -n "$merged" ] || return 0
  if verify; then
    for n in $merged; do retire "$n" "$(git rev-parse "origin/ready/$n")"; say "landed $n"; done
    return 0
  fi
  echo "land: the batch failed $failed — trying each branch alone"
  git reset -q --hard "$base"
  for n in $merged; do
    before=$(git rev-parse HEAD)
    merge_one "$n" || continue
    if verify; then
      retire "$n" "$(git rev-parse "origin/ready/$n")"
      say "landed $n"
    else
      git reset -q --hard "$before"
      stuck "$n" "$(git rev-parse "origin/ready/$n")" "fails $failed on top of main — see $RUN_URL"
    fi
  done
}

push() {
  [ -n "$refspecs" ] || return 0
  # shellcheck disable=SC2086 # refspecs is a word list on purpose
  git push --atomic origin HEAD:refs/heads/main $refspecs || { echo "land: push failed" >&2; exit 1; }
  refspecs=""
}

queue() { # names under ready/, oldest first
  git for-each-ref --sort=committerdate --format='%(refname:strip=4)' refs/remotes/origin/ready/
}

express=$(queue | grep '^now-')
rest=$(queue | grep -v '^now-')

# shellcheck disable=SC2086
if [ -n "$express" ]; then land_batch $express; push; fi
# shellcheck disable=SC2086
if [ -n "$rest" ]; then land_batch $rest; push; fi

[ -n "$summary" ] || summary="
- the queue was empty"
echo "$summary"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '### Lander\n%s\n' "$summary" >>"$GITHUB_STEP_SUMMARY"
exit 0
