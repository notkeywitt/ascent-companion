"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { SectionHeading } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { setPendingPhotos } from "@/app/deposit-tracker/pendingPhotos";

/**
 * The button panel on Today — one big button per thing the admin does from a
 * phone, each gated by its own view. Self-hiding when the person can open none.
 *
 * To add a button: add an entry to the grid below with its view id. A button
 * that needs the camera must open it HERE, from the tap, because a page cannot
 * open the camera on load.
 *
 * Desktop never shows the panel (owner, 2026-10-28): see the section's class.
 *
 * Deposit checks (the first button): the tap opens the camera, and the photo
 * goes to /deposit-tracker, which files it in JobTread and asks which invoices
 * it pays.
 */
export function HomeActions() {
  const access = useAccess();
  const router = useRouter();
  const camera = useRef<HTMLInputElement>(null);

  if (!access.can("deposit-tracker")) return null;

  return (
    // Phones and iPads only: hidden where the main pointer is a mouse (a
    // desktop), the same touch test globals.css uses. A camera button is no use
    // at a desk; the page stays in the Jobs menu there.
    <section className="mt-6 [@media(pointer:fine)]:hidden">
      <SectionHeading className="mb-2">Actions</SectionHeading>
      <div className="grid grid-cols-2 gap-2 pad:grid-cols-4">
        <button
          type="button"
          onClick={() => camera.current?.click()}
          className="flex min-h-[88px] flex-col items-start justify-between rounded-xl border border-line bg-white p-3 dark:bg-ink-raised text-left transition hover:border-line-strong active:scale-[0.98]"
        >
          <CameraMark />
          <span>
            <span className="block text-sm font-semibold">Deposit checks</span>
            <span className="block text-[12px] text-neutral-500 dark:text-neutral-400">Photograph, mark paid, email</span>
          </span>
        </button>
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          setPendingPhotos(files);
          router.push("/deposit-tracker");
        }}
      />
    </section>
  );
}

function CameraMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
