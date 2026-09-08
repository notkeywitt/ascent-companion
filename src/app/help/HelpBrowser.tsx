"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  ChipScroller,
  FilterChip,
  PageHeader,
  SectionHeading,
  btn,
} from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { VIEWS } from "@/lib/views";
import { visibleHelp } from "@/lib/help";
import type { HelpTopic } from "@/lib/help";

/**
 * The help page: every question this role can ask, grouped, each one folding
 * open to its procedure.
 *
 * THREE THINGS DECIDE WHAT YOU SEE.
 *  - Your view set. A topic names the page it is about, and a topic for a page
 *    you cannot open is dropped (see visibleHelp) — help for a page that is not
 *    on your launcher reads as a fault in the app.
 *  - The section chips, which narrow the list to one group.
 *  - The URL hash. `/help#clock-in` opens that one topic and scrolls to it,
 *    which is how the header's global search hands a reader an answer.
 *
 * Rows are hairline-divided inside ONE card, and the open/closed mark is the
 * accent "+" the course uses for its check-yourself questions — the same
 * gesture in both places.
 */

/** The page name behind a topic's `view`, for the "Open …" link. */
const VIEW_LABEL = new Map(VIEWS.map((v) => [v.id, v.label]));

/**
 * Render `**bold**` as bold. The topics keep their control names in the string
 * (see src/lib/help.ts) so the data stays plain text and searchable; this is the
 * whole of the markup they are permitted.
 */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-neutral-900 dark:text-neutral-100">
            {part}
          </b>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function TopicBody({ t }: { t: HelpTopic }) {
  const pageLabel = t.view ? VIEW_LABEL.get(t.view) : undefined;
  return (
    <div className="space-y-3 border-t border-line-soft px-3 pb-3.5 pt-3">
      {t.steps && t.steps.length > 0 && (
        <ol className="ml-4 list-decimal space-y-1.5 text-[14.5px] leading-relaxed text-neutral-700 marker:text-neutral-400 dark:text-neutral-300">
          {t.steps.map((s, i) => (
            <li key={i}>
              <Rich text={s} />
            </li>
          ))}
        </ol>
      )}

      {t.notes && t.notes.length > 0 && (
        <ul className="ml-4 list-disc space-y-1.5 text-[13.5px] leading-relaxed text-neutral-500 marker:text-neutral-300 dark:text-neutral-400 dark:marker:text-neutral-600">
          {t.notes.map((n, i) => (
            <li key={i}>
              <Rich text={n} />
            </li>
          ))}
        </ul>
      )}

      {t.warn?.map((w, i) => (
        // The one place this page raises its voice. A left accent rule rather
        // than a coloured box: the mark is a text glyph in currentColor, so it
        // is right in both palettes and both themes.
        <p
          key={i}
          className="flex gap-2 border-l-2 border-accent pl-2.5 text-[13.5px] leading-relaxed text-neutral-700 dark:text-neutral-300"
        >
          <span aria-hidden className="shrink-0 text-accent">
            ⚠
          </span>
          <span>
            <Rich text={w} />
          </span>
        </p>
      ))}

      {t.href && (
        <Link href={t.href} className={btn("outline", "sm", "mt-0.5")}>
          Open {pageLabel ?? "the page"} →
        </Link>
      )}
    </div>
  );
}

function TopicRow({
  t,
  open,
  onToggle,
}: {
  t: HelpTopic;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    // scroll-mt: the header is sticky and its height is published as a variable,
    // so a hash jump lands under the bar rather than behind it.
    <div id={t.id} className="border-b border-line-soft last:border-b-0 scroll-mt-[var(--appheader-h,3.5rem)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-[52px] w-full items-baseline gap-2.5 px-3 py-3 text-left transition hover:bg-accent/5 dark:hover:bg-white/5"
      >
        <span
          aria-hidden
          className={`shrink-0 font-mono text-accent transition ${open ? "rotate-45" : ""}`}
        >
          +
        </span>
        <span className="text-[14.5px] font-semibold tracking-tight">{t.q}</span>
      </button>
      {open && <TopicBody t={t} />}
    </div>
  );
}

export function HelpBrowser() {
  const { can } = useAccess();
  const sections = useMemo(() => visibleHelp(can), [can]);

  const [only, setOnly] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * A hash is an answer someone was handed — from the search panel, or from a
   * link in a notice. Open that topic, clear any section filter that would hide
   * it, and scroll it into view. `hashchange` covers the second such link
   * arriving while the page is already open.
   */
  useEffect(() => {
    const jump = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!id) return;
      setOnly(null);
      setOpen((prev) => new Set(prev).add(id));
      // After the row has rendered its body, so the scroll lands on the row and
      // not on where the row used to be.
      requestAnimationFrame(() =>
        document.getElementById(id)?.scrollIntoView({ block: "start" }),
      );
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, []);

  const shown = only ? sections.filter((s) => s.id === only) : sections;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Help"
        description="How to do the things this app does. Tap a question to read the steps."
      />

      <Card className="mb-5">
        <p className="text-[13.5px] leading-relaxed text-neutral-700 dark:text-neutral-300">
          Each answer is a list of steps. Do one step at a time. A word in{" "}
          <b className="font-semibold">bold</b> is the text on the button or the field.
        </p>
        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          You see only the pages your role can open, so this page is shorter for some people than
          for others. Written in Simplified Technical English (ASD-STE100).
        </p>
      </Card>

      {sections.length > 1 && (
        <ChipScroller className="mb-5">
          <FilterChip on={only === null} onClick={() => setOnly(null)}>
            All
          </FilterChip>
          {sections.map((s) => (
            <FilterChip key={s.id} on={only === s.id} onClick={() => setOnly(s.id)}>
              {s.title}
            </FilterChip>
          ))}
        </ChipScroller>
      )}

      <div className="space-y-6">
        {shown.map((s) => (
          <section key={s.id} className="space-y-2.5">
            <SectionHeading>{s.title}</SectionHeading>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{s.blurb}</p>
            <Card pad={false} className="overflow-hidden">
              {s.topics.map((t) => (
                <TopicRow key={t.id} t={t} open={open.has(t.id)} onToggle={() => toggle(t.id)} />
              ))}
            </Card>
          </section>
        ))}
      </div>

      <p className="mt-6 text-xs text-neutral-400">
        A question this page does not answer is a gap in it. Ask for the answer on the Requests
        page, and it lands here.
      </p>
    </main>
  );
}
