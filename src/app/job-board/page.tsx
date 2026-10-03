import { JobBoardPage } from "./JobBoardPage";

/**
 * The Jobs page — Active jobs, PreCon jobs and leads as kanban rows. Data comes
 * from /api/job-board (the job rows) and /api/leads (the lead row). Gated by
 * the "job-board" view in src/lib/views.ts (office + admin).
 */
export default function JobBoard() {
  return <JobBoardPage />;
}
