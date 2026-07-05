"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { JobPicker } from "@/components/JobPicker";

// Routes that are scoped to a single job. The picker shows here and writes the
// chosen job to the URL's ?jobId=, which those pages read as source of truth.
const JOB_ROUTES = ["/", "/unbilled", "/stage", "/bill"];

export function GlobalJobBar() {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const jobId = search.get("jobId") ?? "";

  const show = JOB_ROUTES.some((r) => (r === "/" ? pathname === "/" : pathname.startsWith(r)));
  if (!show) return null;

  function onChange(id: string) {
    // Switching jobs from a specific bill returns to that job's coding queue —
    // the old bill belongs to the previous job.
    const base = pathname.startsWith("/bill") ? "/" : pathname;
    router.replace(`${base}?jobId=${encodeURIComponent(id)}`);
  }

  return (
    <div className="px-2 py-2">
      <JobPicker value={jobId} onChange={onChange} />
    </div>
  );
}
