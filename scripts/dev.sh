#!/bin/sh
# dev — start the dev server, in the main folder or in a worktree.
#
# A worktree is a fresh checkout: it has no .env.local and no local database.
# This links both from the main folder, so every worktree signs in the same way
# and reads the same local data. node_modules needs no link: a worktree sits
# under the main folder, and Node finds the main folder's copy by walking up.
#
# `next dev` takes port 3000, or the next free port when 3000 is in use, and
# prints the URL. Sign in on localhost:3000 once; the cookie covers every port.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
for f in .env.local data; do
  [ -e "$f" ] || [ ! -e "$main/$f" ] || ln -s "$main/$f" "$f"
done
exec npx next dev "$@"
