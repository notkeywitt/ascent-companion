import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { AccessProvider } from "@/components/AccessProvider";
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
    <html lang="en" className={roboto.variable}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme:dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <AccessProvider role={role} views={views}>
          <Suspense fallback={null}>
            <AppHeader />
          </Suspense>
          {children}
        </AccessProvider>
      </body>
    </html>
  );
}
