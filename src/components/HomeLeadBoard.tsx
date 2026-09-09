"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  Chip,
  ChipScroller,
  FilterChip,
  MetaLine,
  SectionHeading,
  Skeleton,
} from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import {
  LEAD_ORDERS,
  LEAD_QUIET_DEFAULTS,
  contactLine,
  fmtDate,
  normalizeThresholds,
  quietBand,
  sortLeadCards,
  toLeadCard,
  type LeadCard,
  type LeadLike,
  type LeadOrder,
  type LeadQuietThresholds,
  type QuietBand,
} from "@/lib/leadBoard";

/**
 * The Leads panel on the home page — the pipeline as a row of kanban cards,
 * the same shape as the Active jobs board above it, so the first screen of the
 * day answers "which lead have we not spoken to" without opening a page.
 *
 * ORDERED BY LAST CONTACT, and that is the only order it offers: longest ago
 * first (the default — a lead going quiet is the thing this panel exists to
 * show), or most recent first. Everything else about the pipeline — stage
 * filters, the overdue signal, the contact log, the write controls — stays on
 * /leads, which this panel links into. Nothing here writes.
 *
 * COLLAPSIBLE, remembered per device: an admin who works the leads board reads
 * this every morning, and an admin who doesn't wants their digest back.
 *
 * Self-gating on the `leads` view, so office and admin get it and a field or
 * lead phone never fetches customer contact data it may not see.
 */

/** Where the panel remembers whether it is folded away. */
const OPEN_KEY = "home.leadsOpen";
/** Where it remembers which end of the contact timeline comes first. */
const ORDER_KEY = "home.leadsOrder";

/**
 * The figure's colour, from the org's own thresholds (Leads → Colour
 * thresholds). The same `quietBand` the /leads chips read, so the two surfaces
 * cannot disagree about when a lead has gone quiet.
 */
const QUIET_COLOR: Record<QuietBand, string> = {
  unknown: "text-neutral-500",
  ok: "text-neutral-800 dark:text-neutral-100",
  warn: "text-amber-600 dark:text-amber-400",
  alert: "text-red-600 dark:text-red-400",
};

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  site_visit: "Site visit",
  estimating: "Estimating",
  proposal_sent: "Proposal sent",
};
const stageLabel = (id: string) => STAGE_LABELS[id] ?? id;

/**
 * One lead, as a board card. The whole card is a link into /leads with this
 * lead opened — every control that could change the lead lives there, so the
 * card needs no second gesture of its own (unlike the job card's drilldown).
 */
function LeadBoardCard({ c, thresholds }: { c: LeadCard; thresholds: LeadQuietThresholds }) {
  const quiet = c.quietDays;
  const band = quietBand(quiet, thresholds);
  return (
    <Link
      href={`/leads#${encodeURIComponent(c.id)}`}
      // `w-72` is the SCROLLER's card; from `pad` up the row is a grid and the
      // cell sets the width. See the row itself, below.
      className="w-72 shrink-0 rounded-xl transition hover:opacity-80 pad:w-auto"
    >
      <Card className="flex h-full flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">{c.name}</div>
            {/* Two lines of address: a rural San Juan County address wraps, and
                truncating it to one line loses the road. */}
            <div className="line-clamp-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              {c.address || "No address logged"}
            </div>
          </div>
          {c.local && (
            <Chip tone="accent" title="Logged here — no customer in JobTread yet">
              Not in JT
            </Chip>
          )}
        </div>

        {/* The card's ONE figure: how long this lead has been quiet. It is what
            the row is ordered by, so it is what the eye should land on. */}
        <div className="flex items-baseline gap-2 border-t border-line-soft pt-2">
          <span className={`text-2xl font-bold tabular-nums ${QUIET_COLOR[band]}`}>
            {quiet === null ? "—" : quiet}
          </span>
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {quiet === null ? "no dates" : `day${quiet === 1 ? "" : "s"} since contact`}
          </span>
        </div>
        <MetaLine items={[contactLine(c), stageLabel(c.stage)]} />

        <div className="border-t border-line-soft pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Project scope
          </div>
          <p className="line-clamp-3 text-[12px] text-neutral-700 dark:text-neutral-300">
            {c.projectScope || <span className="italic text-neutral-500">Not written yet</span>}
          </p>
        </div>

        <div className="mt-auto border-t border-line-soft pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Next steps
          </div>
          {c.nextAction ? (
            <>
              <p className="line-clamp-2 text-[12px] font-semibold">{c.nextAction}</p>
              {c.nextActionDate && (
                <MetaLine items={[`by ${fmtDate(c.nextActionDate)}`]} />
              )}
            </>
          ) : (
            <p className="text-[12px] italic text-neutral-500">No next step set</p>
          )}
        </div>
      </Card>
    </Link>
  );
}

