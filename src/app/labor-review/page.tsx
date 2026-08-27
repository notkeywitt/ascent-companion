import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { LaborReview } from "./LaborReview";

/**
 * Labor Review — Tracking Sheets' layout, applied to time entries instead of
 * bills: budget headroom on the left, the month's labor in the middle, the
 * coding drawer on the right. See LaborReview.tsx.
 */
export default function LaborReviewPage() {
  return (
    <Suspense fallback={<Loading label="Loading…" />}>
      <LaborReview />
    </Suspense>
  );
}
