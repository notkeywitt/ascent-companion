#!/bin/sh
# Self-check for scripts/land.sh. Builds a throwaway remote with four queued
# branches, runs the lander against it with a stub `npm`, and asserts the result:
#
#   good      lands
#   now-fast  lands first, in a push of its own
#   clash     conflicts with main        → stuck/clash
#   broken    fails the (stub) typecheck → stuck/broken, and `good` still lands
#
#   sh scripts/land.test.sh
set -eu
land=$(cd "$(dirname "$0")" && pwd)/land.sh
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

git init -q --bare "$t/origin.git"
git clone -q "$t/origin.git" "$t/work" 2>/dev/null
cd "$t/work"
git checkout -q -b main
echo base >file && echo '{}' >package-lock.json
git add . && git commit -q -m base && git push -q origin main

branch() { # name file content
  git checkout -q -b "$1" main
  echo "$3" >"$2" && git add . && git commit -q -m "$1" && git push -q origin "$1:ready/$1"
}
branch good a ok
branch now-fast b ok
branch clash file theirs
branch broken BROKEN x
git checkout -q main
echo ours >file && git commit -q -am "main moved" && git push -q origin main

# Stub npm: typecheck fails while a file named BROKEN is in the tree.
mkdir "$t/bin"
printf '#!/bin/sh\n[ "$3" = typecheck ] && [ -e BROKEN ] && exit 1\nexit 0\n' >"$t/bin/npm"
chmod +x "$t/bin/npm"

git clone -q "$t/origin.git" "$t/runner"
cd "$t/runner"
PATH="$t/bin:$PATH" sh "$land" >"$t/out" 2>&1 || { cat "$t/out"; echo "FAIL: land.sh exited non-zero"; exit 1; }

cd "$t/origin.git"
fail() { cat "$t/out"; echo "FAIL: $1"; exit 1; }
git cat-file -e main:a || fail "good did not land"
git cat-file -e main:b || fail "now-fast did not land"
git cat-file -e main:BROKEN 2>/dev/null && fail "broken landed"
[ "$(git show main:file)" = ours ] || fail "clash changed main"
[ -z "$(git for-each-ref refs/heads/ready/)" ] || fail "ready/ is not empty"
git log -1 --format=%s stuck/clash | grep -q "conflicts with main in: file" || fail "stuck/clash has no reason"
git log -1 --format=%s stuck/broken | grep -q "fails typecheck" || fail "stuck/broken has no reason"
[ "$(git rev-parse stuck/broken~1)" = "$(git -C "$t/work" rev-parse broken)" ] || fail "stuck/broken~1 is not the original tip"
# now-fast merged before good: its merge commit is an ancestor of good's.
fast=$(git log --merges --format=%H --grep="land now-fast" main)
good=$(git log --merges --format=%H --grep="land good" main)
git merge-base --is-ancestor "$fast" "$good" || fail "now-fast did not land first"
grep '^- ' "$t/out"
echo "land.test: ok"
