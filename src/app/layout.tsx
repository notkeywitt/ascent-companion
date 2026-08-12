import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { AccessProvider } from "@/components/AccessProvider";
import { CopyProvider } from "@/components/CopyProvider";
import { RefreshBoundary, RefreshProvider } from "@/components/RefreshProvider";
import { StuckVendorPopup, StuckVendorsProvider } from "@/components/StuckVendors";
import { NoticePopup } from "@/components/Notices";
import { UsageBeacon } from "@/components/UsageBeacon";
import { auth } from "@/auth";
import { ALL_VIEW_IDS, resolveAllowedViews, type Role } from "@/lib/views";
import { loadCopyOverrides } from "@/lib/copyService";

// Brand web typeface (Brand Guidelines p.22 — Roboto is the sanctioned web
// alternative to the print primary, LL Medium). Exposed as a CSS var wired into
// Tailwind's `font-sans` so the whole app renders in it.
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

// Monospace is still wanted where columns must line up (log output, CSV import
// previews), but the browser default for `font-mono` is Courier, which reads as
// a different typeface entirely. Roboto Mono keeps the alignment inside the
// brand family, so nothing in the app renders as Courier.
const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-roboto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ascent Assistant",
  description: "JobTread coding, unbilled expenses, and invoice staging",
  appleWebApp: {
    capable: true,
    title: "Ascent",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF7EE" },
    { media: "(prefers-color-scheme: dark)", color: "#1B1B17" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve the signed-in user's role + view set once, server-side, and hand it
  // to the (client) nav so it renders only what they can see. When neither auth
  // mechanism is configured (local dev) the app is open, so treat as admin/all.
  const session = await auth();
  // Office-edited page copy (Admin → Page Text). Read alongside the session so
  // edited wording is server-rendered — no client fetch, no flash of old text.
  // Falls back to {} (i.e. the shipped English) if the DB is unreachable.
  const copyOverrides = await loadCopyOverrides();
  const devOpen = !process.env.AUTH_GOOGLE_ID && !process.env.APP_PASSWORD;
  let role: Role = "field";
  let views: string[] = [];
  if (session?.user) {
    role = session.user.role ?? "field";
    views = [
      ...resolveAllowedViews(role, session.user.viewsAllow, session.user.viewsDeny, session.user.roleBase),
    ];
  } else if (devOpen) {
    role = "admin";
    views = ALL_VIEW_IDS;
  }

  return (
    <html lang="en" className={`${roboto.variable} ${robotoMono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme:dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        {/* Track page views for signed-in users (Admin → Activity). The route
            no-ops without a session, so it's inert in dev-open mode too. */}
        {session?.user && <UsageBeacon />}
        <CopyProvider overrides={copyOverrides}>
        <AccessProvider role={role} views={views}>
          {/* Global refresh: the header's button remounts the page subtree
              (RefreshBoundary keys {children}) so every page's mount-time /api
              fetch re-runs, plus router.refresh() for anything server-rendered.
              Wraps the header too, so the button can reach it via context. */}
          <RefreshProvider>
            {/* Bills whose vendor has no JobTread account are imported but never
                pushed, and the failure is otherwise invisible. The provider checks
                once per load (only for users who can act on it); the popup finds
                them on whatever page they opened, and the Home banner keeps it
                visible after the popup is dismissed. */}
            <StuckVendorsProvider>
              <Suspense fallback={null}>
                <AppHeader />
              </Suspense>
              <RefreshBoundary>{children}</RefreshBoundary>
              {/* Bottom tab bar — the fast path between the pages opened all
                  day. Gated on the same view ids as the launcher, so it only
                  ever shows destinations this role can actually reach. */}
              <Suspense fallback={null}>
                <TabBar />
              </Suspense>
              <StuckVendorPopup />
              {/* Admin-pushed announcements — shown to signed-in users on
                  whatever page they opened. Self-fetches its own scoped feed. */}
              {session?.user && <NoticePopup />}
            </StuckVendorsProvider>
          </RefreshProvider>
        </AccessProvider>
        </CopyProvider>
      </body>
    </html>
  );
}
