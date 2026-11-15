import { BillsDashboard } from "@/app/bills/BillsDashboard";
import { LswddStatement } from "./LswddStatement";

// A tab of the Bills dashboard; this route keeps its own view gate.
export default function Page() {
  return (
    <BillsDashboard section="lswdd">
      <LswddStatement />
    </BillsDashboard>
  );
}
