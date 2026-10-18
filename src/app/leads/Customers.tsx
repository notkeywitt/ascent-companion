"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { FilterChip, PageHeader } from "@/components/ui";
import { setUrlParam } from "@/lib/urlParam";
import { LeadsBoard } from "./LeadsBoard";
import { ClientsBrowser } from "@/app/clients/ClientsBrowser";

/**
 * CUSTOMERS (CONSOLIDATION_PLAN.md stage 4) — one page for the people the
 * company works for. A lead is a JobTread customer marked "New Lead", so the
 * lead board and the customer directory are two views of one list:
 *   Leads          — the follow-up board (was the Leads page)
 *   All customers  — every customer and job, editable (was Directory's list)
 * Each section shows only to someone who holds its view. A job's record stays
 * at /clients?jobId — the job tab row's "Record".
 */
const SECTIONS = [
  { id: "leads", label: "Leads", view: "leads" },
  { id: "all", label: "All customers", view: "clients" },
];

export function Customers() {
  const { can } = useAccess();
  const search = useSearchParams();
  const sections = SECTIONS.filter((x) => can(x.view));
  const [section, setSection] = useState(() => {
    const want = search.get("section") ?? "";
    return sections.some((x) => x.id === want) ? want : sections[0]?.id ?? "leads";
  });

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <PageHeader title="Customers" description="Leads to follow up, and every customer and job in JobTread." />
      {sections.length > 1 && (
        <div className="mb-4 mt-3 flex flex-wrap gap-2">
          {sections.map((x) => (
            <FilterChip
              key={x.id}
              on={section === x.id}
              onClick={() => {
                setSection(x.id);
                setUrlParam("section", x.id === sections[0].id ? "" : x.id);
              }}
            >
              {x.label}
            </FilterChip>
          ))}
        </div>
      )}
      {section === "leads" && can("leads") && <LeadsBoard embedded />}
      {section === "all" && can("clients") && <ClientsBrowser embedded />}
    </main>
  );
}
