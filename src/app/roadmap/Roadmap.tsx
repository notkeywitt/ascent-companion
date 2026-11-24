"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Chip,
  ChipScroller,
  FilterChip,
  ListCard,
  Loading,
  MetaLine,
  Notice,
  PageHeader,
  Segmented,
} from "@/components/ui";
import { CLASSES, FEATURES, PRIORITIES, type RoadmapClass } from "@/lib/roadmap";

interface Vote {
  email: string;
  name: string;
  feature: string;
  score: number;
}

const SIZE = { S: "a day", M: "a few days", L: "a week+" } as const;
const label = (score: number) => PRIORITIES.find((p) => p.score === score)?.label ?? "";
const firstName = (v: Vote) => (v.name || v.email).split(/[\s@.]/)[0];

export function Roadmap() {
  const [votes, setVotes] = useState<Vote[] | null>(null);
  const [me, setMe] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<RoadmapClass | "all">("all");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/roadmap", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not load votes.");
      setVotes(j.votes);
      setMe(j.me);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function vote(feature: string, score: number) {
    setVotes((vs) => [
      ...(vs ?? []).filter((v) => !(v.email === me && v.feature === feature)),
      { email: me, name: "", feature, score },
    ]);
    const r = await fetch("/api/roadmap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature, score }),
    });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? "Could not save your vote.");
    void load();
  }

  const ranked = useMemo(() => {
    const byFeature = new Map<string, Vote[]>();
    for (const v of votes ?? []) byFeature.set(v.feature, [...(byFeature.get(v.feature) ?? []), v]);
    return FEATURES.map((f, i) => {
      const vs = byFeature.get(f.id) ?? [];
      return { f, i, vs, total: vs.reduce((s, v) => s + v.score, 0), mine: vs.find((v) => v.email === me) };
    }).sort(
      (a, b) =>
        Number(!!a.f.built) - Number(!!b.f.built) || b.total - a.total || b.vs.length - a.vs.length || a.i - b.i,
    );
  }, [votes, me]);

  const shown = ranked.filter((r) => filter === "all" || r.f.cls === filter);
  const unrated = ranked.filter((r) => !r.f.built && !r.mine).length;

  return (
    <>
      <PageHeader
        title="Roadmap"
        description="What the app does not do yet: what the old Drive folders and tracking sheets did, and work left from earlier plans. Set your priority on each; the list sorts by everyone's total."
      />
      {error && <Notice tone="error" className="mb-4" onDismiss={() => setError("")}>{error}</Notice>}

      <ChipScroller className="mb-4">
        <FilterChip on={filter === "all"} onClick={() => setFilter("all")}>
          All {FEATURES.length}
        </FilterChip>
        {(Object.keys(CLASSES) as RoadmapClass[]).map((c) => (
          <FilterChip key={c} on={filter === c} onClick={() => setFilter(c)}>
            {CLASSES[c].label} {FEATURES.filter((f) => f.cls === c).length}
          </FilterChip>
        ))}
      </ChipScroller>

      {votes === null && !error ? (
        <Loading />
      ) : (
        <>
          {unrated > 0 && (
            <p className="mb-2 text-[12px] text-neutral-500">
              {unrated} still to rate by you. Tap a row to read it and set your priority.
            </p>
          )}
          <ListCard>
            {shown.map(({ f, vs, total, mine }) => {
              const rank = ranked.findIndex((r) => r.f.id === f.id) + 1;
              const isOpen = open === f.id;
              return (
                <div key={f.id} className="border-b border-line-soft last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : f.id)}
                    aria-expanded={isOpen}
                    className="group flex min-h-[56px] w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
                  >
                    <span className="w-6 shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums text-neutral-400">
                      {f.built ? "✓" : rank}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold tracking-tight">{f.title}</span>
                        <Chip tone={CLASSES[f.cls].tone}>{CLASSES[f.cls].label}</Chip>
                        {f.built && <Chip tone="success">Built</Chip>}
                      </span>
                      <MetaLine
                        className="mt-1"
                        items={[
                          `${total} pts`,
                          ...vs
                            .slice()
                            .sort((a, b) => b.score - a.score)
                            .map((v) => (
                              <span key={v.email} className={v.email === me ? "font-semibold" : ""}>
                                {firstName(v)} {label(v.score)}
                              </span>
                            )),
                          !mine && !f.built && <span className="text-warn">not rated by you</span>,
                        ]}
                      />
                    </span>
                    <span
                      aria-hidden
                      className={`shrink-0 pt-0.5 text-lg leading-none text-neutral-300 transition group-hover:text-accent dark:text-neutral-600 ${isOpen ? "rotate-90" : ""}`}
                    >
                      ›
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-3 px-3 pb-4 pl-12 text-sm">
                      <p>{f.what}</p>
                      {f.was && (
                        <p className="text-[13px] text-neutral-500">
                          <span className="font-semibold">Old system: </span>
                          {f.was}
                        </p>
                      )}
                      <MetaLine items={[`Size ${f.size} — ${SIZE[f.size]}`, f.built && `Built ${f.built}`]} />
                      {!f.built && (
                        <Segmented
                          label="Your priority"
                          size="sm"
                          value={mine ? String(mine.score) : ""}
                          onChange={(v) => void vote(f.id, Number(v))}
                          options={PRIORITIES.map((p) => ({ value: String(p.score), label: p.label }))}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </ListCard>
          <p className="mt-3 text-[12px] text-neutral-500">
            Points: Must 3 · Should 2 · Later 1 · Skip 0. Ties go to the feature more people rated.
          </p>
        </>
      )}
    </>
  );
}
