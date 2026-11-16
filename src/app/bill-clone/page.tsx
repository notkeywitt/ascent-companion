import { BillsDashboard } from "@/app/bills/BillsDashboard";
import { BillClones } from "./BillClones";

// A tab of the Bills dashboard; this route keeps its own view gate.
export default function Page() {
  return (
    <BillsDashboard section="clones">
      <BillClones />
    </BillsDashboard>
  );
}
