"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, Segmented } from "@/components/ui";
import { money0 } from "@/lib/money";
import { fontSize, layoutWords, rankDivisions, wordStats, type WordBy, type WordStat } from "@/lib/art/words";
import { ArtCanvas, ArtPage, CanvasNote, Tip, ease, useArtRows, type DrawFrame } from "../artKit";

/**
 * LINE WORDS. The words of the line names, sized by dollars or count. A new
 * layout sends each word from its old place (or the centre) to its new one,
 * staggered by rank; words that leave shrink and fade. At rest each word bobs
 * a pixel. Under prefers-reduced-motion words land at once and stay still.
 */

type Src = "bills" | "budget";
const SOURCES: { value: Src; label: string }[] = [
  { value: "bills", label: "Bill lines" },
  { value: "budget", label: "Budget lines" },
];
const SIZES: { value: WordBy; label: string }[] = [
  { value: "dollars", label: "Dollars" },
  { value: "count", label: "Count" },
];

const DUR_MS = 1000;
const SPREAD_MS = 400;
const family = "ui-sans-serif, system-ui, sans-serif";
const fontOf = (size: number) => `600 ${size.toFixed(1)}px ${family}`;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

interface Item {
  word: string;
  x0: number;
  y0: number;
  s0: number;
  a0: number;
  x1: number;
  y1: number;
  s1: number;
  a1: number;
  w1: number;
  h1: number;
  delay: number;
  ci: number;
  phase: number;
  gone: boolean;
}

export function LineWords() {
  const [src, setSrc] = useState<Src>("bills");
  const [by, setBy] = useState<WordBy>("dollars");
  const { rows, error } = useArtRows(src);
  const [hover, setHover] = useState<{ x: number; y: number; word: string } | null>(null);

  const model = useMemo(() => {
    if (!rows) return null;
    const stats = wordStats(rows, by, 120);
    const divs = rankDivisions(rows, 7);
    return { stats, divs, byWord: new Map(stats.map((s) => [s.word, s])) };
  }, [rows, by]);

  const items = useRef<Item[]>([]);
  const start = useRef(0);
  const dirty = useRef(false);
  const modelRef = useRef(model);
  const sizeSig = useRef("");

  useEffect(() => {
    modelRef.current = model;
    if (model) dirty.current = true;
  }, [model]);

  const at = (it: Item, now: number, reduced: boolean) => {
    const t = reduced ? 1 : clamp01((now - start.current - it.delay) / DUR_MS);
    const e = ease(t);
    return {
      x: it.x0 + (it.x1 - it.x0) * e,
      y: it.y0 + (it.y1 - it.y0) * e,
      s: it.s0 + (it.s1 - it.s0) * e,
      a: it.a0 + (it.a1 - it.a0) * e,
      t,
    };
  };

  const relayout = (f: DrawFrame, m: NonNullable<typeof model>) => {
    const { ctx, w, h, now, reduced } = f;
    const scale = Math.max(0.5, Math.min(1, w / 900));
    const maxW = m.stats[0]?.weight ?? 1;
    const words = m.stats.map((s) => ({ word: s.word, size: fontSize(s.weight, maxW, scale) }));
    const placed = layoutWords(words, w, h, (word, size) => {
      ctx.font = fontOf(size);
      return { w: ctx.measureText(word).width, h: size * 1.05 };
    });
    const prev = new Map<string, ReturnType<typeof at>>();
    for (const it of items.current) prev.set(it.word, at(it, now, reduced));
    const next: Item[] = [];
    const seen = new Set<string>();
    const N = placed.length || 1;
    placed.forEach((p, rank) => {
      seen.add(p.word);
      const o = prev.get(p.word) ?? { x: w / 2, y: h / 2, s: 0, a: 0 };
      const ci = m.divs.indexOf(m.byWord.get(p.word)?.division ?? "");
      next.push({
        word: p.word,
        x0: o.x,
        y0: o.y,
        s0: o.s,
        a0: o.a,
        x1: p.x,
        y1: p.y,
        s1: p.size,
        a1: 1,
        w1: p.w,
        h1: p.h,
        delay: (rank / N) * SPREAD_MS,
        ci,
        phase: (rank * 2.399) % (Math.PI * 2),
        gone: false,
      });
    });
    let k = 0;
    for (const it of items.current) {
      if (seen.has(it.word)) continue;
      const o = prev.get(it.word)!;
      if (o.a <= 0.01) continue;
      next.push({
        ...it,
        x0: o.x,
        y0: o.y,
        s0: o.s,
        a0: o.a,
        x1: o.x,
        y1: o.y,
        s1: 0,
        a1: 0,
        delay: (k++ % 12) * 20,
        gone: true,
      });
    }
    items.current = next;
    start.current = now;
  };

  const draw = (f: DrawFrame) => {
    const { ctx, w, h, now, colors, quiet, reduced } = f;
    const m = modelRef.current;
    const sig = `${Math.round(w)}x${Math.round(h)}`;
    if (m && (dirty.current || sig !== sizeSig.current)) {
      dirty.current = false;
      sizeSig.current = sig;
      relayout(f, m);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    items.current = items.current.filter((it) => !it.gone || at(it, now, reduced).t < 1);
    for (const it of items.current) {
      const p = at(it, now, reduced);
      if (p.a <= 0.01 || p.s < 1) continue;
      const bob = reduced || it.gone ? 0 : Math.sin(now / 1300 + it.phase);
      ctx.globalAlpha = p.a;
      ctx.font = fontOf(p.s);
      ctx.fillStyle = it.ci < 0 ? quiet : colors[it.ci % colors.length];
      ctx.fillText(it.word, p.x, p.y + bob);
    }
    ctx.globalAlpha = 1;
  };

  const onPointer = (x: number, y: number) => {
    let hit: Item | null = null;
    for (const it of items.current) {
      if (it.gone) continue;
      if (Math.abs(x - it.x1) <= it.w1 / 2 && Math.abs(y - it.y1) <= it.h1 / 2) hit = it;
    }
    setHover(hit ? { x, y, word: hit.word } : null);
  };

  const stat: WordStat | undefined = hover ? model?.byWord.get(hover.word) : undefined;

  return (
    <ArtPage
      title="Line Words"
      description="The words in line names. A bigger word covers more dollars, or more lines."
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          label="Data"
          value={src}
          onChange={(s) => {
            setHover(null);
            setSrc(s);
          }}
          options={SOURCES}
          size="md"
        />
        <Segmented
          label="Size by"
          value={by}
          onChange={(b) => {
            setHover(null);
            setBy(b);
          }}
          options={SIZES}
          size="md"
        />
      </div>
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}
      <ArtCanvas
        draw={draw}
        aspect={0.62}
        label="A word cloud of the words in line names"
        onPointer={onPointer}
        onLeave={() => setHover(null)}
      >
        {!model && !error && <CanvasNote>Reading lines from JobTread…</CanvasNote>}
        {stat && hover && (
          <Tip x={hover.x} y={hover.y} w={600}>
            <div className="font-semibold">{stat.word}</div>
            <div className="font-mono">{money0(stat.dollars)}</div>
            <div className="text-neutral-500">{stat.count.toLocaleString("en-US")} lines</div>
            <div className="text-neutral-500">Mostly Div {stat.division}</div>
          </Tip>
        )}
      </ArtCanvas>
      <p className="mt-3 text-xs text-neutral-500">Colour is the division the word is mostly in. Grey is a smaller division.</p>
    </ArtPage>
  );
}
