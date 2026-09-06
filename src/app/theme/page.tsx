"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  ListCard,
  ListRow,
  Meter,
  PageHeader,
  SectionHeading,
  SectionLabel,
  btn,
} from "@/components/ui";
import { AscentLogo } from "@/components/AscentLogo";
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_LABEL,
  applyPalette,
  readPalette,
  type Palette,
} from "@/lib/palette";
import {
  TOKENS,
  applyDraft,
  blend,
  contrast,
  draftToCss,
  emptyDraft,
  grade,
  hexToHsl,
  hslToHex,
  readBaseTokens,
  readDraftStore,
  writeDraftStore,
  type PaletteDraft,
  type ThemeName,
} from "@/lib/paletteDraft";

/**
 * The theme editor — pickers and sliders over the live palette.
 *
 * There is no separate preview, because the app IS the preview: every value
 * here is a CSS variable on `<html>`, so a change repaints this page and every
 * other page at once. Navigate away with a draft open and it stays; the
 * pre-paint script in layout.tsx re-applies it.
 *
 * A draft is per device and NEVER committed. Shipping a change means pasting
 * the Copy CSS output into the matching token block in `src/app/globals.css`.
 * The button says so, and THEME.md carries both palettes.
 *
 * Admin-only (`theme-editor` is in ADMIN_MENU, src/lib/views.ts): it is a
 * design tool, and a field phone has no use for it.
 */
