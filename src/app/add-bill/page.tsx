"use client";

import { Suspense } from "react";
import { AddBillForm } from "./AddBillForm";

export default function AddBillPage() {
  return (
    <Suspense>
      <AddBillForm />
    </Suspense>
  );
}
