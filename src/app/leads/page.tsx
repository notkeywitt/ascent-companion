import { Suspense } from "react";
import { Customers } from "./Customers";

export const metadata = { title: "Customers" };

// Suspense because Customers reads ?section (useSearchParams).
export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <Customers />
    </Suspense>
  );
}
