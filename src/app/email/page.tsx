import { Suspense } from "react";
import { Inbox } from "./Inbox";

export const metadata = { title: "Inbox" };

// Suspense because the inbox reads ?section (useSearchParams).
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <Inbox />
    </Suspense>
  );
}
