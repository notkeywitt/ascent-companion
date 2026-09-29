"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { ListCard, ListRow, SectionHeading, btn } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { StuckVendorBanner } from "@/components/StuckVendors";
import { NeedsProjectBanner, useNeedsProjectCount } from "@/components/NeedsProject";
import { HomeTodos } from "@/components/HomeTodos";
import { HomeJobBoard } from "@/components/HomeJobBoard";
import { HomeLeadBoard } from "@/components/HomeLeadBoard";
import { HomeMasthead } from "@/components/HomeMasthead";
import { AppearanceCard } from "@/components/AppearanceCard";
import { DesktopAlertsCard } from "@/components/DesktopAlertsCard";

/**
 * The Assistant's front page — Today.
 *
 * It no longer lists pages. Since 2026-09-29 every page is in the header's ☰
 * menu and the bottom bar (both from src/lib/workspaces.ts), so the launchers
 * that used to fill this page — the admin cards, the tile grid, All Pages —
 * are gone. What stays is what needs the person today: the billing month, the
 * stuck and unassigned bills, the job and lead boards, and the to-dos. Stage 2
 * of NAVIGATION_PLAN.md turns it into one queue with a count per row.
 */

function Home() {
  const access = useAccess();
  const router = useRouter();

  /* A crew member opens this app to clock in, so FIELD lands on Employee Time
     rather than here. Once per tab: the redirect marks the tab, so the menu's
     Today row still reaches this page for the rest of the session.
     Client-side because the role only exists below the server layout. */
  useEffect(() => {
    if (access.role !== "field") return;
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

      {/* The two per-device settings blocks. Side by side from `pad` up: each
          is a collapsed one-line heading most of the time, and two of those
          stacked own a slab of an iPad's last screen for nothing.

          Desktop alerts self-hides on any browser without the Notification
          API — i.e. every iPhone — so it only shows where it can deliver. */}
      <div className="pad:grid pad:grid-cols-2 pad:items-start pad:gap-7">
        <AppearanceCard />
        <DesktopAlertsCard />
      </div>

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

      {/* Account / sign out. Access (which menus you see) is baked in at
          sign-in, so signing out and back in is how you pick up a changed
          role — e.g. if the launcher is missing sections you expect, your
          session may still be on the default "field" role. */}
      <div className="mt-8 border-t border-line pt-5 text-center">
        <p className="text-xs text-neutral-500">
          Signed in — access level: <span className="font-semibold">{access.role}</span>
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className={btn("secondary", "md", "mt-3")}
        >
          Sign out
        </button>
        <p className="mx-auto mt-2 max-w-sm text-xs text-neutral-500">
          Missing menus you expect? Sign out and back in to refresh your access.
        </p>
      </div>
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
