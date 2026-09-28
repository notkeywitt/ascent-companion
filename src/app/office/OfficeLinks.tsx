"use client";

import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { ListCard, ListRow } from "@/components/ui";
import { AREAS } from "@/lib/nav";

/**
 * The Office dashboard's links to the other office pages — the "hr" area of
 * AREAS (src/lib/nav.ts), minus the dashboard itself, filtered to what the
 * viewer can open. Client-side only because access and copy live in context.
 */
export function OfficeLinks() {
  const access = useAccess();
  const c = useCopy();
  const dests = (AREAS.find((a) => a.id === "hr")?.dests ?? []).filter(
    (d) => d.view !== "office" && access.can(d.view),
  );
  if (dests.length === 0) return null;
  return (
    <ListCard>
      {dests.map((d) => (
        <ListRow
          key={d.href}
          href={d.href}
          label={c(`home.dest.${d.view}.label`) || d.label}
          desc={c(`home.dest.${d.view}.desc`) || d.desc}
        />
      ))}
    </ListCard>
  );
}
