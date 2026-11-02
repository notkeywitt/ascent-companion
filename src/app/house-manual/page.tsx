"use client";

import { Suspense } from "react";
import { HouseManualPage } from "./HouseManual";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <HouseManualPage />
    </Suspense>
  );
}
