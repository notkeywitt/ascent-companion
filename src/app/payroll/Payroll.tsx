"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { PageHeader, Tabs } from "@/components/ui";
import { setUrlParam } from "@/lib/urlParam";
import { TimeOffView } from "@/app/time-off/TimeOff";
import { TimeSync } from "@/app/time-sync/TimeSync";
import { LaborImport } from "@/app/labor-import/LaborImport";
import { PayPeriod } from "./PayPeriod";

/**
 * PAYROLL (CONSOLIDATION_PLAN.md stage 5) — the pay-period work that used to
 * be three pages:
 *   Time off      — requests to approve, accrual, balances (was Time Off (Office))
 *   Sync gaps     — time records JobTread doesn't have right (was Time Sync)
 *   Labor import  — the Labor Report and the QuickBooks labor CSV (was Labor Import)
 * Each section keeps its own gate and shows only to someone who holds it; only
 * the open one loads. /time-off/office, /time-sync and /labor-import redirect.
 */
const SECTIONS = [
  // The pay period's outputs. Rides the page's own gate (time-sync).
  { id: "period", label: "Pay period", view: "time-sync" },
  { id: "timeoff", label: "Time off", view: "time-off-admin" },
  { id: "sync", label: "Sync gaps", view: "time-sync" },
  { id: "labor", label: "Labor import", view: "labor-import" },
];

export function Payroll() {
  const { can } = useAccess();
  const search = useSearchParams();
  const sections = SECTIONS.filter((x) => can(x.view));
  const [section, setSection] = useState(() => {
    const want = search.get("section") ?? "";
    return sections.some((x) => x.id === want) ? want : sections[0]?.id ?? "timeoff";
  });

  return (
    <main className="w-full max-w-4xl px-4 pad:px-7 pb-24 pt-6">
      <PageHeader title="Payroll" description="Time off, time that did not reach JobTread, and the month's labor." />
      <Tabs
        label="Payroll sections"
        items={sections.map((x) => ({
          key: x.id,
          label: x.label,
          active: section === x.id,
          onClick: () => {
            setSection(x.id);
                setUrlParam("section", x.id === sections[0].id ? "" : x.id);
          },
        }))}
      />
      {section === "period" && can("time-sync") && <PayPeriod />}
      {section === "timeoff" && can("time-off-admin") && <TimeOffView office embedded />}
      {section === "sync" && can("time-sync") && <TimeSync embedded />}
      {section === "labor" && can("labor-import") && <LaborImport embedded />}
    </main>
  );
}
