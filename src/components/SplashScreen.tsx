"use client";

import { useEffect, useRef, useState } from "react";
import { LINE_CYCLE_MS, LoadingScreen, msToEraseEnd } from "@/components/LoadingScreen";

/** The cover's fade once the line has erased. The ground is the page's own,
 *  so this only brings the page in. */
const FADE_MS = 250;
/** Under reduced motion the line stands still: re-check this often instead. */
const STILL_HOLD_MS = 200;
/** Never hold the cover longer than this for a page still streaming, so a
 *  stalled stream cannot hide the app. */
const MAX_MS = 10000;

/**
 * The app-open cover. It is in the server HTML, so it is the FIRST thing
 * painted — before the fonts load, before React hydrates, before any page data
 * arrives. The line starts on that first frame: it is a CSS animation, so it
 * needs no JS.
 *
 * Once the app is interactive (this effect runs on hydration), the cover waits
 * for the line to finish its current erase. If the page is still streaming in
 * then (`src/app/loading.tsx`'s marker is in the DOM), it plays one more whole
 * loop and checks again. When the page is in, it fades out and unmounts. So it
 * always ends on an empty ground, never with the line cut off mid-stroke.
 *
 * Mounted once per full page load (root layout), so it does not re-appear on
 * navigation — `RouteLoadingScreen` covers those.
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<"hold" | "fading" | "done">("hold");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const first = msToEraseEnd(ref.current, LINE_CYCLE_MS);
    // From one erase end, the next is one whole loop later.
    const step = first === null ? STILL_HOLD_MS : LINE_CYCLE_MS;
    const streaming = () =>
      !!document.querySelector("[data-page-streaming]") && performance.now() - started < MAX_MS;
    const atEraseEnd = () => {
      if (streaming()) {
        timer = setTimeout(atEraseEnd, step);
        return;
      }
      setPhase("fading");
      timer = setTimeout(() => setPhase("done"), FADE_MS);
    };
    timer = setTimeout(atEraseEnd, first ?? STILL_HOLD_MS);
    return () => clearTimeout(timer);
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
