"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ListCard, ListRow, PageHeader } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { FIELD_REST } from "@/lib/nav";

/**
 * "The Rest" — the fourth button on the field launcher.
 *
 * A plain, one-screen menu of everything a field user can open besides Miles,
 * Time, and Tools. It is deliberately a PAGE, not a popup menu: it is a normal
 * link the back button leaves, and it can grow to any length without fighting a
 * phone keyboard.
 *
 * CURATE IT in src/lib/nav.ts → FIELD_REST. Rows are still gated on the same
 * view ids as everything else, so listing a page here does not grant it — the
 * role has to grant the view too (Admin → Role Defaults).
 *
 * The route itself needs no gate in lib/views: it renders nothing but links the
 * viewer already has, and an office/admin user who lands here just sees their
 * own (larger) set of the same rows.
 */
function More() {
  const search = useSearchParams();
  const access = useAccess();
  const c = useCopy();
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  const rows = useMemo(
    () =>
      FIELD_REST.filter((d) => access.can(d.view)).map((d) => ({
        ...d,
        label: c(`home.dest.${d.view}.label`) || d.label,
        desc: c(`home.dest.${d.view}.desc`) || d.desc,
      })),
    [access, c],
  );

  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-5">
      <PageHeader title="The Rest" description="Everything else you can open." />
      {rows.length > 0 ? (
        <ListCard>
          {rows.map((d) => (
            <ListRow key={d.href} href={d.href + qs} label={d.label} desc={d.desc} />
          ))}
        </ListCard>
      ) : (
        <p className="rounded-xl border border-dashed border-neutral-300 px-6 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          Nothing else is open to your account yet. Ask the office if you expect a page here.
        </p>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <More />
    </Suspense>
  );
}
