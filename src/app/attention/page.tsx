import { FindingsInbox } from "@/components/FindingsInbox";
import { PageHeader } from "@/components/ui";

/**
 * Needs attention — the one inbox for every warning (lib/findings).
 *
 * Gated by the `attention` view id (office + admin by default). The list is a
 * client component and talks only to /api/findings.
 */
export default function AttentionPage() {
  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6">
      <PageHeader title="Needs attention" description="Every open warning in one list. Fix it, hide it for a day, or dismiss it." />
      <FindingsInbox />
    </main>
  );
}
