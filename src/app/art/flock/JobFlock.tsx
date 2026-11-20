"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { Banner, ChipScroller, FilterChip, Segmented, SectionLabel, Toggle } from "@/components/ui";
import { money0 } from "@/lib/money";
import type { CloudSetId } from "@/lib/art/cloud";
import { OTHER } from "@/lib/art/flock";
import { saverEnabled, setSaverEnabled } from "@/lib/art/saver";
import { SchemeChoices, schemeStyle, useArtScheme } from "../SchemePicker";
import { ArtCanvas, useArtRows } from "../artKit";
import { FLOCK_BY, FlockEngine, type FlockBy, type FlockSpace } from "./flockEngine";

/**
 * JOB FLOCK (owner, 2026-11-16). A boids simulation: every row is a bird, and
 * birds flock with their own group (src/lib/art/flock.ts). Groups that share
 * links drift toward each other: jobs that use the same vendors, or the same
 * crew. The engine (flockEngine.ts) is shared with the desktop screen saver.
 *
 * The page is the picture alone (owner, 2026-11-16): no words, the frame
 * centred and sized to the window, three faint icon buttons in its corners
 * (back, controls, full screen). Every control lives in a see-through panel
 * that slides in from the side, so the flock stays in view and reacts while
 * the settings change. Full screen hides the panel button: only the frame's
 * own subtree shows there, and the panel opens outside it.
 *
 *   - Year: each bird lives for 35 days from its row's date while a clock runs
 *     through the year on a loop, so flocks grow, thin and fade with the work.
 *   - Whole year: every bird at once; speed follows the last 45 days.
 *   - A new grouping re-sorts the same birds; a new data set flies on from
 *     the old birds' places. The pointer is a hawk.
 */

const SETS: { value: CloudSetId; label: string }[] = [
  { value: "bills", label: "Bill lines" },
  { value: "labor", label: "Crew time" },
  { value: "budget", label: "Budget lines" },
];

type Time = "year" | "all";
const TIMES: { value: Time; label: string }[] = [
  { value: "year", label: "Year in motion" },
  { value: "all", label: "Whole year" },
];

type Speed = "slow" | "medium" | "fast";
const SPEEDS: { value: Speed; label: string }[] = [
  { value: "slow", label: "Slow" },
  { value: "medium", label: "Medium" },
  { value: "fast", label: "Fast" },
];
const LOOP_MS: Record<Speed, number> = { slow: 180_000, medium: 90_000, fast: 40_000 };

const SPACES: { value: FlockSpace; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "3d", label: "3D" },
  { value: "tank", label: "Tank" },
];

/** The panel's width from `pad` up (Sheet's max-w-md), and its height on a phone. */
const PANEL_W = "28rem";
const PANEL_H = "55dvh";

type Edges = "walls" | "wrap";
const EDGES: { value: Edges; label: string }[] = [
  { value: "walls", label: "Walls" },
  { value: "wrap", label: "Wrap around" },
];

const LINK_NOTE: Record<FlockBy, string> = {
  job: "Jobs that share vendors or crew fly near each other.",
  vendor: "Vendors that bill the same jobs fly near each other.",
  division: "Divisions that meet on the same jobs fly near each other.",
  type: "Cost types that meet on the same jobs fly near each other.",
  person: "People who work the same jobs fly near each other.",
};

/** The frame's corner buttons: an icon only, faint until hovered or focused. */
const ICON_BTN =
  "pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 opacity-50 transition hover:bg-neutral-100 hover:text-neutral-900 hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-white/[0.07] dark:hover:text-neutral-100";

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const BACK = "M15 6l-6 6 6 6";
const SLIDERS = "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4";
const EXPAND = "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
const SHRINK = "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5";

