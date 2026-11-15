import { BillsDashboard } from "@/app/bills/BillsDashboard";
import { AmazonImport } from "./AmazonImport";

// A tab of the Bills dashboard; this route keeps its own view gate.
export default function Page() {
  return (
    <BillsDashboard section="amazon">
      <AmazonImport />
    </BillsDashboard>
  );
}
