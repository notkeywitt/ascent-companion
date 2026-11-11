"use client";

import { useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { PageHeader, Tabs } from "@/components/ui";
import { setUrlParam } from "@/lib/urlParam";
import { CUSTOMER_SECTIONS } from "@/lib/workspaces";
import { LeadsBoard } from "./LeadsBoard";
import { ClientsBrowser } from "@/app/clients/ClientsBrowser";

/**
 * CUSTOMERS (CONSOLIDATION_PLAN.md stage 4) — one page for the people the
 * company works for. A lead is a JobTread customer marked "New Lead", so the
 * lead board and the customer directory are two views of one list:
 *   Leads          — the follow-up board (was the Leads page)
 *   All customers  — every customer and job, editable (was Directory's list)
 * Each section shows only to someone who holds its view. From 2xl the sidebar
 * lists the sections under Customers, so the tab strip steps aside. A job's record stays
 * at /clients?jobId — the job tab row's "Job Details".
 */
export function Customers() {
  const { can } = useAccess();
  const search = useSearchParams();
  const sections = CUSTOMER_SECTIONS.filter((x) => can(x.view));
  // Read from the URL on every render: a sidebar link changes ?section while
  // this page stays mounted.
  const want = search.get("section") ?? "";
  const section = sections.some((x) => x.id === want) ? want : (sections[0]?.id ?? "leads");

  return (
    <main className="w-full max-w-4xl px-4 pad:px-7 pb-24 pt-6">
      <PageHeader title="Customers" />
      <div className="2xl:hidden">
        <Tabs
          label="Customer sections"
          items={sections.map((x) => ({
            key: x.id,
            label: x.label,
            active: section === x.id,
            onClick: () => {
              setUrlParam("section", x.id === sections[0].id ? "" : x.id);
            },
          }))}
        />
      </div>
      {section === "leads" && can("leads") && <LeadsBoard embedded />}
      {section === "all" && can("clients") && <ClientsBrowser embedded />}
    </main>
  );
}
