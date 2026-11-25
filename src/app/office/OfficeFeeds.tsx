"use client";

import { FindingsInbox } from "@/components/FindingsInbox";
import { NoticesAdmin } from "@/components/NoticesAdmin";
import { useAccess } from "@/components/AccessProvider";
import { MobileSection } from "./MobileSection";

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
        <MobileSection title="Needs attention">
          <FindingsInbox />
        </MobileSection>
      )}
      {can("notices") && (
        <MobileSection title="Notices">
          <NoticesAdmin />
        </MobileSection>
      )}
    </>
  );
}
