"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Loading } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { setPendingPhotos } from "@/app/deposit-tracker/pendingPhotos";

const Sheet = dynamic(() => import("@/components/Sheet").then((m) => m.Sheet), { ssr: false });
// jsQR is sizeable and only needed after a tap.
const QrScanner = dynamic(() => import("@/components/QrScanner").then((m) => m.QrScanner), {
  ssr: false,
  loading: () => <Loading label="Starting scanner…" />,
});

/**
 * The phone's four big buttons on the office Home, each gated by its own view.
 * Hidden where the main pointer is a mouse (a desktop): a camera button is no
 * use at a desk.
 *
 * A browser opens the camera only from a tap, so each button IS the control:
 *   Deposit check — the camera; the photos go to /deposit-tracker.
 *   Add bill      — the camera; the photo goes to /add-bill to be read.
 *   Scan tool     — the QR scanner in a sheet; the code goes to /tools, which
 *                   opens its relocate dialog (or New tool for an unknown code).
 *   Record miles  — starts the trip on /mileage-tracker; a link under it opens
 *                   the By hand tab.
 * Photos cross the navigation in module state (deposit-tracker/pendingPhotos).
 */
export function HomeActions() {
  const { can } = useAccess();
  const router = useRouter();
  const depositCam = useRef<HTMLInputElement>(null);
  const billCam = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState("");
  const scanUsed = useUsed(scanning);

  const deposit = can("deposit-tracker");
  const bill = can("recode");
  const tools = can("tools");
  const miles = can("mileage");
  if (!deposit && !bill && !tools && !miles) return null;

  const take =
    (target: "deposit-tracker" | "add-bill") => (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (!files.length) return;
      setPendingPhotos(files, target);
      router.push(`/${target}`);
    };

  return (
    <section className="[@media(pointer:fine)]:hidden">
      <div className="grid grid-cols-2 items-start gap-2">
        {deposit && (
          <Big
            onClick={() => depositCam.current?.click()}
            title="Deposit check"
            desc="Photograph, mark paid"
            mark={<CameraMark />}
          />
        )}
        {bill && (
          <Big
            onClick={() => billCam.current?.click()}
            title="Add bill"
            desc="Photograph an invoice"
            mark={<CameraMark />}
          />
        )}
        {tools && (
          <Big
            onClick={() => {
              setScanErr("");
              setScanning(true);
            }}
            title="Scan tool"
            desc="Move it to this site"
            mark={<QrMark />}
          />
        )}
        {miles && (
          <div className="flex flex-col">
            <Big
              onClick={() => router.push("/mileage-tracker?start=1")}
              title="Record miles"
              desc="Start the trip"
              mark={<PinMark />}
            />
            <Link
              href="/mileage-tracker?tab=manual"
              className="mt-1 min-h-11 px-1 py-2 text-[12px] font-semibold text-accent"
            >
              Enter miles by hand
            </Link>
          </div>
        )}
      </div>

      <input
        ref={depositCam}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={take("deposit-tracker")}
      />
      <input
        ref={billCam}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={take("add-bill")}
      />

      {scanUsed && (
        <Sheet
          open={scanning}
          onClose={() => setScanning(false)}
          title="Scan a tool"
          expandable={false}
        >
          {scanning && (
            <QrScanner
              onDetect={(text) => {
                setScanning(false);
                router.push(`/tools?scan=${encodeURIComponent(text)}`);
              }}
              onError={setScanErr}
            />
          )}
          {scanErr && <p className="mt-2 text-[12px] text-danger">{scanErr}</p>}
        </Sheet>
      )}
    </section>
  );
}

/** True from the first time `open` is true: a lazy sheet mounts then and
 *  stays, so it still animates closed. */
export function useUsed(open: boolean): boolean {
  const [used, setUsed] = useState(false);
  if (open && !used) setUsed(true);
  return used;
}

function Big({
  onClick,
  title,
  desc,
  mark,
}: {
  onClick: () => void;
  title: string;
  desc: string;
  mark: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[104px] flex-col items-start justify-between rounded-xl border border-line bg-white p-3 text-left transition hover:border-line-strong active:scale-[0.98] dark:bg-ink-raised"
    >
      {mark}
      <span>
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[12px] text-neutral-500 dark:text-neutral-400">{desc}</span>
      </span>
    </button>
  );
}

const svg = "h-7 w-7 text-accent";

function CameraMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={svg}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function QrMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={svg}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18v2M18 14h2" />
    </svg>
  );
}

function PinMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={svg}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}
