"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { BillView } from "./BillView";

/**
 * Every link to a vendor bill opens it on the Jobs Hub, in the job's Tracking
 * sheet (owner, 2026-11-09). This page sends a reader who has the Jobs Hub
 * there; a reader without it gets the bill page as before. `?page=1` keeps the
 * bill page: the hub sends a bill it cannot show (no job) back with it.
 */
function BillDetail() {
  const params = useParams<{ docId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { can } = useAccess();
  const toHub = can("jobs-hub") && search.get("page") !== "1";
  const jobId = search.get("jobId");
  useEffect(() => {
    if (!toHub) return;
    const q = new URLSearchParams({ bill: params.docId });
    if (jobId) q.set("jobId", jobId);
    router.replace(`/jobs-hub?${q}`);
  }, [toHub, params.docId, jobId, router]);
  if (toHub) return <main className="p-6 text-sm text-neutral-500">Opening on the Jobs Hub…</main>;
  return <BillView docId={params.docId} />;
}

export default function BillPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <BillDetail />
    </Suspense>
  );
}
