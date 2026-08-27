import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { ClientInvoicing } from "./ClientInvoicing";

/**
 * Tracking Sheets — the single home for the month's client invoices, the
 * needs-coding queue, and the coding workbench. See ClientInvoicing.tsx for how
 * the job selector switches between them.
 */
export default function BoardPage() {
  return (
    <Suspense fallback={<Loading label="Loading…" />}>
      <ClientInvoicing />
    </Suspense>
  );
}
