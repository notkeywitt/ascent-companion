import { PageHeader } from "@/components/ui";
import { JobTabs } from "@/components/JobTabs";
import { JobOverview } from "@/components/HomeJobBoard";

/**
 * A job's Overview — the first tab of the job tab row (stage 4). Rides the
 * "job-board" view: /job-board/<id> prefix-matches /job-board, so no new view
 * id (which would reach a signed-in person only at their next sign-in).
 */
export default async function JobOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader title="Job overview" description="Schedule, budget and cost by division." />
      <JobTabs jobId={id} />
      <JobOverview jobId={id} />
    </main>
  );
}
