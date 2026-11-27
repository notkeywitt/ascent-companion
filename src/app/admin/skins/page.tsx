import { PageHeader } from "@/components/ui";
import { SkinsPanel } from "../SkinsPanel";
import { AdminTabs } from "@/app/admin/AdminTabs";

/** Admin → Skins as its own page, so the phone menu can link it. The same
 *  panel is a tab of /admin. Gated by the `skins` view (admin-only). */
export default function SkinsPage() {
  return (
    <main className="w-full max-w-2xl px-4 pb-24 pt-6 pad:px-7">
      <AdminTabs />
      <PageHeader title="Skins" />
      <SkinsPanel />
    </main>
  );
}
