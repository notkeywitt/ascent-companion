"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function Rfis() {
  const search = useSearchParams();
  const jobId = search.get("jobId") ?? "";

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <header className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Ascent Companion
        </p>
        <h1 className="text-2xl font-bold tracking-tight">RFIs</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Requests for information{jobId ? ` for job ${jobId}` : ""}.
        </p>
      </header>

      <div className="rounded-2xl border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
        <p className="font-medium text-neutral-700 dark:text-neutral-300">Coming next.</p>
        <p className="mt-2">
          RFI tracking will live here. First we need to decide how RFIs are stored —
          natively in JobTread (via tasks/to-dos/forms) or in a small companion database —
          then this tab gets a create/list/answer flow.
        </p>
      </div>
    </main>
  );
}

export default function RfisPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Rfis />
    </Suspense>
  );
}
