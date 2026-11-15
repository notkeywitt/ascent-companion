"use client";

import { FindingsInbox } from "@/components/FindingsInbox";
import { NoticesAdmin } from "@/components/NoticesAdmin";
import { useAccess } from "@/components/AccessProvider";
import { SectionHeading } from "@/components/ui";

/**
 * The Office dashboard's left column: the warnings inbox and the notices
 * authoring panel (they were /attention and /notices). Each keeps its own view
 * gate, so a person with one view still sees only that one.
 */
export function OfficeFeeds() {
  const { can } = useAccess();
  return (
    <>
      {can("attention") && (
        <section className="mb-6">
          <SectionHeading>Needs attention</SectionHeading>
          <FindingsInbox />
        </section>
      )}
      {can("notices") && (
        <section className="mb-6">
          <SectionHeading>Notices</SectionHeading>
          <NoticesAdmin />
        </section>
      )}
    </>
  );
}
