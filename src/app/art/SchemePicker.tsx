"use client";

import { useEffect, useState } from "react";
import { Popover } from "@/components/Menu";
import { SectionLabel } from "@/components/ui";
import { ART_PRESETS, colorsFor, parseChoice, swatchOf, type SchemeChoice } from "@/lib/art/scheme";

/**
 * The colour scheme picker on every /art piece: eight presets, or "pick two"
 * and the app fills in the other six (src/lib/art/scheme.ts). Saved on this
 * device only, and shared by every piece. It changes the pieces' colours and
 * nothing else in the app.
 */

const KEY = "art-scheme";

/** The viewer's saved choice, and a setter that saves it. */
export function useArtScheme(): [SchemeChoice | null, (c: SchemeChoice) => void] {
  const [choice, setChoice] = useState<SchemeChoice | null>(null);
  useEffect(() => {
    try {
      setChoice(parseChoice(localStorage.getItem(KEY)));
    } catch {
      /* private window: the choice lasts for this page only */
    }
  }, []);
  const save = (c: SchemeChoice) => {
    setChoice(c);
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* not saved; still applied */
    }
  };
  return [choice, save];
}

/** `--viz-1..8` for an element's style, or nothing for the theme's own. */
export function schemeStyle(choice: SchemeChoice | null): React.CSSProperties | undefined {
  const colors = colorsFor(choice);
  if (!colors) return undefined;
  return Object.fromEntries(colors.map((c, i) => [`--viz-${i + 1}`, c])) as React.CSSProperties;
}

function Stripes({ colors, className = "" }: { colors: string[]; className?: string }) {
  return (
    <span aria-hidden className={`flex overflow-hidden rounded ${className}`}>
      {colors.map((c, i) => (
        <span key={i} className="h-full flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

/** The scheme choices themselves: pick two, then the presets. Used inside
 *  the Colours popover and, on the Job Flock, inside its control panel. */
export function SchemeChoices({
  choice,
  onChange,
}: {
  choice: SchemeChoice | null;
  onChange: (c: SchemeChoice) => void;
}) {
  const current = colorsFor(choice) ?? swatchOf(ART_PRESETS[0]);
  const presetId = choice && "preset" in choice ? choice.preset : choice ? null : "house";
  const [a, b] = choice && "two" in choice ? choice.two : [current[0], current[1]];
  return (
    <>
      <SectionLabel className="mb-1.5">Pick two</SectionLabel>
      <div className="mb-1 flex items-center gap-2">
        {[a, b].map((c, i) => (
          <label key={i} className="flex items-center gap-1.5 text-xs text-neutral-500">
            <input
              id={`art-scheme-pick-${i + 1}`}
              type="color"
              value={c}
              onChange={(e) => onChange({ two: i === 0 ? [e.target.value, b] : [a, e.target.value] })}
              className="h-9 w-11 cursor-pointer rounded-md border border-line-strong bg-transparent p-0.5"
            />
            {i === 0 ? "First" : "Second"}
          </label>
        ))}
      </div>
      <p className="mb-3 text-xs text-neutral-500">The app adds six that go with your two: their complements, the hue between them, and close neighbours.</p>

      <SectionLabel className="mb-1.5">Or a preset</SectionLabel>
      <ul className="grid grid-cols-2 gap-1.5">
        {ART_PRESETS.map((p) => {
          const on = presetId === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ preset: p.id })}
                className={`flex min-h-11 w-full flex-col justify-center gap-1 rounded-lg border px-2 py-1.5 text-left text-xs transition ${
                  on ? "border-accent font-semibold" : "border-line hover:border-line-strong"
                }`}
              >
                <Stripes colors={swatchOf(p)} className="h-2.5 w-full" />
                {p.name}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function SchemePicker({
  choice,
  onChange,
}: {
  choice: SchemeChoice | null;
  onChange: (c: SchemeChoice) => void;
}) {
  const current = colorsFor(choice) ?? swatchOf(ART_PRESETS[0]);
  return (
    <Popover
      label="Colour scheme"
      align="end"
      className="w-[19rem]"
      trigger={
        <button
          type="button"
          className="ui-btn inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          <Stripes colors={current} className="h-3.5 w-12" />
          Colours
        </button>
      }
    >
      <SchemeChoices choice={choice} onChange={onChange} />
    </Popover>
  );
}