export function HomeLeadBoard() {
  const access = useAccess();
  const allowed = access.can("leads");

  const [leads, setLeads] = useState<LeadLike[] | null>(null);
  const [open, setOpen] = useState(true);
  const [order, setOrder] = useState<LeadOrder>("quiet");
  /* The org's amber/red thresholds, which arrive with the leads in one fetch
     (see /api/leads). The defaults stand in only for the moment before that
     answers, so the first paint can never be a wrong colour for long. */
  const [thresholds, setThresholds] = useState<LeadQuietThresholds>(LEAD_QUIET_DEFAULTS);

  /* Read the two remembered choices in an effect, not in the initial state:
     this page is server-rendered too, and a first render that read `window`
     would disagree with the server's HTML. */
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem(OPEN_KEY);
      if (savedOpen !== null) setOpen(savedOpen === "1");
      const savedOrder = localStorage.getItem(ORDER_KEY);
      if (savedOrder === "quiet" || savedOrder === "recent") setOrder(savedOrder);
    } catch {
      /* private mode — the panel still folds for this visit */
    }
  }, []);

  const remember = useCallback((key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* nothing to do — the choice still holds for this visit */
    }
  }, []);

  const toggleOpen = () =>
    setOpen((v) => {
      remember(OPEN_KEY, v ? "0" : "1");
      return !v;
    });

  const pickOrder = (id: LeadOrder) => {
    setOrder(id);
    remember(ORDER_KEY, id);
  };

  useEffect(() => {
    if (!allowed) return; // nothing for this role — don't even ask
    let cancelled = false;
    fetch("/api/leads")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setLeads(j.error ? [] : (j.leads ?? []));
        if (j.quiet) setThresholds(normalizeThresholds(j.quiet));
      })
      .catch(() => {
        if (!cancelled) setLeads([]); // a panel that can't load just isn't there
      });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const cards = useMemo(
    () => (leads ? sortLeadCards(leads.map(toLeadCard), order) : []),
    [leads, order],
  );

  if (!allowed) return null;
  if (leads === null) {
    return (
      <div className="mb-6">
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (cards.length === 0) return null;

  // The heading's own count uses the RED threshold, so the chip and the red
  // figures on the cards are always counting the same leads.
  const overAlert = cards.filter((c) => quietBand(c.quietDays, thresholds) === "alert").length;

  return (
    <section className="mb-6 space-y-2">
      <SectionHeading
        onToggle={toggleOpen}
        open={open}
        trailing={
          <span className="flex items-center gap-2">
            {overAlert > 0 && (
              <Chip
                tone="danger"
                title={`No contact logged in ${thresholds.alertDays}+ days`}
              >
                {overAlert} quiet
              </Chip>
            )}
            <span className="text-[11px] tabular-nums text-neutral-500">{cards.length}</span>
          </span>
        }
      >
        Leads
      </SectionHeading>

      {open && (
        <>
          {/* Which end of the contact timeline leads the row. */}
          <ChipScroller>
            {LEAD_ORDERS.map((o) => (
              <FilterChip
                key={o.id}
                on={order === o.id}
                onClick={() => pickOrder(o.id)}
                title={
                  o.id === "quiet"
                    ? "Furthest from the last contact first"
                    : "Most recently contacted first"
                }
              >
                {o.label}
              </FilterChip>
            ))}
          </ChipScroller>

          {/* Phone: a sideways row that bleeds to the screen edges, so the next
              card is visibly cut off — the same trick the job board and
              ChipScroller use. From `pad` up: a grid, for the same reason the
              job board above becomes one. The two boards stay the same shape as
              each other at every width, which is the point of them. */}
          <div className="-mx-4 flex items-stretch gap-3 overflow-x-auto px-4 pb-1 pad:mx-0 pad:grid pad:grid-cols-2 pad:overflow-x-visible pad:px-0 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((c) => (
              <LeadBoardCard key={c.id} c={c} thresholds={thresholds} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
