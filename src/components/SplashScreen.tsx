"use client";

import { useEffect, useRef, useState } from "react";
import { LINE_CYCLE_MS, LINE_ERASE_END, LoadingScreen } from "@/components/LoadingScreen";

/** The cover's fade once the line has erased. The ground is the page's own,
 *  so this only brings the page in. */
const FADE_MS = 250;
/** Hold under reduced motion, where the line stands still. */
const STILL_HOLD_MS = 200;

/**
 * The app-open cover. It is in the server HTML, so it is the FIRST thing
 * painted — before the fonts load, before React hydrates, before any page data
 * arrives. The line starts on that first frame: it is a CSS animation, so it
 * needs no JS.
 *
 * Once the app is interactive (this effect runs on hydration), the cover waits
 * for the line to finish its current erase, then fades out and unmounts. So it
 * ends on an empty ground, never with the line cut off mid-stroke. The cost is
 * up to one loop of the line (2.4 s) on a full load that hydrates early.
 *
 * Mounted once per full page load (root layout), so it does not re-appear on
 * navigation — `src/app/loading.tsx` covers those.
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<"hold" | "fading" | "done">("hold");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let hold = STILL_HOLD_MS;
    const anim = ref.current?.querySelector(".loading-line-wipe")?.getAnimations?.()[0];
    const now = anim?.currentTime;
    // No running animation means reduced motion: the line is still, keep the old hold.
    if (anim && typeof now === "number") {
      const into = now % LINE_CYCLE_MS;
      const eraseEnd = LINE_CYCLE_MS * LINE_ERASE_END;
      hold = into <= eraseEnd ? eraseEnd - into : 0;
    }
    const fade = setTimeout(() => setPhase("fading"), hold);
    const end = setTimeout(() => setPhase("done"), hold + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(end);
    };
  }, []);

  if (phase === "done") return null;
  return (
    // `contents`: the wrapper adds no box, so the fixed cover is unaffected.
    <div ref={ref} className="contents">
      <LoadingScreen
        // Duration comes from the constant rather than a Tailwind literal, so the
        // fade and the unmount timer above can never drift apart.
        style={{ transitionDuration: `${FADE_MS}ms` }}
        className={`transition-opacity ease-out ${phase === "fading" ? "opacity-0" : "opacity-100"}`}
      />
    </div>
  );
}
