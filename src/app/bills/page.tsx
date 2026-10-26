import { Suspense } from "react";
import { BillsBrowser } from "./BillsBrowser";

export default function BillsPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <BillsBrowser />
    </Suspense>
  );
}
