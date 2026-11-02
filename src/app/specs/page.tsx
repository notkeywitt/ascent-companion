"use client";

import { Suspense } from "react";
import { Specs } from "./Specs";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Specs />
    </Suspense>
  );
}
