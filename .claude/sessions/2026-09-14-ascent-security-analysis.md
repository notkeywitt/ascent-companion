---
slug: ascent-security-analysis
repo: ascent-companion
branch: claude/ascent-security-analysis-m8fjif
status: parked
started: 2026-09-14T06:09:33Z
updated: 2026-09-14T06:11:42Z
goal: Full security review of both repos, then fix findings 1-4 (the two criticals, revocation, dependencies)
next: Owner merges PR #7 (git push origin origin/claude/ascent-security-analysis-m8fjif:main) AFTER setting AUTH_SECRET and deleting APP_PASSWORD in Vercel. Then fix-order items 5-8: default-deny unlisted /api/ routes (M-1), fail-open branches via src/lib/authMode.ts (H-4), security headers (M-5), doGet secret (M-4).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-14 06:09 · `c5b89f5` companion: close the two critical security findings and the worst two high ones
  .env.example, CODEBASE_MAP.md, package-lock.json, package.json, src/app/api/digest/run/route.ts, src/app/api/employees/route.ts, +14 more
- 2026-09-14 06:11 · `40d8c41` companion: log session 2026-09-14-ascent-security-analysis
  SESSIONS.md, src/lib/sessionLog.generated.json

## Notes
- 2026-09-14 06:11 — Report artifact: https://claude.ai/code/artifact/1bd88af4-26d1-47f5-ab49-4d30312add47 — 15 findings, ranked, with fix order.
- 2026-09-14 06:11 — AUTH_SECRET could not be verified from the repo. If it was never set, session cookies are signed with APP_PASSWORD and anyone knowing it can forge role:admin. sessionSecret() now logs a [SECURITY] line on cold start when that is the case — check Vercel logs after deploy.
- 2026-09-14 06:11 — revalidateAccess MUST keep telling 'DB says gone' apart from 'DB unreachable'. The jwt callback also runs on edge, where the libSQL client cannot import at all, so collapsing the two would sign the whole company out on every edge request.
- 2026-09-14 06:11 — Pre-existing, not caused here: lint fails on trackingsheet/Board.tsx:3083 (conditional useState). CI red on main for the last 6 runs incl. d24f2ff. Left alone deliberately.
- 2026-09-14 06:11 — npm audit fix crashes on this tree (npm 10.9.7, 'edgesOut' null) — next and next-auth were bumped explicitly instead. 6 advisories remain, all build-toolchain transitives inside next that only next@16 clears.
