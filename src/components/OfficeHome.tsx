"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

import {
  Card,
  Chip,
  CountBadge,
  IconButton,
  MetaLine,
  Segmented,
  Skeleton,
  Toggle,
  btn,
} from "@/components/ui";
import { toggleKloi, useKloi } from "@/lib/kloi";
import { toast } from "@/components/Toast";
import { useAccess } from "@/components/AccessProvider";
import { AttentionList, useAttention } from "@/components/TodayQueue";
import { HomeActions, useUsed } from "@/components/HomeActions";
import { HubLeadsCard } from "@/components/HubLeadsCard";
import { PaymentMark, liveTotals, useInvoicingSummary } from "@/app/invoicing-summary/summary";
import { WeekAhead } from "@/components/WeekAhead";
import { WIDGETS, isWide, type HomeLayout, type WidgetId } from "@/lib/homeWidgets";
import type { HomeTodo } from "@/lib/homeTodos";
import { jtToDoUrl } from "@/lib/jtLinks";
import { fmtDate } from "@/lib/leadBoard";
import { money0 } from "@/lib/money";

/**
 * Home for ADMIN and OFFICE (OVERHAUL_PLAN Phase 4, 2026-11-13). Field and lead
 * keep their own Home (HomeClient.tsx).
 *
 *   Both:    one "Needs attention" count, the This week widget, one to-do list.
 *   Phone:   four big action buttons (HomeActions), under the count.
 *   Desktop: widgets — This week, To-dos, Monthly invoicing, Newest leads —
 *            that each person shows, hides, orders and sizes (saved per user
 *            in `home_layouts`, read on the server and passed in). This week
 *            is always full width (owner, 2026-11-14: it replaced Today).
 *
 * Requests on load: /api/attention, /api/home/week (+ /week/events), /api/home/todos, and on a
 * desktop /api/invoicing-summary and /api/leads when those widgets show. A
 * phone never fetches the desktop widgets: the screen width is read before any
 * widget mounts.
 */

// Loaded on first use, to keep Home's first load small: the sheet (Base UI),
// the stored digest and the to-do form (it carries the job picker).
const Sheet = dynamic(() => import("@/components/Sheet").then((m) => m.Sheet), { ssr: false });
const DigestFindings = dynamic(
  () => import("@/components/DigestFindings").then((m) => m.DigestFindings),
  { ssr: false },
);
const FindingsInbox = dynamic(
  () => import("@/components/FindingsInbox").then((m) => m.FindingsInbox),
  { ssr: false },
);
const FeatureRequestForm = dynamic(
  () => import("@/components/FeatureRequestForm").then((m) => m.FeatureRequestForm),
  { ssr: false },
);
const CreateTodo = dynamic(() => import("@/components/DigestFindings").then((m) => m.CreateTodo), {
  ssr: false,
});

