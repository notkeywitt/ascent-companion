/**
 * The desktop screen saver's settings and its random pick. The saver itself
 * is src/components/FlockSaver.tsx (the idle watch) and
 * src/app/art/flock/FlockSaverStage.tsx (the full-screen flock).
 */
import type { CloudSetId } from "./cloud";
import { ART_PRESETS } from "./scheme";

/** Minutes with no mouse, key, wheel or touch before the saver starts. */
export const SAVER_IDLE_MS = 5 * 60_000;

const KEY = "art-flock-saver";

/** On unless this device turned it off (Job Flock page). */
export function saverEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSaverEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* not saved */
  }
}

/** A computer with a mouse and a wide screen: where a screen saver belongs. */
export function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: fine) and (min-width: 1024px)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface SaverPick {
  set: Extract<CloudSetId, "bills" | "labor">;
  by: "job" | "vendor" | "division" | "type" | "person";
  preset: string;
  /** Edges wrap around instead of being walls. */
  wrap: boolean;
  space: "flat" | "3d";
}

/** A random data set, grouping, colour preset, kind of edge and space. Only dated sets: the saver
 *  always runs the year. */
export function randomPick(rand: () => number = Math.random): SaverPick {
  const set = rand() < 0.5 ? "bills" : "labor";
  const groupings: SaverPick["by"][] = set === "bills" ? ["job", "vendor", "division", "type"] : ["job", "person", "division"];
  const by = groupings[Math.floor(rand() * groupings.length)];
  const preset = ART_PRESETS[Math.floor(rand() * ART_PRESETS.length)].id;
  return { set, by, preset, wrap: rand() < 0.5, space: rand() < 0.5 ? "flat" : "3d" };
}
