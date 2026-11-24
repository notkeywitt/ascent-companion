"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ART_PRESETS } from "@/lib/art/scheme";
import { randomPick } from "@/lib/art/saver";
import { schemeStyle } from "../SchemePicker";
import { ArtCanvas, useArtRows } from "../artKit";
import { FLOCK_BY, FlockEngine } from "./flockEngine";

/**
 * The desktop screen saver: a full-screen Job Flock running the year, with a
 * random data set, grouping and colour preset (src/lib/art/saver.ts). The
 * pointer still scatters the birds. A click or a key closes it, and that
 * click goes no further: it lands on this layer, not the page under it.
 * Loaded on demand by src/components/FlockSaver.tsx.
 */
export default function FlockSaverStage({ onClose }: { onClose: () => void }) {
  const pick = useMemo(() => randomPick(), []);
  const { rows, error } = useArtRows(pick.set);
  const engine = useRef(new FlockEngine()).current;
  const [shown, setShown] = useState(false);

  useMemo(() => {
    engine.year = true;
    engine.loopMs = 150_000;
  }, [engine]);
  useMemo(() => {
    if (!rows) return;
    engine.setData(pick.set, rows as unknown[], pick.by);
    engine.wrap = pick.wrap;
    // Start somewhere around the middle of the work, so two sessions differ.
    engine.t += (Math.random() - 0.5) * 60;
  }, [engine, rows, pick]);

  // Fade in once there is something to show; give up quietly on a failed read.
  useEffect(() => {
    if (error) onClose();
    if (!rows) return;
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, [rows, error, onClose]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", key, { capture: true });
    return () => window.removeEventListener("keydown", key, { capture: true });
  }, [onClose]);

  const byLabel = FLOCK_BY[pick.set].find((o) => o.value === pick.by)?.label.toLowerCase();
  const presetName = ART_PRESETS.find((p) => p.id === pick.preset)?.name;

  return (
    <div
      role="dialog"
      aria-label="Screen saver. Click or press a key to return."
      className={`fixed inset-0 z-[100] cursor-crosshair bg-white transition-opacity duration-1000 dark:bg-ink ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      style={schemeStyle({ preset: pick.preset })}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      {rows && (
        <ArtCanvas
          fill
          draw={engine.draw}
          label="Job Flock screen saver"
          onPointer={(x, y) => engine.poke(x, y, 400)}
          onLeave={() => engine.calm()}
        />
      )}
      <div
        className="pointer-events-none absolute bottom-10 right-6 text-right text-xs text-neutral-500"
        style={{ paddingRight: "env(safe-area-inset-right, 0px)" }}
      >
        <div className="font-semibold">Job Flock</div>
        <div>
          {pick.set === "bills" ? "Bill lines" : "Crew time"} by {byLabel} · {presetName}
        </div>
        <div>Click or press any key to return</div>
      </div>
    </div>
  );
}