/** `pad` and up is a desktop here — the same line the Sheet uses. */
function useDesktop(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 744px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function OfficeHome({ layout: initial }: { layout: HomeLayout }) {
  const { can, role } = useAccess();
  const desktop = useDesktop();
  const kloi = useKloi();
  const [layout, setLayout] = useState(initial);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsUsed = useUsed(settingsOpen);
  // Admin's Feature Request button (owner, 2026-11-14): the form in a sheet.
  const askable = role === "admin" && can("requests");
  const [askOpen, setAskOpen] = useState(false);
  const askUsed = useUsed(askOpen);

  const allowed = (id: WidgetId) => {
    const w = WIDGETS.find((x) => x.id === id);
    return can("home") && (!w || !("view" in w) || can(w.view));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-stretch gap-2">
        <NeedsAttention />
        {askable && (
          <IconButton
            label="New feature request"
            onClick={() => setAskOpen(true)}
            className="h-auto self-stretch border border-line"
          >
            <RequestMark />
          </IconButton>
        )}
        {desktop && (
          <IconButton
            label="Arrange Home"
            onClick={() => setSettingsOpen(true)}
            className="h-auto self-stretch border border-line"
          >
            <SlidersMark />
          </IconButton>
        )}
      </div>

      <HomeActions />

      {desktop === false && (
        <>
          {allowed("week") && <WeekWidget />}
          {allowed("todos") && <TodosWidget />}
        </>
      )}

      {desktop && (
        <div className="grid grid-cols-2 gap-4">
          {layout.order
            .filter((id) => !layout.hidden.includes(id) && allowed(id))
            .map((id) => (
              <div key={id} className={`min-w-0 ${isWide(layout, id) ? "col-span-2" : ""}`}>
                {id === "week" ? (
                  <WeekWidget />
                ) : id === "todos" ? (
                  <TodosWidget />
                ) : id === "invoicing" ? (
                  <InvoicingWidget />
                ) : (
                  <HubLeadsCard className="h-full max-h-[420px]" />
                )}
              </div>
            ))}
        </div>
      )}

      {desktop === false && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={toggleKloi}
            aria-pressed={kloi.playing}
            className={btn("secondary", "md", "min-h-12 w-full")}
          >
            {kloi.playing ? "❚❚ Pause KLOI" : kloi.failed ? "KLOI — try again" : "▶ KLOI radio"}
          </button>
          {can("lopezrocks") ? (
            <Link href="/lopezrocks" className={btn("secondary", "md", "min-h-12 w-full")}>
              Lopez Rocks
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}

      {askUsed && (
        <Sheet open={askOpen} onClose={() => setAskOpen(false)} title="New feature request">
          {askOpen && (
            <FeatureRequestForm
              onDone={() => {
                setAskOpen(false);
                toast("Request sent");
              }}
            />
          )}
          <Link
            href="/requests"
            className="mt-3 block min-h-11 py-2 text-[12px] font-semibold text-accent"
          >
            See all requests
          </Link>
        </Sheet>
      )}

      {settingsUsed && (
        <WidgetSettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          layout={layout}
          onChange={setLayout}
          allowed={allowed}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------- needs attention */

/** One count over every waiting queue; a tap lists them in a sheet. */
function NeedsAttention() {
  const { can } = useAccess();
  const { rows, done } = useAttention();
  const [open, setOpen] = useState(false);
  const used = useUsed(open);
  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left transition hover:border-line-strong active:scale-[0.99] dark:bg-ink-raised"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Needs attention</span>
          <span className="block truncate text-[12px] text-neutral-500">
            {!done
              ? "Checking…"
              : total === 0
                ? "Nothing waiting."
                : rows.map((r) => r.label).join(" · ")}
          </span>
        </span>
        {total > 0 && <CountBadge n={total} className="text-sm" />}
        <span aria-hidden className="text-neutral-400">
          ›
        </span>
      </button>
      {used && (
        <Sheet open={open} onClose={() => setOpen(false)} title="Needs attention">
          <div className="space-y-6">
            {can("attention") && <FindingsInbox limit={5} />}
            <AttentionList rows={rows.filter((r) => r.key !== "findings")} done={done} />
            {can("digest") && <DigestFindings />}
          </div>
        </Sheet>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- to-dos */

const KIND_LABEL: Record<HomeTodo["kind"], string> = {
  mine: "Yours",
  office: "Office",
  unclaimed: "Unclaimed",
};
const SHOWN = 8;

/** Home's one to-do list (lib/homeTodos): yours, the Office job's, nobody's.
 *  The Mac widget (/widget) draws it too. */
export function TodosWidget() {
  const { can } = useAccess();
  const [d, setD] = useState<{ linked: boolean; todos: HomeTodo[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);

  const load = useCallback((fresh = false) => {
    fetch(`/api/home/todos${fresh ? "?fresh=1" : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.ok ? setD(j) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => load(), [load]);

  const todos = d?.todos ?? [];
  const overdue = todos.filter((t) => t.overdue).length;
  const shown = all ? todos : todos.slice(0, SHOWN);

  return (
    <WidgetCard
      title="To-dos"
      trailing={overdue > 0 ? <Chip tone="danger">{overdue} overdue</Chip> : null}
    >
      {failed ? (
        <p className="text-[12px] text-neutral-500">Could not read the to-dos from JobTread.</p>
      ) : !d ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : todos.length === 0 ? (
        <p className="text-[12px] text-neutral-500">
          Nothing open.
          {!d.linked &&
            " This account is not linked to a JobTread user, so only the Office job's and unclaimed to-dos show."}
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {shown.map((t) => (
            <li key={t.id}>
              <a
                href={jtToDoUrl(t.id)}
                target="_blank"
                rel="noreferrer"
                className="block min-h-11 rounded-md px-1 py-1.5 hover:bg-line-soft"
              >
                <span className="block truncate text-[13px] font-medium">{t.name}</span>
                <MetaLine
                  items={[
                    t.due ? (
                      <span key="due" className={t.overdue ? "font-semibold text-danger" : ""}>
                        {t.overdue ? "Overdue · " : "Due "}
                        {fmtDate(t.due)}
                      </span>
                    ) : (
                      "No due date"
                    ),
                    KIND_LABEL[t.kind],
                    t.kind === "mine"
                      ? t.jobName
                      : t.kind === "office"
                        ? t.assignees.join(", ") || null
                        : t.jobName,
                  ]}
                />
              </a>
            </li>
          ))}
        </ul>
      )}
      {todos.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 min-h-11 text-[12px] font-semibold text-accent hover:underline"
        >
          {all ? "Show fewer" : `Show all ${todos.length}`}
        </button>
      )}
      {can("digest") && (
        <div className="mt-2">
          <CreateTodo onCreated={() => load(true)} />
        </div>
      )}
    </WidgetCard>
  );
}

/* ------------------------------------------------------------------- week */

/** The next seven days from now, time left to right (WeekAhead.tsx). */
function WeekWidget() {
  return (
    <WidgetCard title="This week">
      <WeekAhead />
    </WidgetCard>
  );
}

/* -------------------------------------------------------------- invoicing */

/** The billing month's invoicing: totals, then each job's payment state. */
function InvoicingWidget() {
  const { data, loading, error, load } = useInvoicingSummary();
  useEffect(() => {
    void load("");
  }, [load]);
  const live = liveTotals(data?.jobs ?? []);
  const jobs = [...live.included].sort(
    (a, b) =>
      a.customerLabel.localeCompare(b.customerLabel) || a.jobLabel.localeCompare(b.jobLabel),
  );

  return (
    <WidgetCard
      title={data ? `${data.monthLabel} invoicing` : "Monthly invoicing"}
      trailing={
        <Link
          href="/invoicing-summary"
          className="text-[11px] font-semibold text-accent hover:underline"
        >
          Invoice Status
        </Link>
      }
    >
      {error ? (
        <p className="text-[12px] text-neutral-500">{error}</p>
      ) : loading || !data ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-[26px] font-bold tabular-nums tracking-tight">
              {money0(live.total)}
            </span>
            <MetaLine
              items={[
                `${live.invoiced} of ${live.included.length} invoiced`,
                `${money0(live.paid)} paid`,
                `${money0(live.due)} due`,
              ]}
            />
          </div>
          <ul className="mt-2 grid gap-x-6 divide-y divide-line-soft">
            {jobs.map((j) => (
              <li key={j.jtJobId} className="flex items-baseline gap-3 py-1.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{j.jobLabel}</span>
                  <span className="text-neutral-500"> · {j.customerLabel}</span>
                </span>
                <span className="shrink-0 tabular-nums text-neutral-500">{money0(j.total)}</span>
                <span className="w-28 shrink-0 text-right text-[12px]">
                  <PaymentMark job={j} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

/* --------------------------------------------------------------- settings */

function WidgetSettings({
  open,
  onClose,
  layout,
  onChange,
  allowed,
}: {
  open: boolean;
  onClose: () => void;
  layout: HomeLayout;
  onChange: (l: HomeLayout) => void;
  allowed: (id: WidgetId) => boolean;
}) {
  async function save(next: HomeLayout) {
    const prev = layout;
    onChange(next);
    const r = await fetch("/api/home/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => null);
    if (!r?.ok) {
      onChange(prev);
      toast("Could not save the layout", { tone: "error" });
    }
  }
  const toggle = (list: WidgetId[], id: WidgetId, on: boolean) =>
    on ? [...list, id] : list.filter((x) => x !== id);
  const move = (id: WidgetId, by: number) => {
    const order = [...layout.order];
    const i = order.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    void save({ ...layout, order });
  };
  const rows = layout.order.filter(allowed);

  return (
    <Sheet open={open} onClose={onClose} title="Arrange Home">
      <p className="mb-3 text-[12px] text-neutral-500">
        Saved for your account. A phone always shows This week and To-dos. This week is always full
        width.
      </p>
      <ul className="divide-y divide-line-soft">
        {rows.map((id, i) => (
          <li key={id} className="flex flex-wrap items-center gap-2 py-2">
            <Toggle
              checked={!layout.hidden.includes(id)}
              onChange={(on) => void save({ ...layout, hidden: toggle(layout.hidden, id, !on) })}
              label={WIDGETS.find((w) => w.id === id)!.label}
              className="min-w-0 flex-1"
            />
            {id !== "week" && (
              <Segmented
                label="Size"
                value={layout.wide.includes(id) ? "wide" : "half"}
                onChange={(v) =>
                  void save({ ...layout, wide: toggle(layout.wide, id, v === "wide") })
                }
                options={[
                  { value: "half", label: "Half" },
                  { value: "wide", label: "Full" },
                ]}
              />
            )}
            <IconButton label="Move up" disabled={i === 0} onClick={() => move(id, -1)}>
              ↑
            </IconButton>
            <IconButton
              label="Move down"
              disabled={i === rows.length - 1}
              onClick={() => move(id, 1)}
            >
              ↓
            </IconButton>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ parts */

function WidgetCard({
  title,
  trailing,
  children,
}: {
  title: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex h-full min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {trailing}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  );
}

/** A speech bubble with a plus — ask for a feature. */
function RequestMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      <path d="M12 9v6M9 12h6" />
    </svg>
  );
}

function SlidersMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}
