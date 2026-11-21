/**
 * The Jobs page's job cards — the Job Board's own read (src/app/api/job-board),
 * served under /api/jobs-hub so the Jobs page's view gates it. Field holds that
 * view and not "job-board" (2026-11-21). Read-only, and no money: each card is
 * the job's name, number, customer, address, phase, schedule and open to-dos.
 * One handler, so the two pages can never disagree.
 */
export { GET } from "../../job-board/route";
