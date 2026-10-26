import { writesEnabled } from "@/lib/config";
import { DepositTracker } from "./DepositTracker";

/** Deposit checks — Home's first Actions button. The flow is in DepositTracker. */
export const dynamic = "force-dynamic";

export default function Page() {
  return <DepositTracker writes={writesEnabled()} />;
}
