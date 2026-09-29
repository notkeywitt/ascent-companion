---
slug: bill-expense-save
repo: wt
branch: claude/bill-expense-save
status: shipped
started: 2026-09-29T23:23:03Z
updated: 2026-09-29T23:28:29Z
goal: Bill/Expense toggle stages until Save on the tracking sheet; Push as Expense sends the QuickBooks paid-from account
next: Owner ok to push (write path). Then on /trackingsheet flip draft #412 to Expense, Save, and confirm JobTread shows Push as Expense paid from Capital One Sparks.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-29 16:26 · `cdfba14` companion: push as expense sends the capital one sparks account, and the board's type toggle saves with save changes
  src/app/api/bill-fields/route.ts, src/app/api/bill-status/route.ts, src/app/bill/[docId]/page.tsx, src/app/trackingsheet/BillCodingCard.tsx, src/app/trackingsheet/Board.tsx, src/lib/jobtread.test.ts, +1 more

## Notes
