"use client";

import { useEffect, useState } from "react";

import { PunchList } from "@/app/jobs-hub/PunchList";
import { Loading, PageHeader, Select } from "@/components/ui";

type Job = { id: string; name: string; customer?: string | null };
const label = (j: Job) => (j.customer ? `${j.customer} - ${j.name}` : j.name);

export function PunchListPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jobId, setJobId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => !cancelled && setJobs(d.error ? [] : (d.jobs ?? [])))
      .catch(() => !cancelled && setJobs([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <PageHeader title="Punch List" description="The final inspection checklist, shared by everyone." />
      {!jobs ? (
        <Loading />
      ) : (
        <Select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Job">
          <option value="">Pick a job…</option>
          {[...jobs]
            .sort((a, b) => label(a).localeCompare(label(b)))
            .map((j) => (
              <option key={j.id} value={j.id}>
                {label(j)}
              </option>
            ))}
        </Select>
      )}
      {jobId && <PunchList key={jobId} jobId={jobId} />}
    </div>
  );
}
