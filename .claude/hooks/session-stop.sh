#!/bin/sh
# Stop — stamp the session as active, and ask ONCE for its next step.
#
# `next:` is the field that answers "what was I in the middle of", and it is
# the only part of the ledger a machine cannot write. So this hook asks for it
# — but only when the session has actually committed something, and only once
# per session, tracked by a marker inside .git. A Stop hook that blocks every
# turn would loop, which is why the marker is written BEFORE the block.
set -u

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0
command -v node >/dev/null 2>&1 || exit 0

node scripts/session.mjs touch >/dev/null 2>&1

marker="$root/.git/session-next-asked"
[ -e "$marker" ] && exit 0

if node scripts/session.mjs needs-next >/dev/null 2>&1; then
  : >"$marker"
  echo "This session has commits but no next step recorded. Set one so the next session can pick it up: node scripts/session.mjs set next \"<the next concrete step>\" — then finish your reply as normal." >&2
  exit 2
fi

exit 0
