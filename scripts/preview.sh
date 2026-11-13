#!/bin/sh
# preview — show this branch on the phone-review address.
#
#   npm run preview
#
# Replaces the `preview` branch with HEAD. Vercel builds it at the address
# below. One branch at a time: the next `npm run preview` replaces this one.
#
# JobTread writes are off there: Vercel holds COMPANION_WRITES_ENABLED=false
# for the branch `preview`. It still reads live JobTread and it uses the
# PRODUCTION companion database, so a branch that changes applySchema changes
# the live database the moment the preview starts. Do not preview one unasked.
set -u
url="https://ascent-companion-git-preview-keywitt.vercel.app"

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "preview: not inside a git repository" >&2
  exit 1
}
if [ -n "$(git status --porcelain)" ]; then
  echo "preview: uncommitted changes — commit them first, staged by name:" >&2
  git status --short >&2
  exit 1
fi
git push -q --force origin HEAD:refs/heads/preview 2>/dev/null || {
  echo "preview: push failed" >&2
  exit 1
}
echo "preview: building — open $url in about 3 minutes."
