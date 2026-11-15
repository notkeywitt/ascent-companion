import { Suspense } from "react";
import { LaborClient } from "./LaborClient";

export const metadata = { title: "Labor" };

// Suspense because LaborClient reads ?period, ?date, ?ym and ?jobId.
export default function LaborPage() {
  return (
    <Suspense fallback={null}>
      <LaborClient />
    </Suspense>
  );
}
