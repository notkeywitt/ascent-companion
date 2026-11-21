"use client";

import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { billsHref } from "@/lib/hubUrl";
import { BillView } from "./BillView";

/**
 * Every link to a vendor bill opens it on the Bills page, with the bill open
 * beside the list. This page sends a reader who has Bills there; a reader
 * without it gets the bill page as before. `?page=1` keeps the bill page.
 */
function BillDetail() {
  const params = useParams<{ docId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { can } = useAccess();
  const toHub = can("bills") && search.get("page") !== "1";
  const jobId = search.get("jobId");
  useEffect(() => {
    if (!toHub) return;
    router.replace(billsHref(params.docId, jobId));
  }, [toHub, params.docId, jobId, router]);
  if (toHub) return <main className="p-6 text-sm text-neutral-500">Opening on Bills…</main>;
  return <BillView docId={params.docId} />;
}

export default function BillPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <BillDetail />
    </Suspense>
  );
}
