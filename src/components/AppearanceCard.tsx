"use client";

import { useEffect, useState } from "react";
import { Card, SectionHeading, SectionLabel } from "@/components/ui";
import {
  PALETTES,
  PALETTE_DESC,
  PALETTE_LABEL,
  applyPalette,
  readPalette,
  type Palette,
} from "@/lib/palette";

/**
 * Appearance — the two per-device display choices, in one place.
 *
 * PALETTE picks which set of colours the app paints (Guidelines or Website).
 * THEME picks light or dark within it. They are independent, so all four
 * combinations are real; see src/lib/palette.ts and THEME.md.
 *
 * Both live in localStorage, so they are PER DEVICE: the office desktop and a
 * phone in the field can differ, and nothing is written to the account. The
 * header logo still flips light/dark on a tap — this is the same switch with a
 * label on it, for anyone who never found the tap.
 *
 * It renders on the home page, above the account footer, because that is the
 * one screen every role lands on.
 */
/** Ground + fill per palette per theme — the two squares on each choice. */
const SWATCH: Record<Palette, Record<"light" | "dark", { ground: string; fill: string }>> = {
  guidelines: {
    light: { ground: "#FAF7EE", fill: "#CF9803" },
    dark: { ground: "#1B1B17", fill: "#CF9803" },
  },
  website: {
    light: { ground: "#FAF7EE", fill: "#1B1B1B" },
    dark: { ground: "#0A0A0A", fill: "#FFFFFF" },
  },
};

export function AppearanceCard() {
  // Both start at their defaults and are corrected on mount. The server has no
  // way to know a localStorage value, so rendering the real one straight away
  // would be a hydration mismatch.
  const [palette, setPalette] = useState<Palette>("guidelines");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setPalette(readPalette());
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function pickPalette(p: Palette) {
    applyPalette(p);
    setPalette(p);
  }

  function pickTheme(next: boolean) {
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  }

  return (
    <section className="mt-8 text-left">
      <SectionHeading>Appearance</SectionHeading>
      <Card className="mt-3" pad={false}>
        <div className="border-b border-line-soft p-4">
          <SectionLabel>Colours</SectionLabel>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {PALETTES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => pickPalette(p)}
                aria-pressed={palette === p}
                className={`rounded-xl border p-3 text-left transition ${
                  palette === p
                    ? "border-accent ring-2 ring-accent/25"
                    : "border-line hover:border-line-strong"
                }`}
              >
                {/* Two squares: the palette's ground, then the colour a filled
                    button takes on it. Fixed hex rather than tokens, because a
                    swatch has to show the palette you are NOT in — and read
                    against the CURRENT theme, which is why both squares follow
                    `dark`. Guidelines fills ochre in either theme; Website
                    fills with whichever of its two values the ground is not. */}
                <span aria-hidden className="flex gap-1">
                  <span
                    className="h-5 w-5 rounded border border-black/10 dark:border-white/15"
                    style={{ background: SWATCH[p][dark ? "dark" : "light"].ground }}
                  />
                  <span
                    className="h-5 w-5 rounded border border-black/10 dark:border-white/15"
                    style={{ background: SWATCH[p][dark ? "dark" : "light"].fill }}
                  />
                </span>
                <span className="mt-2 block text-sm font-semibold">{PALETTE_LABEL[p]}</span>
                <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                  {PALETTE_DESC[p]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <SectionLabel>Theme</SectionLabel>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              Tapping the logo up top does this too.
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {[
              { on: false, label: "Light" },
              { on: true, label: "Dark" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => pickTheme(o.on)}
                aria-pressed={dark === o.on}
                className={`min-h-11 rounded-full border px-4 text-[12.5px] font-semibold transition ${
                  dark === o.on
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-line text-neutral-500 hover:border-accent dark:text-neutral-400"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </Card>
    </section>
  );
}
