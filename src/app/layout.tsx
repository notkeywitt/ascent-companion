import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { TabBar } from "@/components/TabBar";

export const metadata: Metadata = {
  title: "Ascent Companion",
  description: "JobTread coding, unbilled expenses, and invoice staging",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme:dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <Suspense fallback={null}>
          <TabBar />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
