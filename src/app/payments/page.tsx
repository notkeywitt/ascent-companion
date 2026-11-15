import { BillsDashboard } from "@/app/bills/BillsDashboard";
import { SunsetStatements } from "./SunsetStatements";

// A tab of the Bills dashboard; this route keeps its own view gate.
export default function Page() {
  return (
    <BillsDashboard section="sunset">
      <SunsetStatements />
    </BillsDashboard>
  );
}
