import { Suspense } from "react";
import { BillsDashboard } from "@/app/bills/BillsDashboard";
import { Inbox } from "./Inbox";

export const metadata = { title: "Inbox" };

// A tab of the Bills dashboard; this route keeps its own view gate.
// Suspense because the inbox reads ?section (useSearchParams).
export default function InboxPage() {
  return (
    <BillsDashboard section="inbox">
      <Suspense fallback={null}>
        <Inbox />
      </Suspense>
    </BillsDashboard>
  );
}
