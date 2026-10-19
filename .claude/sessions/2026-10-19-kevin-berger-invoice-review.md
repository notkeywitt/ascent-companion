---
slug: kevin-berger-invoice-review
repo: ascent-companion
branch: claude/kevin-berger-invoice-review-gktmtf
status: shipped
started: 2026-10-19T10:34:29Z
updated: 2026-10-19T11:00:39Z
goal: Turn Kevin Berger's invoice disputes into review checks, and run the review on the 10th-to-15th timeline
next: After the 2026-11-11 scheduled run: read the November digest card and the review history (ranBy schedule) to confirm the nightly run fired; tune any noisy new check with a ruling or settings. Owner decision pending on the /api/bill-tax guard.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-19 10:34 · `c42fd65` companion: add berger invoice checks and run the review on the 10th-to-15th timeline
  .claude/skills/invoice-review/SKILL.md, CODEBASE_MAP.md, src/app/api/digest/run/route.ts, src/app/api/invoice-review/run/route.ts, src/lib/digest/checks/invoiceReviewWindow.ts, src/lib/digest/registry.ts, +13 more
- 2026-10-19 10:43 · `c213adc` companion: tune berger checks against live data and add cross-job duplicates
  CODEBASE_MAP.md, src/lib/invoiceReview/bergerChecks.test.ts, src/lib/invoiceReview/checks/duplicateCrossJob.ts, src/lib/invoiceReview/checks/duplicateWide.ts, src/lib/invoiceReview/checks/invoiceLines.ts, src/lib/invoiceReview/evidence.ts, +3 more
- 2026-10-19 10:46 · `787b0bc` Merge remote-tracking branch 'origin/claude/kevin-berger-invoice-review-gktmtf' into claude/kevin-berger-invoice-review-gktmtf
- 2026-10-19 11:00 · `eb1f111` companion: start the review's mailbox sweep alongside the jobtread reads
  src/lib/invoiceReview/checks/mailCapture.ts, src/lib/invoiceReview/evidence.ts

## Notes
- 2026-10-19 10:34 — Audit of Kevin Berger threads (Oct 2025-Oct 2026): 12 real errors (6 billing, 6 Drive backup), 13 process gaps. Checks built: tax-doubled, duplicate-wide, invoice-lines, line-code-mismatch. Schedule rides the digest's scheduler call (Hobby 2-cron cap).
- 2026-10-19 10:34 — Held, needs owner ok (JobTread write path): /api/bill-tax refusing a tax that makes taxLooksDoubled true. Its 3 callers (bill page, DraftWorkbench, saveCoding) would need a confirm path.
- 2026-10-19 10:43 — Dry run on live Berger data 2026-10-19: invoice-lines reconciles #379 and #25 on every code once time is merged per code per day; tax-doubled flags exactly Bunkhouse #184/#185 (already offset by credits #311/#312); duplicate rules retuned (different vendor numbers never pair; credits pair) after 5 Starr Sanitation false hits. New cross-job check finds Sunset credits -83.03 and -17.99 on both jobs; -145.91 entered twice on Main House.
- 2026-10-19 10:43 — Open for the office: Fasteners credit #310 (-44.24, 'Refund For Sales tax included in July Invoice') offsets bill #199, whose tax fits the CLEAN pattern - possible over-credit to Kevin. Main House drafts #15/#16 are one Sunset credit twice.
- 2026-10-19 11:00 — Mailbox sweep timed out at 120s on the review page. Fix: companion starts it in parallel and allows 240s; appscript (5df9a93, needs ./deploy.sh) batches Gmail reads and no longer downloads attachments.
