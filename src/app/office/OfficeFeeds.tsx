"use client";

import { FindingsInbox } from "@/components/FindingsInbox";
import { NoticesAdmin } from "@/components/NoticesAdmin";
import { useAccess } from "@/components/AccessProvider";
import { SectionHeading } from "@/components/ui";

/**
 * The Office dashboard's warnings inbox and notices authoring panel (they were
 * /attention and /notices). Each is its own column and keeps its own view gate,
 * so a person with one view still sees only that one.
 */
export function OfficeFeeds() {
  const { can } = useAccess();
  return (
    <>
      {can("attention") && (
        <section className="mb-6 min-w-0">
          <SectionHeading>Needs attention</SectionHeading>
          <FindingsInbox />
        </section>
      )}
      {can("notices") && (
        <section className="mb-6 min-w-0">
          <SectionHeading>Notices</SectionHeading>
          <NoticesAdmin />
        </section>
      )}
    </>
  );
}
