"use client";

import { useAccess } from "@/components/AccessProvider";
import { Tabs } from "@/components/ui";

/**
 * BILLS DASHBOARD. One tab row over the bill list and the three monthly
 * statement / import pages. Each tab is its own route (so each keeps its own
 * view gate and saved links) and loads only its own component: the page passes
 * the section's component as `children`. A tab shows only to someone who holds
 * its view.
 */
const SECTIONS = [
  { id: "bills", label: "Bills", href: "/bills", view: "bills" },
  { id: "sunset", label: "Sunset Statements", href: "/payments", view: "payments" },
  { id: "lswdd", label: "LSWDD Statements", href: "/lswdd", view: "lswdd" },
  { id: "amazon", label: "Amazon Import", href: "/amazon-import", view: "amazon-import" },
] as const;

export type BillsSection = (typeof SECTIONS)[number]["id"];

export function BillsDashboard({ section, children }: { section: BillsSection; children: React.ReactNode }) {
  const { can } = useAccess();
  const wide = section === "bills" || section === "sunset";
  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 lg:max-w-[96rem] pb-24 pt-6">
      <h1 className="sr-only">Bills</h1>
      <Tabs
        label="Bills sections"
        className="mb-4"
        items={SECTIONS.filter((x) => x.id === section || can(x.view)).map((x) => ({
          key: x.id,
          label: x.label,
          href: x.href,
          active: x.id === section,
        }))}
      />
      <div className={wide ? "" : "max-w-5xl"}>{children}</div>
    </main>
  );
}
