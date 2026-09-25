"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { CountBadge, btn } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { AllPagesMenu } from "@/components/AllPagesMenu";
import { StuckVendorBanner } from "@/components/StuckVendors";
import { NeedsProjectBanner, useNeedsProjectCount } from "@/components/NeedsProject";
import { useTimeSyncCount } from "@/components/TimeSyncCount";
import { HomeTodos } from "@/components/HomeTodos";
import { TileLauncher } from "@/components/TileLauncher";
import { HomeLayoutEditor } from "@/components/HomeLayoutEditor";
import { HomeJobBoard } from "@/components/HomeJobBoard";
import { HomeLeadBoard } from "@/components/HomeLeadBoard";
import { HomeMasthead } from "@/components/HomeMasthead";
import { useEffectiveLayout } from "@/components/NavLayoutProvider";
import { tileLauncherFor } from "@/lib/nav";
import type { NavItem } from "@/lib/navLayout";
import { HomeCards } from "@/components/HomeCards";
import { AppearanceCard } from "@/components/AppearanceCard";
import { DesktopAlertsCard } from "@/components/DesktopAlertsCard";

/**
 * The Assistant's front page — the launcher, and still the only place EVERY
 * gateable view is reachable from (the tab bar carries at most three shortcuts).
 * A new view must appear in AREAS — now in src/lib/nav.ts — or it becomes dead.
 *
 * There used to be a second, separate thing at the top: a 4-across rail of
 * "quick" tiles (Miles · Time · Tools · Reqs). But the permanent bottom tab bar
 * already carries those same everyday shortcuts, so the rail was repeating the
 * chrome directly above it — two rows of the same buttons before the launcher
 * proper even began. It's gone. Those five personal destinations now live in a
 * "My Work" area at the top of the list, so the whole page is one pattern —
 * open, hairline-divided area lists — and nothing is said twice.
 *
 * The page's own search field is gone for the same reason. It could only search
 * from HERE, and a second box on Bill Search searched bills; both are now the
 * one field in the header (src/components/GlobalSearch.tsx), which searches
 * pages, vendors, bills and line items from every page. This file just renders
 * the lists.
 *
 * TWO LAUNCHERS. The above describes what ADMIN sees. FIELD, LEAD, and OFFICE
 * all get <TileLauncher> instead: large buttons, ending in "The Rest", which
 * opens /more — a curated menu. Field and office get four buttons, lead six.
 * Both launchers read from src/lib/nav.ts (AREAS for the admin list,
 * TILE_LAUNCHERS for the buttons) and both gate every entry on the same view
 * ids.
 */

/**
 * A launcher BUTTON — the large tile. Used both inside a menu and, for the
 * buttons that belong to no menu, in the row above every menu.
 */
function LauncherButton({
  b,
  qs,
  badge = 0,
}: {
  b: Pick<NavItem, "id" | "href" | "label" | "desc">;
  qs: string;
  badge?: number;
}) {
  return (
    <Link
      href={b.href + qs}
      className="flex min-h-[64px] flex-col justify-center rounded-xl border border-line bg-white px-3 py-2 text-center transition hover:border-accent hover:bg-accent/5 dark:bg-ink-raised"
    >
      <span className="flex items-center justify-center gap-1.5 text-sm font-semibold tracking-tight">
        {b.label}
        {badge > 0 && <CountBadge n={badge} />}
      </span>
      {b.desc && (
        <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-neutral-400">
          {b.desc}
        </span>
      )}
    </Link>
  );
}

