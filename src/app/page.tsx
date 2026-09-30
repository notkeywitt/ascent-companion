"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListCard, ListRow, SectionHeading, btn } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { StuckVendorBanner } from "@/components/StuckVendors";
import { NeedsProjectBanner, useNeedsProjectCount } from "@/components/NeedsProject";
import { HomeTodos } from "@/components/HomeTodos";
import { HomeJobBoard } from "@/components/HomeJobBoard";
import { HomeLeadBoard } from "@/components/HomeLeadBoard";
import { HomeMasthead } from "@/components/HomeMasthead";
import { TodayQueue } from "@/components/TodayQueue";
import { TodayOfficeTodos } from "@/components/TodayOfficeTodos";

/**
 * The Assistant's front page — Today.
 *
 * It no longer lists pages. Since 2026-09-29 every page is in the header's ☰
 * menu and the bottom bar (both from src/lib/workspaces.ts), so the launchers
 * that used to fill this page — the admin cards, the tile grid, All Pages —
 * are gone. What stays is what needs the person today: the billing month, the
 * queue (TodayQueue — a row and a count per thing waiting), the stuck and
 * unassigned bills, the job and lead boards, and the to-dos. Appearance,
 * desktop alerts and Sign out live in the ☰ menu.
 */

function Home() {
  const access = useAccess();
  const router = useRouter();

  /* A crew member opens this app to clock in, so FIELD and LEAD land on
     Employee Time rather than here (lead added 2026-09-30, owner). Once per
     tab: the redirect marks the tab, so a fresh app open lands on Time and the
     bar's Today slot (lead) or the menu still reaches this page afterwards.
     Client-side because the role only exists below the server layout. */
  useEffect(() => {
    if (access.role !== "field" && access.role !== "lead") return;
    // The Chrome side panel opens "/?jobId=…" to follow the JobTread job on
    // screen; that is a request for this page, not an app open.
    if (new URLSearchParams(window.location.search).has("jobId")) return;
    try {
      if (sessionStorage.getItem("home.landed")) return;
      sessionStorage.setItem("home.landed", "1");
    } catch {
      return; // storage blocked — leave them here rather than loop.
    }
    router.replace("/employee-time");
  }, [access.role, router]);
  const needsProject = useNeedsProjectCount();

  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-5 pad:max-w-none pad:px-7 xl:px-8">
      {/* No page title here ON A PHONE, on purpose: the logo in the header
          already says where you are, and an <h1>Home</h1> plus its description
          cost the top fifth of a phone screen to repeat it. From `pad` up the
          screen is a foot tall and the same band costs nothing, so the masthead
          below draws the heading — and stands the billing month on it, which is
          the fact this office checks before it opens anything. */}
      <HomeMasthead />

      {/* What needs this person — one row per queue, each with its count. */}
      <TodayQueue />

      {/* Bills that imported but couldn't push because their vendor isn't in
          JobTread. Self-hiding when there are none; gates itself on `email`. */}
      <StuckVendorBanner />

      {/* Ingested bills whose job couldn't be resolved (Sunset "Sold-To" names a
          customer with more than one job). Self-hiding when the queue is empty. */}
      <NeedsProjectBanner state={needsProject} />

      {/* Budget + calendar position for the work in flight — a card per active
          job for office/admin, one wide panel for a lead's own job. Self-hiding,
          and a field phone never fetches it (see HomeJobBoard). */}
      <HomeJobBoard />

      {/* The pipeline, as the same kanban row of cards — ordered by last
          contact so a lead going quiet is the first thing on it. Collapsible
          and remembered per device; self-gating on the `leads` view, so office
          and admin get it and a field or lead phone never fetches it. */}
      <HomeLeadBoard />

      {/* To Dos — your open JobTread to-dos, a form that creates one, and the
          morning digest's other findings (calendar, follow-ups) under them. The
          to-dos are read live; the digest half is the report the scheduled job
          stored, and this does NOT run the checks on load. Self-hiding: renders
          nothing without the `digest` view, which is ADMIN-ONLY as of
          2026-09-08. Office, lead and field all load this same page and pay
          nothing for it. Only admin gets "Refresh", which is a separate check —
          see HomeTodos.tsx. */}
      <HomeTodos />

      {/* The Office job's to-dos, under the "office" view — the same list and
          edits as the Office dashboard. With HomeTodos above, Today holds both
          to-do lists, each under its own gate. */}
      <TodayOfficeTodos />

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

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Home />
    </Suspense>
  );
}
