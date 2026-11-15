import { Suspense } from "react";
import { BillsDashboard } from "./BillsDashboard";
import { BillsBrowser } from "./BillsBrowser";

export default function BillsPage() {
  return (
    <BillsDashboard section="bills">
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <BillsBrowser />
      </Suspense>
    </BillsDashboard>
  );
}
