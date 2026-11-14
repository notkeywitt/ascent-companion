"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { toast } from "@/components/Toast";
import { SAVE_EVENT, flushOutbox, type SaveEvent } from "@/lib/mileageOutbox";

/**
 * Sends any mileage trip save the phone still holds (src/lib/mileageOutbox.ts):
 * on app open, when the connection comes back, and when the app comes back on
 * screen. Mounted once in layout.tsx, so a trip ended just before the app
 * closed saves on the next open, whatever page opens. Off the mileage page, a
 * save that lands says so in a toast; the page shows its own summary.
 */
export function MileageOutbox() {
  const pathname = usePathname();

  useEffect(() => {
    void flushOutbox();
    const onOnline = () => void flushOutbox();
    const onVisible = () => {
      if (document.visibilityState === "visible") void flushOutbox();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (pathname?.startsWith("/mileage-tracker")) return;
    const onSave = (e: Event) => {
      const ev = (e as CustomEvent<SaveEvent>).detail;
      if (ev?.outcome !== "ok") return;
      const miles = ev.reply.miles;
      toast("Trip saved", { description: typeof miles === "number" ? `${miles} mi` : undefined });
    };
    window.addEventListener(SAVE_EVENT, onSave);
    return () => window.removeEventListener(SAVE_EVENT, onSave);
  }, [pathname]);

  return null;
}
