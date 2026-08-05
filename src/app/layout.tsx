import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { AccessProvider } from "@/components/AccessProvider";
import { RefreshBoundary, RefreshProvider } from "@/components/RefreshProvider";
import { StuckVendorPopup, StuckVendorsProvider } from "@/components/StuckVendors";
import { UsageBeacon } from "@/components/UsageBeacon";
import { auth } from "@/auth";
import { ALL_VIEW_IDS, resolveAllowedViews, type Role } from "@/lib/views";

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
  const devOpen = !process.env.AUTH_GOOGLE_ID && !process.env.APP_PASSWORD;
  let role: Role = "field";
  let views: string[] = [];
  if (session?.user) {
    role = session.user.role ?? "field";
    views = [...resolveAllowedViews(role, session.user.viewsAllow, session.user.viewsDeny)];
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
              <StuckVendorPopup />
            </StuckVendorsProvider>
          </RefreshProvider>
        </AccessProvider>
      </body>
    </html>
  );
}
