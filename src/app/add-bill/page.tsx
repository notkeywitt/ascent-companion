"use client";

import { Suspense } from "react";
import { BillsDashboard } from "@/app/bills/BillsDashboard";
import { AddBillForm } from "./AddBillForm";

// A tab of the Bills dashboard; this route keeps its own view gate (recode).
export default function AddBillPage() {
  return (
    <BillsDashboard section="add">
      <Suspense>
        <AddBillForm inHub />
      </Suspense>
    </BillsDashboard>
  );
}