function Home() {
  const search = useSearchParams();
  const access = useAccess();
  const router = useRouter();

  /* A crew member opens this app to clock in, so FIELD lands on Employee Time
     rather than the launcher. Once per tab: the redirect marks the tab, so the
     tab bar's Home tab still reaches this page for the rest of the session.
     Client-side because the role only exists below the server layout. */
  useEffect(() => {
    if (access.role !== "field") return;
    try {
      if (sessionStorage.getItem("home.landed")) return;
      sessionStorage.setItem("home.landed", "1");
    } catch {
      return; // storage blocked — leave them on the launcher rather than loop.
    }
    router.replace("/employee-time");
  }, [access.role, router]);
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  // The admin launcher's layout — the shipped AREAS default, or the admin's
  // customized menus/links/buttons (Edit mode). `isCustom` tells us whether the
  // stored strings are authoritative or whether we still resolve wording through
  // the copy registry (so office Page-Text edits keep working on the default).
  const { menus, items: topItemsRaw } = useEffectiveLayout();

  // Home-layout Edit mode (admin only — see the button below).
  const [editing, setEditing] = useState(false);

  // Whether any card has a page this user can open — the empty state's test.
  const anyView = menus.some((m) =>
    m.items.some((it) => it.view === "" || access.can(it.view)),
  );

  // Buttons that belong to no menu — the launcher's own top row. Gated exactly
  // like a menu item, so one a role can't reach simply isn't there. These only
  // exist on a CUSTOM layout, so their strings are authoritative (no copy
  // registry lookup — the Edit surface is the naming surface).
  const topItems = useMemo(
    () => topItemsRaw.filter((it) => it.view === "" || access.can(it.view)),
    [topItemsRaw, access],
  );

  // Queue counts, keyed by view id. Add a future queue here and both the area
  // heading and its row pick it up with no further plumbing.
  const needsProject = useNeedsProjectCount();
  const timeSync = useTimeSyncCount();
  const badges: Record<string, number> = {
    ...(needsProject.count > 0 ? { "needs-project": needsProject.count } : {}),
    ...(timeSync > 0 ? { "time-sync": timeSync } : {}),
  };

  // Field, lead, and office get a different launcher entirely: large buttons
  // ending in "The Rest", instead of the admin area lists. Rendered here rather
  // than as its own route so the phone's home button, the PWA icon, and every
  // "/" link land on the right launcher without anyone choosing a URL. The
  // banners and the digest above are all self-gating, so they cost a field
  // phone nothing; the account footer stays, because signing out and back in
  // is how a changed role is picked up.
  const tiles = tileLauncherFor(access.role) !== null;

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

      {tiles ? (
        <TileLauncher qs={qs} badges={badges} />
      ) : editing ? (
        // Admin-only Edit mode: arrange, create, name, and delete menus, page
        // links, and buttons. Replaces the lists while open; Save re-reads the
        // launcher from the server (see HomeLayoutEditor / /api/admin/home-layout).
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-base font-semibold">Edit home page</h1>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-sm font-semibold text-neutral-500 hover:text-accent"
            >
              Close
            </button>
          </div>
          <HomeLayoutEditor onClose={() => setEditing(false)} />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Buttons outside every menu, across the top of the launcher. Two
              across on a phone, four from an iPad up. */}
          {topItems.length > 0 && (
            <div className="grid grid-cols-2 gap-2 pad:grid-cols-4">
              {topItems.map((b) => (
                <LauncherButton key={b.id} b={b} qs={qs} badge={badges[b.view] ?? 0} />
              ))}
            </div>
          )}

          {/* The menus, as cards in the job board's shape: a bold title, the
              pages as a plain list with each page's count beside it, and an
              optional headline chart. Drag-to-arrange and renaming live in
              the cards' own edit mode (see HomeCards). */}
          <HomeCards qs={qs} badges={badges} onAdvanced={() => setEditing(true)} />
        </div>
      )}

      {/* ALL PAGES — one collapsible menu of every page in the app, grouped by
          function. It replaced the Admin Actions bar on 2026-09-10: that bar
          ran three script jobs and linked to Tracking Sheets, and a script job
          belongs on /actions, which still carries all of them. What the bottom
          of the home page is for is FINDING a page — the launcher above shows
          three rows per menu and the office tile launcher shows four buttons,
          so nothing listed everything.

          OFFICE only, by role: a field or lead phone has the tile launcher
          and "The Rest", and forty rows is not that. ADMIN's cards replaced it
          (2026-09-25): every page is one "Add a page" pick away in their edit
          mode, and the header search finds the rest. Each row is still gated on
          its own view id inside the component, so a page office cannot open
          never renders. The ORDER and GROUPING are the admin's (Edit menu). */}
      {access.role === "office" && <AllPagesMenu qs={qs} />}

      {/* No views at all — don't leave a blank page. This happens when the
          session carries no identity/role (e.g. signed in with the temporary
          shared password rather than Google). Offer a way back to Google. */}
      {!tiles && !anyView && (
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

          Appearance sits here rather than on /more because /more is the tile
          launcher's overflow — office and admin never link to it. Desktop
          alerts self-hides on any browser without the Notification API — i.e.
          every iPhone — so it only shows where it can actually deliver. */}
      <div className="pad:grid pad:grid-cols-2 pad:items-start pad:gap-7">
        <AppearanceCard />
        <DesktopAlertsCard />
      </div>

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