export function JobFlock() {
  const [set, setSet] = useState<CloudSetId>("bills");
  const [by, setBy] = useState<FlockBy>("job");
  const [time, setTime] = useState<Time>("year");
  const [speed, setSpeed] = useState<Speed>("slow");
  const [focus, setFocus] = useState<number | null>(null);
  const [words, setWords] = useState(false);
  const [edges, setEdges] = useState<Edges>("walls");
  const [space, setSpace] = useState<FlockSpace>("flat");
  const [wide, setWide] = useState(false);
  const [panel, setPanel] = useState(false);
  const [saver, setSaver] = useState(true);
  // `full` is the browser's own full screen (a computer); `immersive` fills
  // the viewport instead, for a phone, where the browser cannot full-screen a
  // page element. Either way the picture has the whole screen.
  const [full, setFull] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [canFull, setCanFull] = useState(false);
  const [scheme, setScheme] = useArtScheme();
  const { rows, error } = useArtRows(set);
  const engine = useRef(new FlockEngine()).current;
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSaver(saverEnabled());
    // A full-screen button on every device: native where it works, else immersive.
    setCanFull(true);
    const mq = window.matchMedia("(min-width: 744px)");
    const onWide = () => setWide(mq.matches);
    onWide();
    mq.addEventListener("change", onWide);
    const on = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      mq.removeEventListener("change", onWide);
    };
  }, []);

  // Hand the engine its rows during render, so the panel's list reads the
  // same groups the canvas draws. setData only replaces the engine's setup.
  const setup = useMemo(() => {
    if (!rows) return null;
    engine.setData(set, rows as unknown[], by);
    return engine.setup;
  }, [engine, rows, set, by]);

  // Budget lines have no dates, so they only fly as a whole.
  const yearOn = time === "year" && set !== "budget";
  useEffect(() => {
    engine.year = yearOn;
    engine.loopMs = LOOP_MS[speed];
    engine.focus = focus;
    engine.labels = words;
    engine.timelineText = words;
    engine.wrap = edges === "wrap";
    engine.space = space;
  }, [engine, yearOn, speed, focus, words, edges, space]);

  const unit = set === "labor" ? "hours" : "money";
  const fmt = (v: number) => (unit === "hours" ? `${Math.round(v).toLocaleString("en-US")} h` : money0(v));

  const chooseSet = (s: CloudSetId) => {
    setFocus(null);
    setSet(s);
    if (!FLOCK_BY[s].some((o) => o.value === by)) setBy("job");
  };
  const isFull = full || immersive;
  const toggleFull = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (immersive) {
      setImmersive(false);
      return;
    }
    // A mouse and a browser that can: the real full screen. A phone, or a
    // browser that refuses: fill the viewport.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (!touch && document.fullscreenEnabled && frame.current) {
      frame.current.requestFullscreen().catch(() => setImmersive(true));
    } else {
      setImmersive(true);
    }
  };

  // While immersive: the page behind does not scroll, and Escape leaves
  // (the panel closes first, on its own Escape).
  useEffect(() => {
    if (!immersive) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !panel) setImmersive(false);
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", key);
    };
  }, [immersive, panel]);

  return (
    <main
      className="flex w-full items-center justify-center px-4 py-4 transition-[padding] duration-300 pad:px-7"
      style={{
        minHeight: "calc(100dvh - 4rem - var(--tabbar-h, 0px))",
        // With the panel open, the picture moves over to the space beside it
        // (or above it, on a phone) so the whole flock stays in view.
        ...(panel && !isFull ? (wide ? { paddingRight: `calc(${PANEL_W} + 1.75rem)` } : { paddingBottom: PANEL_H }) : {}),
        ...schemeStyle(scheme),
      }}
    >
      <div
        ref={frame}
        className={`overflow-hidden bg-white dark:bg-ink-raised [&:fullscreen]:aspect-auto [&:fullscreen]:rounded-none [&:fullscreen]:border-0 ${
          immersive
            ? "fixed z-40"
            : "relative aspect-[3/2] w-full rounded-card border border-line transition-[max-width] duration-300"
        }`}
        style={
          immersive
            ? {
                // Fills the viewport; with the panel open it leaves the panel's
                // room (beside it, or above it on a phone).
                top: 0,
                left: 0,
                right: panel && wide ? PANEL_W : 0,
                bottom: panel && !wide ? PANEL_H : 0,
              }
            : {
          maxWidth: full
            ? "none"
            : panel && !wide
              ? // A phone with the panel up: fit the picture in the space above it.
                `calc((100dvh - ${PANEL_H} - 6rem) * 1.5)`
              : "calc((100dvh - 6rem - var(--tabbar-h, 0px)) * 1.5)",
        }
        }
      >
        {rows && (
          <ArtCanvas
            fill
            draw={engine.draw}
            label={setup ? `Job Flock: ${setup.birds.length} birds in ${setup.names.length} flocks` : "Job Flock"}
            onPointer={(x, y) => engine.poke(x, y)}
            onLeave={() => engine.calm()}
            onDrag={space === "3d" ? (dx, dy) => engine.drag(dx, dy) : undefined}
            onWheel={space === "3d" ? (dy) => engine.wheel(dy) : undefined}
          />
        )}
        {!rows && !error && (
          <span role="status" aria-label="Loading" className="absolute inset-0 flex items-center justify-center">
            <span className="h-2 w-2 animate-ping rounded-full bg-neutral-400" />
          </span>
        )}
        {error && (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2">
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        <div
          className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-1.5"
          style={
            immersive
              ? {
                  paddingTop: "max(0.375rem, env(safe-area-inset-top, 0px))",
                  paddingLeft: "max(0.375rem, env(safe-area-inset-left, 0px))",
                  paddingRight: "max(0.375rem, env(safe-area-inset-right, 0px))",
                }
              : undefined
          }
        >
          {isFull ? (
            <span />
          ) : (
            <Link href="/art" aria-label="Back to Art that Makes Itself" className={ICON_BTN}>
              <Icon d={BACK} />
            </Link>
          )}
          <span className="flex gap-1">
            {!full && (
              <button type="button" aria-label="Controls" className={ICON_BTN} onClick={() => setPanel(true)}>
                <Icon d={SLIDERS} />
              </button>
            )}
            {canFull && (
              <button type="button" aria-label={isFull ? "Leave full screen" : "Full screen"} className={ICON_BTN} onClick={toggleFull}>
                <Icon d={isFull ? SHRINK : EXPAND} />
              </button>
            )}
          </span>
        </div>
      </div>

      <Sheet open={panel} onClose={() => setPanel(false)} title="Job Flock" live expandable={false}>
        <div className="space-y-5 pb-2" style={schemeStyle(scheme)}>
          <p className="text-sm text-neutral-500">
            Every row is a bird. Birds flock with their own group, groups that share work drift together, and busy
            groups fly faster. The pointer scatters them.
          </p>

          <section className="space-y-2">
            <SectionLabel>Data</SectionLabel>
            <Segmented label="Data set" value={set} onChange={chooseSet} options={SETS} size="md" fill />
          </section>

          <section className="space-y-2">
            <SectionLabel>Flock by</SectionLabel>
            <ChipScroller>
              {FLOCK_BY[set].map((o) => (
                <FilterChip
                  key={o.value}
                  on={o.value === by}
                  onClick={() => {
                    setFocus(null);
                    setBy(o.value);
                  }}
                >
                  {o.label}
                </FilterChip>
              ))}
            </ChipScroller>
            <p className="text-xs text-neutral-500">{LINK_NOTE[by]}</p>
          </section>

          <section className="space-y-2">
            <SectionLabel>Time</SectionLabel>
            {set === "budget" ? (
              <p className="text-xs text-neutral-500">Budget lines have no dates, so they fly as a whole.</p>
            ) : (
              <>
                <Segmented label="Time" value={time} onChange={setTime} options={TIMES} size="md" fill />
                {yearOn && <Segmented label="Speed of the year" value={speed} onChange={setSpeed} options={SPEEDS} size="md" fill />}
                <p className="text-xs text-neutral-500">
                  {yearOn
                    ? "Each bird lives 35 days from its date while the year plays on a loop."
                    : "Every bird at once. Speed follows the last 45 days of work."}
                </p>
              </>
            )}
            <Toggle checked={words} onChange={setWords} label="Names and months on the picture" />
          </section>

          <section className="space-y-2">
            <SectionLabel>Space</SectionLabel>
            <Segmented label="Space" value={space} onChange={setSpace} options={SPACES} size="md" fill />
            <p className="text-xs text-neutral-500">
              {space === "3d"
                ? "The flock flies in a box that turns slowly. Drag to turn it, scroll to zoom."
                : space === "tank"
                  ? "A fish tank seen straight on: farther birds are smaller and fainter, and the tank sways a little."
                  : "The flock flies on the page."}
            </p>
          </section>

          <section className="space-y-2">
            <SectionLabel>Edges</SectionLabel>
            <Segmented label="Edges" value={edges} onChange={setEdges} options={EDGES} size="md" fill />
            <p className="text-xs text-neutral-500">
              {edges === "wrap"
                ? `A bird that flies off one ${space === "flat" ? "edge" : "face"} comes back on the opposite one.`
                : `Birds turn back before they reach ${space === "flat" ? "an edge" : "a wall of the box"}.`}
            </p>
          </section>

          <section>
            <SchemeChoices choice={scheme} onChange={setScheme} />
          </section>

          {setup && (
            <section className="space-y-1.5">
              <SectionLabel>Flocks — tap one to pick it out</SectionLabel>
              <ul className="space-y-0.5">
                {setup.names.map((name, g) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => setFocus((f) => (f === g ? null : g))}
                      aria-pressed={focus === g}
                      className={`flex min-h-9 w-full items-center gap-2 rounded-inner px-1.5 text-left text-sm transition ${
                        focus === g ? "bg-neutral-100 dark:bg-white/[0.07]" : ""
                      } ${focus !== null && focus !== g ? "opacity-50" : ""}`}
                    >
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: name === OTHER ? "currentColor" : `var(--viz-${(g % 8) + 1})` }}
                      />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span className="font-mono text-xs text-neutral-500">{fmt(setup.totals[g])}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-1 border-t border-line-soft pt-4">
            <Toggle
              checked={saver}
              onChange={(on) => {
                setSaver(on);
                setSaverEnabled(on);
              }}
              label="Screen saver on this computer"
            />
            <p className="text-xs text-neutral-500">
              After five minutes with no mouse or keyboard, the app shows a Job Flock with a random data set, grouping
              and colours, running the year. The pointer still scatters the birds; a click or a key closes it.
            </p>
          </section>
        </div>
      </Sheet>
    </main>
  );
}
