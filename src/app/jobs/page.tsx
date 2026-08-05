import { JobsBrowser } from "./JobsBrowser";

/**
 * Jobs cost browser. All data now comes from two cached server routes
 * (/api/jobs/browser and /api/jobs/cost-detail), so this page has nothing left
 * to inject — the client no longer drives the Pave gateway itself.
 * Gated by the "jobs" view in src/lib/views.ts (office + admin).
 */
export default function JobsPage() {
  return <JobsBrowser />;
}
