"use client";

import { Suspense } from "react";
import Link from "next/link";
import { ListCard, ListRow, SectionHeading, btn } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { StuckVendorBanner } from "@/components/StuckVendors";
import { HomeJobBoard } from "@/components/HomeJobBoard";
import { HomeLeadBoard } from "@/components/HomeLeadBoard";
import { HomeMasthead, type MastheadMonth } from "@/components/HomeMasthead";
import { OfficeHome } from "@/components/OfficeHome";
import { TodayQueue } from "@/components/TodayQueue";
import type { HomeLayout } from "@/lib/homeWidgets";

/**
 * The Assistant's front page — Today. The server half is page.tsx: it sends a
 * crew member on to Employee Time and passes in the billing month and the
 * person's widget layout.
 *
 * ADMIN and OFFICE get OfficeHome (OVERHAUL_PLAN Phase 4, 2026-11-13): one
 * "Needs attention" count, the Today strip, one to-do list, the phone's four
 * action buttons and the desktop widgets. Nothing on it repeats a page: the
 * stuck-vendor and no-job banners became rows under "Needs attention" (the
 * stuck-vendor pop-up still finds you on any page), and the Jobs page's
 * map and list stay on /jobs-hub.
 *
 * FIELD and LEAD keep the Home below, unchanged.
 */

function Home({ month, layout }: { month: MastheadMonth; layout: HomeLayout }) {
  const access = useAccess();

  /* ADMIN and OFFICE: their own Home. */
  if (access.role === "admin" || access.role === "office") {
    return (
      <main className="w-full px-4 pb-10 pt-3 pad:px-7 pad:pt-5">
        <HomeMasthead month={month} />
        <OfficeHome layout={layout} />
      </main>
    );
  }
  return <CrewHome month={month} />;
}

/** FIELD and LEAD. */
function CrewHome({ month }: { month: MastheadMonth }) {
  const access = useAccess();
  // Home's notices, up in the masthead (owner, 2026-11-02). Each self-hides.
  const notices = (
    <>
      <StuckVendorBanner compact />
    </>
  );

  return (
    <main className="w-full max-w-2xl px-4 pb-10 pt-3 pad:max-w-none pad:pt-5 pad:px-7">
      {/* No page title here ON A PHONE, on purpose: the logo in the header
          already says where you are, and an <h1>Home</h1> plus its description
          cost the top fifth of a phone screen to repeat it. From `pad` up the
          screen is a foot tall and the same band costs nothing, so the masthead
          below draws the heading — and stands the billing month on it, which is
          the fact this office checks before it opens anything. */}
      <HomeMasthead notices={notices} month={month} />

      {/* What needs this person — one row per queue, each with its count. */}
      <TodayQueue />

      {/* Budget + calendar position for the work in flight — a card per active
          job for office/admin, one wide panel for a lead's own job. Self-hiding,
          and a field phone never fetches it (see HomeJobBoard). */}
      <HomeJobBoard />

      {/* The pipeline, as the same kanban row of cards — ordered by last
          contact so a lead going quiet is the first thing on it. Collapsible
          and remembered per device; self-gating on the `leads` view, so office
          and admin get it and a field or lead phone never fetches it. */}
      <HomeLeadBoard />

      {/* No views at all — don't leave a blank page. This happens when the
          session carries no identity/role (e.g. signed in with the temporary
          shared password rather than Google). Offer a way back to Google. */}
      {access.views.size === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-8 text-center dark:border-neutral-700">
          <p className="text-sm font-semibold">No views are available for your account yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-xs text-neutral-500">
            If you signed in with the temporary password, sign in with Google to load your access.
            Otherwise, ask an admin to grant you access.
          </p>
          <Link href="/login" className={btn("primary", "md", "mt-4")}>
            Sign in with Google
          </Link>
        </div>
      )}

      {/* LopezRocks — the island's community board, re-drawn for a phone
          (src/app/lopezrocks). For EVERY role, at the owner's request
          (2026-09-27): the view is in FIELD_VIEWS, which every role inherits.
          Still gated on its own id, so a per-user denial in /admin hides it. */}
      {access.can("lopezrocks") && (
        <section className="mt-8">
          <SectionHeading className="mb-2">Community</SectionHeading>
          <ListCard>
            <ListRow
              href="/lopezrocks"
              label="LopezRocks"
              desc="Lopez Island's community board, easy to read on a phone"
            />
          </ListCard>
        </section>
      )}

    </main>
  );
}

export function HomeClient({ month, layout }: { month: MastheadMonth; layout: HomeLayout }) {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Home month={month} layout={layout} />
    </Suspense>
  );
}
