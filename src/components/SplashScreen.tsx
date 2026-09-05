"use client";

import { useEffect, useState } from "react";
import { LoadingScreen } from "@/components/LoadingScreen";

/** How long the logo holds before it starts to fade, and the fade itself. */
const HOLD_MS = 500;
const FADE_MS = 450;

/**
 * The app-open cover. It is in the server HTML, so it is the FIRST thing
 * painted — before the fonts load, before React hydrates, before any page data
 * arrives. It clears itself once the app is interactive: the effect below runs
 * on hydration, holds the logo briefly, then fades out and unmounts.
 *
 * Mounted once per full page load (root layout), so it does not re-appear on
 * navigation — `src/app/loading.tsx` covers those.
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<"hold" | "fading" | "done">("hold");

  useEffect(() => {
    const fade = setTimeout(() => setPhase("fading"), HOLD_MS);
    const end = setTimeout(() => setPhase("done"), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(end);
    };
  }, []);

  if (phase === "done") return null;
  return (
    <LoadingScreen
      className={`transition-opacity duration-[450ms] ease-out ${phase === "fading" ? "opacity-0" : "opacity-100"}`}
    />
  );
}
