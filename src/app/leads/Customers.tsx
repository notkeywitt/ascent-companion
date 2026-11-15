"use client";

import { PageHeader } from "@/components/ui";
import { LeadsBoard } from "./LeadsBoard";

/**
 * CUSTOMERS — one page, the lead board's shape. The All / Leads / Complete
 * toggle and the detail panel live in LeadsBoard; a job opens in that panel
 * too. A job's record also stays at /clients?jobId (the job tab row's "Job Details").
 */
export function Customers() {
  return (
    <main className="w-full max-w-4xl px-4 pad:px-7 lg:max-w-[1600px] pb-24 pt-6">
      {/* The leads board draws its New lead / Refresh buttons into this slot. */}
      <PageHeader title="Customers" actions={<div id="customers-actions" />} />
      <LeadsBoard embedded />
    </main>
  );
}
