import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";

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
  title: "Ascent Companion",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <Suspense fallback={null}>
          <AppHeader />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
