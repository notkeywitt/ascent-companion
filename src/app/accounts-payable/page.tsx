import { BillsDashboard } from "@/app/bills/BillsDashboard";
import { AccountsPayable } from "./AccountsPayable";

// A tab of the Bills dashboard; this route keeps its own view gate.
export default function Page() {
  return (
    <BillsDashboard section="payable">
      <AccountsPayable />
    </BillsDashboard>
  );
}
