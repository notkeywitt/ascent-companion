"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { isDesktop, SAVER_IDLE_MS, saverEnabled } from "@/lib/art/saver";

/**
 * The desktop screen saver's idle watch (owner, 2026-11-16). After five
 * minutes with no mouse, key, wheel or touch, on a computer with a mouse and a
 * wide screen, it opens the Job Flock full screen (FlockSaverStage). Only for
 * people who hold the `art` view, since the flock reads every bill line; and
 * only when this device has not turned it off on the Job Flock page.
 *
 * Nothing heavy loads until the saver starts: the stage, the simulation and
 * the rows come in on demand.
 */
const Stage = dynamic(() => import("@/app/art/flock/FlockSaverStage"), { ssr: false });

const ACTIVITY = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"] as const;
const CHECK_MS = 15_000;

export function FlockSaver() {
  const { can } = useAccess();
  const allowed = can("art");
  const [on, setOn] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    if (!allowed) return;
    last.current = Date.now();
    const seen = () => {
      last.current = Date.now();
    };
    for (const e of ACTIVITY) window.addEventListener(e, seen, { passive: true, capture: true });
    const timer = setInterval(() => {
      if (
        Date.now() - last.current >= SAVER_IDLE_MS &&
        document.visibilityState === "visible" &&
        isDesktop() &&
        saverEnabled()
      ) {
        setOn(true);
      }
    }, CHECK_MS);
    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, seen, { capture: true });
      clearInterval(timer);
    };
  }, [allowed]);

  const close = useCallback(() => {
    last.current = Date.now();
    setOn(false);
  }, []);

  return allowed && on ? <Stage onClose={close} /> : null;
}
