"use client";

import { castKloi, useKloi } from "@/lib/kloi";

/** The Cast mark: a screen corner with signal arcs. */
export const CastIcon = ({ className = "h-[19px] w-[19px]" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`shrink-0 ${className}`}
    aria-hidden
  >
    <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
    <path d="M2 12a9 9 0 0 1 8 8M2 16a5 5 0 0 1 4 4M2 20h.01" />
  </svg>
);

/** Label for the cast control: the speaker's name while casting. */
export function castLabel(device: string | null): string {
  return device ? `Stop casting to ${device}` : "Cast KLOI to a speaker";
}

/**
 * "Cast KLOI" as a full button, for the home pages. Renders nothing until a
 * Cast speaker is on the network (never, outside Chrome).
 */
export function KloiCastButton({ className }: { className: string }) {
  const kloi = useKloi();
  if (!kloi.castReady && !kloi.castDevice) return null;
  return (
    <button type="button" onClick={castKloi} aria-pressed={!!kloi.castDevice} className={className}>
      <CastIcon className="mr-2 h-[18px] w-[18px]" />
      {kloi.castDevice ? `Casting to ${kloi.castDevice} — stop` : "Cast KLOI"}
    </button>
  );
}
