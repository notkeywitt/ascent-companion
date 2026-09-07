import { PageHeader } from "@/components/ui";
import { NoticesAdmin } from "@/components/NoticesAdmin";

/**
 * Notices — where office or admin posts an announcement to the team.
 *
 * Gated by the `notices` view id (office + admin by default). The panel is a
 * client component and talks only to /api/admin/notices, so this page hands it
 * no context; it also renders as the Notices tab on /admin, which is why the
 * panel lives in components/ rather than beside this page.
 */
export default function NoticesPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Notices"
        description="Post a banner or popup to the whole team, a group, or one person — now or on a schedule."
      />
      <NoticesAdmin />
    </main>
  );
}