export default function ThemeEditorPage() {
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const [theme, setTheme] = useState<ThemeName>("light");
  const [draft, setDraft] = useState<PaletteDraft>(emptyDraft);
  const [base, setBase] = useState<{ light: Record<string, string>; dark: Record<string, string> }>(
    { light: {}, dark: {} },
  );
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);

  // Read what is actually painted, then the stored draft for that palette. The
  // base values come out of the stylesheet rather than being restated here, so
  // this page cannot drift from globals.css.
  const loadBase = useCallback(() => {
    setBase({ light: readBaseTokens("light"), dark: readBaseTokens("dark") });
  }, []);

  useEffect(() => {
    const p = readPalette();
    const t: ThemeName = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setPalette(p);
    setTheme(t);
    setDraft(readDraftStore()[p] ?? emptyDraft());
    setBase({ light: readBaseTokens("light"), dark: readBaseTokens("dark") });
    setReady(true);
  }, []);

  // Every change flows through here: paint it, then store it. Painting is what
  // makes the rest of the app follow along.
  useEffect(() => {
    if (!ready) return;
    applyDraft(draft, theme);
    const store = readDraftStore();
    store[palette] = draft;
    writeDraftStore(store);
  }, [draft, theme, palette, ready]);

  /** The value showing for a token — the draft's, or the palette's own. */
  const valueOf = useCallback(
    (name: string, scope: "theme" | "palette") => {
      const from = scope === "palette" ? draft.shared : draft[theme];
      return from[name] ?? (scope === "palette" ? base.light[name] : base[theme][name]) ?? "#000000";
    },
    [draft, theme, base],
  );

  const setToken = useCallback(
    (name: string, scope: "theme" | "palette", hex: string) => {
      setDraft((d) => {
        const key = scope === "palette" ? "shared" : theme;
        return { ...d, [key]: { ...d[key], [name]: hex } };
      });
    },
    [theme],
  );

  const isChanged = useCallback(
    (name: string, scope: "theme" | "palette") => {
      const from = scope === "palette" ? draft.shared : draft[theme];
      const b = scope === "palette" ? base.light[name] : base[theme][name];
      return Boolean(from[name]) && from[name] !== b;
    },
    [draft, theme, base],
  );

  const changedCount = useMemo(
    () =>
      TOKENS.filter((t) => isChanged(t.name, t.scope)).length +
      // A change on the theme you are NOT looking at still counts.
      TOKENS.filter((t) => t.scope === "theme").filter((t) => {
        const other: ThemeName = theme === "light" ? "dark" : "light";
        return Boolean(draft[other][t.name]) && draft[other][t.name] !== base[other][t.name];
      }).length,
    [isChanged, draft, theme, base],
  );

  function switchPalette(p: Palette) {
    applyPalette(p);
    setPalette(p);
    const next = readDraftStore()[p] ?? emptyDraft();
    setDraft(next);
    // The base values belong to the palette, so they have to be re-read with
    // the new one painted and the new draft NOT yet applied.
    applyDraft(undefined, theme);
    setBase({ light: readBaseTokens("light"), dark: readBaseTokens("dark") });
    applyDraft(next, theme);
  }

  function switchTheme(t: ThemeName) {
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem("theme", t);
    } catch {}
    setTheme(t);
  }

  function resetAll() {
    setDraft(emptyDraft());
    applyDraft(undefined, theme);
    loadBase();
  }

  const css = useMemo(() => draftToCss(palette, draft, base), [palette, draft, base]);

  async function copyCss() {
    try {
      await navigator.clipboard.writeText(css);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  /* The pairs worth measuring. Recomputed from whatever is showing, so a slider
     drag moves the ratio live — the thing a colour picker on its own can't do. */
  const pairs = useMemo(() => {
    const v = (n: string, s: "theme" | "palette" = "theme") => valueOf(n, s);
    const card = theme === "dark" ? v("ink-raised", "palette") : "#ffffff";
    return [
      { label: "Body text on the page", a: v("page-fg"), b: v("page") },
      { label: "Body text on a card", a: v("page-fg"), b: card },
      { label: "Link text on the page", a: v("accent-text"), b: v("page") },
      { label: "Link text on a card", a: v("accent-text"), b: card },
      { label: "Label on a filled accent", a: v("accent-fg"), b: v("accent") },
      { label: "Label on a filled hover", a: v("accent-fg"), b: v("accent-hover") },
      {
        label: "Chip label on its own tint",
        a: v("accent-soft"),
        b: blend(v("accent"), card, 0.15),
      },
      { label: "Peak knockout on the mark", a: v("accent-fg"), b: v("brand") },
    ];
  }, [valueOf, theme]);

  if (!ready) {
    return (
      <main className="mx-auto max-w-3xl px-4 pb-10 pt-5">
        <PageHeader title="Theme" description="Loading the palette…" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-10 pt-5">
      <PageHeader
        title="Theme"
        description="Pickers and sliders over the live palette. Every change repaints the whole app at once — this page is not a mock of it."
      />

      {/* What you are editing. Palette and theme are the same two per-device
          choices the home page's Appearance card sets; changing them here
          changes them everywhere. */}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <SectionLabel>Palette</SectionLabel>
            <div className="mt-1.5 flex gap-1.5">
              {PALETTES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => switchPalette(p)}
                  aria-pressed={palette === p}
                  className={`min-h-11 rounded-full border px-4 text-[12.5px] font-semibold transition ${
                    palette === p
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-line text-neutral-500 hover:border-accent dark:text-neutral-400"
                  }`}
                >
                  {PALETTE_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <SectionLabel>Theme</SectionLabel>
            <div className="mt-1.5 flex gap-1.5">
              {(["light", "dark"] as ThemeName[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchTheme(t)}
                  aria-pressed={theme === t}
                  className={`min-h-11 rounded-full border px-4 text-[12.5px] font-semibold capitalize transition ${
                    theme === t
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-line text-neutral-500 hover:border-accent dark:text-neutral-400"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-end gap-2">
            {changedCount > 0 && <Chip tone="accent">{changedCount} changed</Chip>}
            <Button variant="secondary" onClick={resetAll} disabled={changedCount === 0}>
              Reset
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          A draft lives on this device only. Nothing here is committed — Copy CSS at the foot
          gives you the block to paste into <code>src/app/globals.css</code>.
        </p>
      </Card>

      {/* --- the controls ------------------------------------------------- */}
      <SectionHeading className="mt-8">
        Tokens — {theme}
        {TOKENS.some((t) => t.scope === "palette") ? "" : ""}
      </SectionHeading>
      <div className="mt-3 space-y-2">
        {TOKENS.map((t) => (
          <TokenRow
            key={t.name}
            label={t.label}
            hint={t.hint}
            scope={t.scope}
            value={valueOf(t.name, t.scope)}
            changed={isChanged(t.name, t.scope)}
            baseValue={
              (t.scope === "palette" ? base.light[t.name] : base[theme][t.name]) ?? "#000000"
            }
            onChange={(hex) => setToken(t.name, t.scope, hex)}
          />
        ))}
      </div>

      {/* --- live contrast ------------------------------------------------ */}
      <SectionHeading className="mt-8">Contrast</SectionHeading>
      <Card className="mt-3" pad={false}>
        <div className="divide-y divide-line-soft">
          {pairs.map((p) => {
            const ratio = contrast(p.a, p.b);
            const g = grade(ratio);
            return (
              <div key={p.label} className="flex items-center gap-3 px-4 py-2.5">
                <span aria-hidden className="flex shrink-0 gap-1">
                  <span
                    className="h-4 w-4 rounded-sm border border-black/10 dark:border-white/15"
                    style={{ background: p.b }}
                  />
                  <span
                    className="h-4 w-4 rounded-sm border border-black/10 dark:border-white/15"
                    style={{ background: p.a }}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{p.label}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {ratio.toFixed(2)}:1
                </span>
                <span className="w-[104px] shrink-0 text-right">
                  {g.ok ? (
                    <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                      {g.label}
                    </span>
                  ) : (
                    <Chip tone="warning">{g.label}</Chip>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
        4.5:1 is the floor for ordinary text, 3:1 for text above ~18px and for graphics. The
        chip row measures the label against its own 15% wash, not the card under it.
      </p>

      {/* --- the sampler -------------------------------------------------- */}
      <SectionHeading className="mt-8">Sampler</SectionHeading>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        The primitives every page is built from. The chrome around this card follows the same
        tokens, so scrolling the app is the fuller test.
      </p>
      <Card className="mt-3">
        <AscentLogo />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button>Save coding</Button>
          <Button variant="outline">Preview</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">Void</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip tone="accent">Flagged</Chip>
          <Chip tone="warning">Over budget</Chip>
          <Chip tone="neutral">Approved</Chip>
        </div>
        <div className="mt-4">
          <SectionLabel>Spend against budget</SectionLabel>
          <Meter budget={100} used={62} label="62% of budget used" />
        </div>
        <p className="mt-4 text-sm">
          Ordinary body copy, with{" "}
          <a href="#" className="font-semibold text-accent">
            an interactive word
          </a>{" "}
          in it and <span className="text-neutral-500 dark:text-neutral-400">quiet text</span>{" "}
          beside it.
        </p>
      </Card>
      <ListCard className="mt-3">
        <ListRow href="#" label="Sawmill — framing" desc="06-1000 · Dunn Lumber · $4,120" />
        <ListRow href="#" label="Bunk House — electrical" desc="26-0500 · Island Electric" />
      </ListCard>

      {/* --- export ------------------------------------------------------- */}
      <SectionHeading className="mt-8">Ship it</SectionHeading>
      <Card className="mt-3">
        <p className="text-sm">
          Paste this into the matching token block in <code>src/app/globals.css</code>, then
          record the values in <code>THEME.md</code> in the same commit.
        </p>
        <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-line-soft bg-neutral-50 p-3 text-xs leading-relaxed dark:bg-white/5">
          <code>{css}</code>
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={copyCss}>{copied ? "Copied ✓" : "Copy CSS"}</Button>
          <a href="/" className={btn("secondary")}>
            Back to home
          </a>
        </div>
      </Card>
    </main>
  );
}

/**
 * One token: a swatch that opens the OS picker, the hex, and H/S/L sliders.
 *
 * The sliders are the point — a picker is good at "this exact colour" and bad
 * at "the same colour, a bit lighter", which is most of what tuning a palette
 * is. All four controls read and write the same hex, so they stay in step.
 */
function TokenRow({
  label,
  hint,
  scope,
  value,
  baseValue,
  changed,
  onChange,
}: {
  label: string;
  hint: string;
  scope: "theme" | "palette";
  value: string;
  baseValue: string;
  changed: boolean;
  onChange: (hex: string) => void;
}) {
  const hsl = hexToHsl(value);
  const set = (patch: Partial<typeof hsl>) => onChange(hslToHex({ ...hsl, ...patch }));

  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        {/* A native colour input IS the OS picker — no library, and it is the
            one the owner already knows from every other app. */}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-transparent p-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{label}</span>
            {scope === "palette" && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                both themes
              </span>
            )}
            {changed && <Chip tone="accent">changed</Chip>}
          </div>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#?[0-9a-fA-F]{6}$/.test(v)) onChange(v.startsWith("#") ? v : "#" + v);
          }}
          spellCheck={false}
          aria-label={`${label} hex`}
          className="w-[104px] shrink-0 rounded-lg border border-line-strong bg-transparent px-2.5 py-2 font-mono text-sm uppercase"
        />
        {changed && (
          <button
            type="button"
            onClick={() => onChange(baseValue)}
            title={`Back to ${baseValue}`}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-neutral-500 transition hover:text-accent"
          >
            Revert
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-line-soft px-3 pb-3 pt-2 sm:grid-cols-3">
        <Slider label="Hue" max={360} value={hsl.h} onChange={(h) => set({ h })} suffix="°" />
        <Slider label="Sat" max={100} value={hsl.s} onChange={(s) => set({ s })} suffix="%" />
        <Slider label="Light" max={100} value={hsl.l} onChange={(l) => set({ l })} suffix="%" />
      </div>
    </Card>
  );
}

function Slider({
  label,
  value,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-9 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={max === 360 ? 1 : 0.5}
        value={Math.round(value * 10) / 10}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400">
        {Math.round(value)}
        {suffix}
      </span>
    </label>
  );
}
