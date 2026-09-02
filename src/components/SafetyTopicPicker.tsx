"use client";

import { useMemo, useState } from "react";

import {
  SAFETY_CATEGORIES,
  SAFETY_TOPICS,
  searchSafetyTopics,
  seasonOf,
  type SafetyCategory,
  type SafetyTopic,
} from "@/lib/safetyTopics";
import { Button, ChipScroller, FilterChip, MetaLine, inputCls } from "@/components/ui";

const SEASON_LABEL: Record<string, string> = {
  spring: "Spring",
  summer: "Summer",
  fall: "Fall",
  winter: "Winter",
};

/**
 * The topic browser for a safety meeting — search, season, category, tap to pick.
 *
 * Opened from the Topic field and closes on pick, because the crew is standing
 * around a truck waiting. One filter at a time: choosing a category clears the
 * season filter and the reverse, since the two together mostly return nothing.
 */
export default function SafetyTopicPicker({
  onPick,
  onClose,
}: {
  onPick: (title: string) => void;
  onClose: () => void;
}) {
  const season = seasonOf();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SafetyCategory | null>(null);
  const [seasonOnly, setSeasonOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const seasonCount = useMemo(
    () => SAFETY_TOPICS.filter((t) => t.seasons?.includes(season)).length,
    [season],
  );

  const shown = useMemo(() => {
    let list = searchSafetyTopics(query);
    if (seasonOnly) list = list.filter((t) => t.seasons?.includes(season));
    if (category) list = list.filter((t) => t.category === category);
    return list;
  }, [query, seasonOnly, category, season]);

  return (
    <div className="mt-2 rounded-xl border border-line bg-neutral-50 p-3 dark:bg-ink">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${SAFETY_TOPICS.length} topics…`}
        className={inputCls}
      />

      <ChipScroller bleed="0.75rem" className="mt-2">
        <FilterChip
          on={!seasonOnly && !category}
          onClick={() => {
            setSeasonOnly(false);
            setCategory(null);
          }}
        >
          All
        </FilterChip>
        <FilterChip
          on={seasonOnly}
          onClick={() => {
            setSeasonOnly((v) => !v);
            setCategory(null);
          }}
          title={`Topics tagged for ${SEASON_LABEL[season]}`}
        >
          {SEASON_LABEL[season]} ({seasonCount})
        </FilterChip>
        {SAFETY_CATEGORIES.map((c) => (
          <FilterChip
            key={c}
            on={category === c}
            onClick={() => {
              setCategory((v) => (v === c ? null : c));
              setSeasonOnly(false);
            }}
          >
            {c}
          </FilterChip>
        ))}
      </ChipScroller>

      <ul className="mt-2 max-h-[46vh] space-y-1 overflow-y-auto overscroll-contain">
        {shown.map((t) => (
          <TopicRow
            key={t.id}
            topic={t}
            expanded={openId === t.id}
            onToggle={() => setOpenId((v) => (v === t.id ? null : t.id))}
            onPick={() => onPick(t.title)}
          />
        ))}
        {shown.length === 0 && (
          <li className="px-1 py-6 text-center text-sm text-neutral-500">
            No topic matches that. You can type your own.
          </li>
        )}
      </ul>

      <Button variant="secondary" className="mt-2 w-full" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

function TopicRow({
  topic,
  expanded,
  onToggle,
  onPick,
}: {
  topic: SafetyTopic;
  expanded: boolean;
  onToggle: () => void;
  onPick: () => void;
}) {
  return (
    <li className="rounded-lg border border-line bg-white dark:bg-ink-raised">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onPick}
          className="min-h-11 flex-1 px-3 py-2 text-left"
        >
          <div className="text-sm font-medium">{topic.title}</div>
          <MetaLine
            items={[
              topic.category,
              topic.seasons?.map((s) => SEASON_LABEL[s]).join(", "),
              topic.rule && "WA rule",
            ]}
          />
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide talking points" : "Show talking points"}
          className="shrink-0 px-3 text-neutral-400 hover:text-accent"
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-line px-3 py-2">
          <TopicPoints topic={topic} />
          <Button size="sm" className="mt-2" onClick={onPick}>
            Use this topic
          </Button>
        </div>
      )}
    </li>
  );
}

/** The talking points, the WA rule note and the source link — shared with the page. */
export function TopicPoints({ topic }: { topic: SafetyTopic }) {
  return (
    <>
      {topic.rule && (
        <p className="mb-1.5 text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
          {topic.rule}
        </p>
      )}
      <ul className="list-disc space-y-1 pl-4 text-[13px] leading-snug text-neutral-700 dark:text-neutral-300">
        {topic.points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      {topic.source && (
        <a
          href={topic.source.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-block text-[11.5px] font-semibold text-accent hover:underline dark:text-accent-soft"
        >
          {topic.source.label} ↗
        </a>
      )}
    </>
  );
}
