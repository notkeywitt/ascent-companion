import { Suspense } from "react";
import { currentBillingPeriod } from "@/lib/billingMonth";
import { ymOf } from "@/lib/billing";
import { Loading } from "@/components/ui";
import { ClientBudgetReport } from "./ClientBudgetReport";

/** The client budget report sent with each invoice. Print-first; see ClientBudgetReport. */
export default async function ClientBudgetPage() {
  const defaultYm = ymOf(await currentBillingPeriod());
  return (
    <Suspense fallback={<Loading />}>
      <ClientBudgetReport defaultYm={defaultYm} />
    </Suspense>
  );
}
