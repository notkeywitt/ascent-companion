"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccess } from "@/components/AccessProvider";
import { FilterChip, PageHeader } from "@/components/ui";
import { setUrlParam } from "@/lib/urlParam";
import { EmailInvoices } from "./EmailInvoices";
import { NotInJobTread } from "@/app/needs-project/NotInJobTread";
import VendorMail from "@/app/vendor-mail/VendorMail";
import { ScriptJobs } from "@/components/ScriptJobs";

/**
 * INCOMING BILLS — ONE INBOX (CONSOLIDATION_PLAN.md stage 3). Three stages of
 * the same bill, which used to be three pages:
 *   To log      — invoice emails not yet logged (was Email Invoices)
 *   Stuck       — captured bills that did not reach JobTread (was Not in JobTread)
 *   Check mail  — every vendor email and whether it was captured (was Mail Check)
 * Each section shows only to someone who holds its view, and only the open one
 * loads: Check mail's sweep can take two minutes. ?section= picks one;
 * /needs-project and /vendor-mail redirect here.
 */
const SECTIONS = [
  { id: "log", label: "To log", view: "email" },
  { id: "stuck", label: "Stuck", view: "needs-project" },
  { id: "mail", label: "Check mail", view: "vendor-mail" },
];

export function Inbox() {
  const { can } = useAccess();
  const search = useSearchParams();
  const sections = SECTIONS.filter((x) => can(x.view));
  const [section, setSection] = useState(() => {
    const want = search.get("section") ?? "";
    return sections.some((x) => x.id === want) ? want : sections[0]?.id ?? "log";
  });

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader title="Inbox" description="Bills arriving by email, at each stage." />
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
      {section === "log" && can("email") && <EmailInvoices embedded />}
      {/* The email scans, from the retired Actions page (stage 6). */}
      {section === "log" && can("actions") && (
        <div className="mt-8">
          <ScriptJobs
            title="Scan the mailbox now"
            keys={["frequentEmailScan", "scanJtInvoiceCaptureTags", "scanJtTodoCaptureTags"]}
          />
        </div>
      )}
      {section === "stuck" && can("needs-project") && <NotInJobTread embedded />}
      {section === "mail" && can("vendor-mail") && <VendorMail embedded />}
    </main>
  );
}
