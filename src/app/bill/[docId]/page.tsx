"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { BillView } from "./BillView";

function BillDetail() {
  const params = useParams<{ docId: string }>();
  return <BillView docId={params.docId} />;
}

export default function BillPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <BillDetail />
    </Suspense>
  );
}
