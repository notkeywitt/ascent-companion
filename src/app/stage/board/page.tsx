import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { Board } from "./Board";

/**
 * Invoicing coding board — desktop workbench for recoding a month's bills
 * against live budget headroom. Reached from a job card on /stage, which stays
 * the phone-friendly all-jobs list. Shares the "stage" (Invoicing) view gate.
 */
export default function BoardPage() {
  return (
    <Suspense fallback={<Loading label="Loading…" />}>
      <Board />
    </Suspense>
  );
}
