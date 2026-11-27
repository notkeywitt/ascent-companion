"use client";

import { PageHeader } from "@/components/ui";
import { AUDIT_TABS, PageTabs } from "@/components/PageTabs";
import { AdminTabs } from "../AdminTabs";
import { ActivityPanel } from "../ActivityPanel";

/** Audit → Activity: visits per page and per person. Was a tab of Access
 *  until 2026-11-27. Rides the `admin` view (the /admin path prefix). */
export default function ActivityPage() {
  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6 lg:max-w-[1600px]">
      <AdminTabs />
      <PageTabs tabs={AUDIT_TABS} />
      <PageHeader title="Activity" />
      <ActivityPanel />
    </main>
  );
}
