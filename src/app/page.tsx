"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { CountBadge, ListCard, ListRow, SectionHeading, btn } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { AdminActionBar } from "@/components/AdminActionBar";
import { StuckVendorBanner } from "@/components/StuckVendors";
import { NeedsProjectBanner, useNeedsProjectCount } from "@/components/NeedsProject";
import { DailyDigest } from "@/components/DailyDigest";
import { TileLauncher } from "@/components/TileLauncher";
import { HomeLayoutEditor } from "@/components/HomeLayoutEditor";
import { useEffectiveLayout } from "@/components/NavLayoutProvider";
import { PREVIEW_ROWS, tileLauncherFor } from "@/lib/nav";

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

function Home() {
  const search = useSearchParams();
  const access = useAccess();
  // Office-edited wording (Admin → Page Text); falls back to the English below.
  const c = useCopy();
  const jobId = (search.get("jobId") ?? "").trim();
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";

  // Which areas the user has expanded past their preview rows.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // The admin launcher's layout — the shipped AREAS default, or the admin's
  // customized menus/links/buttons (Edit mode). `isCustom` tells us whether the
  // stored strings are authoritative or whether we still resolve wording through
  // the copy registry (so office Page-Text edits keep working on the default).
  const { menus, isCustom } = useEffectiveLayout();

  // Home-layout Edit mode (admin only — see the button below).
  const [editing, setEditing] = useState(false);

  // Show only what this user can access; hide an area whose links all filter out.
  //
  // Every user-visible string is resolved through `c()` HERE, at the one place
  // the lists are built, so the rows and the headings read the same
  // (possibly office-edited) wording — see src/lib/copy.ts. The `|| a.title`
  // fallbacks mean a destination added to AREAS but not yet registered renders
  // its inline English instead of going blank.
  // On the SHIPPED launcher, wording still resolves through the copy registry so
  // an office Page-Text edit shows here; on a CUSTOM launcher the stored strings
  // are authoritative (the Edit surface is the naming surface). An item with an
  // empty `view` is a link everyone with this launcher can see; otherwise it's
  // gated exactly as before via `access.can`.
  const areas = useMemo(
    () =>
      menus
        .map((m) => ({
          id: m.id,
          title: isCustom ? m.title : c(`home.area.${m.id}.title`) || m.title,
          blurb: isCustom ? m.blurb : c(`home.area.${m.id}.blurb`) || m.blurb,
          preview: m.preview,
          items: m.items
            .filter((it) => it.view === "" || access.can(it.view))
            .map((it) => ({
              ...it,
              label: isCustom ? it.label : c(`home.dest.${it.view}.label`) || it.label,
              desc: isCustom ? it.desc : c(`home.dest.${it.view}.desc`) || it.desc,
            })),
        }))
        .filter((a) => a.items.length > 0),
    [menus, isCustom, access, c],
  );

  // Queue counts, keyed by view id. Add a future queue here and both the area
  // heading and its row pick it up with no further plumbing.
  const needsProject = useNeedsProjectCount();
  const badges: Record<string, number> =
    needsProject.count > 0 ? { "needs-project": needsProject.count } : {};

  // Field, lead, and office get a different launcher entirely: large buttons
  // ending in "The Rest", instead of the admin area lists. Rendered here rather
  // than as its own route so the phone's home button, the PWA icon, and every
  // "/" link land on the right launcher without anyone choosing a URL. The
  // banners and the digest above are all self-gating, so they cost a field
  // phone nothing; the account footer stays, because signing out and back in
  // is how a changed role is picked up.
  const tiles = tileLauncherFor(access.role) !== null;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-5">
      {/* No page title here on purpose: the logo in the header already says
          where you are, and an <h1>Home</h1> plus its description cost the top
          fifth of a phone screen to repeat it. */}

      {/* Bills that imported but couldn't push because their vendor isn't in
          JobTread. Self-hiding when there are none; gates itself on `email`. */}
      <StuckVendorBanner />

      {/* Ingested bills whose job couldn't be resolved (Sunset "Sold-To" names a
          customer with more than one job). Self-hiding when the queue is empty. */}
      <NeedsProjectBanner state={needsProject} />

      {/* The morning digest — billing scan, calendar, follow-ups. Reads the
          digest the scheduled job stored; it does NOT run the checks on load.
          Self-hiding: renders nothing without the `digest` view — office and
          admin hold it, so a field or lead phone loading this same page pays
          nothing for it. Office reads the stored digest and can reply to it;
          only admin gets the "Refresh now" button (see DailyDigest.tsx). */}
      <DailyDigest />

      {tiles ? (
        <TileLauncher qs={qs} />
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
          {access.role === "admin" && (
            // The one control that opens Edit mode. Admin-only: only admin sees
            // this launcher, and only admin can write the layout.
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[11px] font-semibold text-accent hover:underline dark:text-accent-soft"
              >
                Edit home page
              </button>
            </div>
          )}
          {areas.map((area) => {
            const buttons = area.items.filter((it) => it.kind === "button");
            const links = area.items.filter((it) => it.kind !== "button");
            const previewRows = area.preview ?? PREVIEW_ROWS;
            const isExpanded = !!expanded[area.id];
            const hidden = Math.max(0, links.length - previewRows);
            const shown = isExpanded ? links : links.slice(0, previewRows);
            // Work queued behind the fold still shows on the heading, so a
            // collapsed tail never hides the one row that needs attention.
            const hiddenCount = links
              .slice(shown.length)
              .reduce((n, d) => n + (badges[d.view] ?? 0), 0);
            return (
              <section key={area.id} className="space-y-2">
                <SectionHeading
                  trailing={
                    <span className="flex items-center gap-2">
                      {hiddenCount > 0 && <CountBadge n={hiddenCount} />}
                      <span className="text-[11px] tabular-nums text-neutral-500">
                        {area.items.length}
                      </span>
                    </span>
                  }
                >
                  {area.title}
                </SectionHeading>

                {/* Buttons first — the prominent tiles, in a 2-across grid. */}
                {buttons.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {buttons.map((b) => (
                      <Link
                        key={b.id}
                        href={b.href + qs}
                        className="flex min-h-[64px] flex-col justify-center rounded-xl border border-line bg-white px-3 py-2 text-center transition hover:border-accent hover:bg-accent/5 dark:bg-ink-raised"
                      >
                        <span className="flex items-center justify-center gap-1.5 text-sm font-semibold tracking-tight">
                          {b.label}
                          {(badges[b.view] ?? 0) > 0 && <CountBadge n={badges[b.view]} />}
                        </span>
                        {b.desc && (
                          <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-neutral-400">
                            {b.desc}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                )}

                {links.length > 0 && (
                  <ListCard>
                    {shown.map((d) => (
                      <ListRow
                        key={d.id}
                        href={d.href + qs}
                        label={d.label}
                        desc={d.desc}
                        badge={(badges[d.view] ?? 0) > 0 ? <CountBadge n={badges[d.view]} /> : undefined}
                      />
                    ))}
                    {hidden > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpanded((e) => ({ ...e, [area.id]: !isExpanded }))}
                        aria-expanded={isExpanded}
                        className="min-h-11 w-full px-3 py-2.5 text-left text-[12.5px] font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
                      >
                        {isExpanded ? "Show fewer" : `Show ${hidden} more in ${area.title}`}
                      </button>
                    )}
                  </ListCard>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Admin-only: quick-jump links to the busiest queues plus buttons that
          run a script job without leaving the launcher. Sits at the bottom, out
          of the field/office user's way. Gated on the same `actions` view as the
          /actions page and the /api/actions route. */}
      {access.can("actions") && (
        <div className="mt-6">
          <AdminActionBar jobQs={qs} />
        </div>
      )}

      {/* No views at all — don't leave a blank page. This happens when the
          session carries no identity/role (e.g. signed in with the temporary
          shared password rather than Google). Offer a way back to Google. */}
      {!tiles && areas.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-8 text-center dark:border-neutral-700">
          <p className="text-sm font-semibold">No views are available for your account yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-xs text-neutral-500">
            If you signed in with the temporary password, sign in with Google to load your
            access. Otherwise, ask an admin to grant you access.
          </p>
          <Link href="/login" className={btn("primary", "md", "mt-4")}>
            Sign in with Google
          </Link>
        </div>
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
