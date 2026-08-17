"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, EmptyState, btn } from "@/components/ui";
import { PageTitle } from "@/components/PageTitle";
import { TOTAL, adjacentReady, getSegment } from "@/lib/course";
import { SEGMENT_BODIES, hasBody } from "../segments";
import { useCourseProgress } from "@/lib/useCourseProgress";

/**
 * A single course segment. Client component (like /bill/[docId]) so it can read
 * the param with useParams and track reading progress in the browser.
 *
 * Two progress ideas, both from useCourseProgress:
 *   - a top rail showing how far down this segment you are, and
 *   - "resume" — arriving with ?resume=1 scrolls to where you stopped; arriving
 *     normally on a part-read segment offers a one-tap jump instead.
 * Scroll is not recorded until AFTER any resume-scroll is applied, so opening a
 * segment at the top can never wipe a saved bookmark.
 */
export default function SegmentPage() {
  // useSearchParams (read below) must sit under a Suspense boundary — the same
  // wrap the /bill/[docId] page uses — so the page never blocks a build if it
  // ever becomes eligible for static generation.
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl px-4 pt-6" />}>
      <SegmentReader />
    </Suspense>
  );
}

function SegmentReader() {
  const params = useParams<{ seg: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const p = useCourseProgress();

  const n = Number(params.seg);
  const valid = Number.isInteger(n) && n >= 1 && n <= TOTAL && hasBody(n);
  const meta = getSegment(n);
  const Body = valid ? SEGMENT_BODIES[n] : null;

  const [progress, setProgress] = useState(0);
  const [trackingReady, setTrackingReady] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const jumpTarget = useRef(0);

  const docH = () =>
    Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

  // Scroll to a fraction of the page, re-correcting as late layout (the web font
  // swapping in reflows the page taller) settles — otherwise a fraction resolved
  // on the first frame lands short. Tracking stays off until the last pass, so
  // these programmatic scrolls never overwrite the saved bookmark.
  const scrollToFraction = useCallback((frac: number, then?: () => void) => {
    let cancelled = false;
    const settle = () => {
      if (cancelled) return;
      let tries = 0;
      const tick = () => {
        if (cancelled) return;
        window.scrollTo(0, frac * docH());
        if (++tries < 6) setTimeout(tick, 70);
        else then?.();
      };
      requestAnimationFrame(tick);
    };
    // Wait for fonts before the first placement; fall back if the API is absent.
    if (document.fonts?.ready) document.fonts.ready.then(settle);
    else settle();
    return () => {
      cancelled = true;
    };
  }, []);

  // Decide resume behaviour once progress has hydrated from the browser.
  useEffect(() => {
    if (!valid || !p.hydrated) return;
    const stopped = p.atOf(n);
    const reached = p.posOf(n);
    const done = p.isDone(n);
    p.touch(n);
    if (search.get("resume") === "1" && stopped > 0.02) {
      return scrollToFraction(stopped, () => setTrackingReady(true));
    }
    if (!done && reached >= 0.03 && reached < 0.97) {
      jumpTarget.current = stopped || reached;
      setShowJump(true);
    }
    setTrackingReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.hydrated, valid, n]);

  // Track scroll only after the resume decision, so an at-top load doesn't
  // overwrite the saved "where you stopped" with 0.
  useEffect(() => {
    if (!trackingReady || !valid) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const frac = window.scrollY / docH();
        setProgress(Math.min(1, Math.max(0, frac)));
        p.recordScroll(n, frac);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingReady, valid, n]);

  const done = p.hydrated && valid && p.isDone(n);
  const prev = valid ? adjacentReady(n, -1) : null;
  const nextSeg = valid ? adjacentReady(n, 1) : null;

  const complete = useCallback(() => {
    p.markDone(n);
    router.push("/course");
  }, [p, n, router]);

  const jump = useCallback(() => {
    setShowJump(false);
    // Page is settled by the time this is tapped, so a single placement lands.
    window.scrollTo(0, jumpTarget.current * docH());
  }, []);

  if (!valid) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <Link href="/course" className={btn("ghost", "sm", "-ml-2 mb-4")}>
          ‹ Course
        </Link>
        <EmptyState>
          {meta
            ? `Segment ${n} — “${meta.title}” — isn’t written yet. It’s on the way.`
            : "That segment doesn’t exist. Head back to the syllabus."}
        </EmptyState>
      </main>
    );
  }

  return (
    <>
      {/* Reading-progress rail, pinned to the very top of the viewport. */}
      <div
        aria-hidden
        className="fixed left-0 top-0 z-30 h-0.5 bg-accent"
        style={{ width: `${progress * 100}%` }}
      />

      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <Link href="/course" className={btn("ghost", "sm", "-ml-2 mb-3")}>
          ‹ Course
        </Link>

        <header className="mb-6">
          <p className="font-mono text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Segment {n} · {meta!.unit} · about {meta!.minutes} min
          </p>
          <PageTitle className="mt-1">{meta!.title}</PageTitle>
        </header>

        {showJump && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-line border-l-2 border-l-accent bg-white p-3 dark:bg-ink-raised">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              You were {Math.round(jumpTarget.current * 100)}% through last time.
            </span>
            <Button variant="outline" size="sm" onClick={jump} className="shrink-0">
              Jump there
            </Button>
          </div>
        )}

        <article className="space-y-7">{Body && <Body />}</article>

        {/* Complete + move on */}
        <div className="mt-9 space-y-3 border-t border-line pt-6">
          <Button
            variant={done ? "secondary" : "primary"}
            size="lg"
            onClick={complete}
            className="w-full"
          >
            {done ? "Completed ✓ — back to syllabus" : `Mark Segment ${n} complete`}
          </Button>
          <div className="grid grid-cols-2 gap-3">
            {prev ? (
              <Link href={`/course/${prev.n}`} className={btn("outline", "md", "w-full")}>
                ‹ Segment {prev.n}
              </Link>
            ) : (
              <span />
            )}
            {nextSeg ? (
              <Link href={`/course/${nextSeg.n}`} className={btn("outline", "md", "w-full")}>
                Segment {nextSeg.n} ›
              </Link>
            ) : (
              <span />
            )}
          </div>
        </div>
      </main>
    </>
  );
}
