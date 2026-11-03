"use client";

import { useEffect, useState } from "react";

/**
 * A line under the loading screen's logo on the first load after a deploy:
 * "Ascent was just updated…".
 *
 * WHY: the first request after a deploy that changes the database schema
 * re-runs schema setup (~110 statements, ~11 s — see SCHEMA_FINGERPRINT in
 * src/db/index.ts). Without a word on screen, that reads as the app hanging.
 *
 * HOW: this device remembers the build it last finished loading. When the
 * bundle's build differs, the notice shows. The new build is recorded at the
 * window's `load` event, NOT when a cover unmounts: the app-open cover
 * (SplashScreen) clears after ~0.45 s, long before a slow page arrives. A
 * streamed page keeps the document loading until the page itself is in, so
 * `load` marks the real end of the wait. A device with nothing stored (first
 * visit, cleared storage) shows nothing.
 *
 * It is per device, so it may also show after a deploy that changed no schema.
 * That is why the wording says "can take", not "will take".
 */
const KEY = "ascent.lastLoadedBuild";
const BUILD = process.env.APP_BUILD_SHA || "";

export function UpdateNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!BUILD) return;
    try {
      const last = window.localStorage.getItem(KEY);
      if (last && last !== BUILD) setShow(true);
    } catch {
      /* storage blocked: say nothing */
    }
    const record = () => {
      try {
        window.localStorage.setItem(KEY, BUILD);
      } catch {
        /* storage blocked: nothing to record */
      }
    };
    // An in-app tap mounts this after the document finished loading.
    if (document.readyState === "complete") {
      record();
      return;
    }
    // Not removed on unmount: the app-open cover unmounts before `load`, and on
    // a fast page it is the only instance. Writing the same value twice is harmless.
    window.addEventListener("load", record, { once: true });
  }, []);

  if (!show) return null;
  return (
    <p className="max-w-xs px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
      Ascent was just updated. The first load after an update can take up to 15 seconds.
    </p>
  );
}
