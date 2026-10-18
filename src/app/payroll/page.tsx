import { Suspense } from "react";
import { Payroll } from "./Payroll";

export const metadata = { title: "Payroll" };

// Suspense because Payroll reads ?section (useSearchParams).
export default function PayrollPage() {
  return (
    <Suspense fallback={null}>
      <Payroll />
    </Suspense>
  );
}
