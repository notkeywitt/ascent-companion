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
  Select,
  Toggle,
  btn,
  Button,
} from "@/components/ui";
import { KloiCastButton } from "@/components/KloiCast";
import { toggleKloi, useKloi } from "@/lib/kloi";
import { toast } from "@/components/Toast";
import { useAccess } from "@/components/AccessProvider";
import { AttentionList, useAttention } from "@/components/TodayQueue";
import { HomeActions, useUsed } from "@/components/HomeActions";
import { HubLeadsCard } from "@/components/HubLeadsCard";
import { PaymentMark, liveTotals, useInvoicingSummary } from "@/app/invoicing-summary/summary";
import { ItemForm, WeekAhead } from "@/components/WeekAhead";
import { Dialog } from "@/components/Dialog";
import type { MapJob } from "@/lib/lopezMap";
import { WIDGETS, isWide, type HomeLayout, type WidgetId } from "@/lib/homeWidgets";
import {
  DEFAULT_PREFS,
  applyTodoPrefs,
  normalizePrefs,
  type HomeTodo,
  type TodoPrefs,
} from "@/lib/homeTodos";
import { orgDay } from "@/lib/orgTime";
import { fmtDate } from "@/lib/leadBoard";
import { money, money0 } from "@/lib/money";
import type { UnpaidBills } from "@/lib/unpaidBills";
import {
  GMAIL_APP_URL,
  isAppleTouch,
  senderName,
  TAG_KINDS,
  tagNeedsJob,
  threadUrl,
  type TagKind,
  type InboxSource,
  type InboxThread,
  type ThreadRead,
} from "@/lib/officeInbox";

/**
 * Home for ADMIN and OFFICE (OVERHAUL_PLAN Phase 4, 2026-11-13). Field and lead
 * keep their own Home (HomeClient.tsx).
 *
 *   Both:    one "Needs attention" count, the This week widget, one to-do list.
 *   Phone:   four big action buttons (HomeActions), under the count, then
 *            This week, To-dos and Unpaid bills.
 *   Desktop: widgets — This week, To-dos, Clocked in, Monthly invoicing,
 *            Newest leads, Unpaid bills, Inbox —
 *            that each person shows, hides, orders and sizes (saved per user
 *            in `home_layouts`, read on the server and passed in). This week
 *            is always full width (owner, 2026-11-14: it replaced Today).
 *
 * Requests on load: /api/attention, /api/home/week (+ /week/events), /api/home/todos, and on a
 * desktop /api/invoicing-summary and /api/leads when those widgets show, and
 * /api/accounts-payable/unpaid when Unpaid bills shows. A
 * phone never fetches the desktop widgets: the screen width is read before any
 * widget mounts.
 */

// Loaded on first use, to keep Home's first load small: the sheet (Base UI),
// the stored digest and the to-do form (it carries the job picker).
const LopezMap = dynamic(() => import("@/components/LopezMap").then((m) => m.LopezMap));
const Sheet = dynamic(() => import("@/components/Sheet").then((m) => m.Sheet), { ssr: false });
const DigestFindings = dynamic(
  () => import("@/components/DigestFindings").then((m) => m.DigestFindings),
  { ssr: false },
);
const FindingsInbox = dynamic(
  () => import("@/components/FindingsInbox").then((m) => m.FindingsInbox),
  { ssr: false },
);
const BillView = dynamic(() => import("@/app/bill/[docId]/BillView").then((m) => m.BillView), {
  ssr: false,
});
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
  const { can } = useAccess();
  const desktop = useDesktop();
  const kloi = useKloi();
  const [layout, setLayout] = useState(initial);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsUsed = useUsed(settingsOpen);

  const allowed = (id: WidgetId) => {
    const w = WIDGETS.find((x) => x.id === id);
    return can("home") && (!w || !("view" in w) || can(w.view));
  };

  return (
    <div className="space-y-4">
      {desktop && (
        <div className="flex items-stretch gap-2">
          <NeedsAttention />
          <IconButton
            label="Arrange Home"
            onClick={() => setSettingsOpen(true)}
            className="h-auto self-stretch border border-line"
          >
            <SlidersMark />
          </IconButton>
        </div>
      )}

      <HomeActions />

      {desktop === false && (
        <>
          {allowed("week") && <WeekWidget />}
          {allowed("todos") && <TodosWidget />}
          {allowed("bills") && <UnpaidBillsWidget />}
          {allowed("inbox") && <InboxWidget />}
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
                ) : id === "crew" ? (
                  <CrewWidget />
                ) : id === "invoicing" ? (
                  <InvoicingWidget />
                ) : id === "bills" ? (
                  <UnpaidBillsWidget />
                ) : id === "inbox" ? (
                  <InboxWidget />
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
            {kloi.castDevice && kloi.playing ? `❚❚ Pause KLOI on ${kloi.castDevice}` : kloi.playing ? "❚❚ Pause KLOI" : kloi.failed ? "KLOI — try again" : "▶ KLOI radio"}
          </button>
          <KloiCastButton className={btn("secondary", "md", "col-span-2 min-h-12 w-full")} />
          {can("lopezrocks") ? (
            <Link href="/lopezrocks" className={btn("secondary", "md", "min-h-12 w-full")}>
              Lopez Rocks
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}

      {desktop === false && <NeedsAttention />}

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
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-card border border-line bg-white px-4 py-3 text-left transition hover:border-line-strong active:scale-[0.99] dark:bg-ink-raised"
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
  other: "Others'",
};
const PREFS_KEY = "home.todoPrefs";
const SHOWN = 8;

/** Home's one to-do list (lib/homeTodos): yours, the Office job's, nobody's.
 *  The Mac widget (/widget) draws it too. */
export function TodosWidget() {
  const { can } = useAccess();
  const [d, setD] = useState<{ linked: boolean; todos: HomeTodo[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [prefs, setPrefs] = useState<TodoPrefs>(DEFAULT_PREFS);
  const [panel, setPanel] = useState(false);
  const panelUsed = useUsed(panel);
  const [open, setOpen] = useState<HomeTodo | null>(null);
  // Stored per browser (localStorage), read after mount so the server HTML matches.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setPrefs(normalizePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null")));
    } catch {}
    setReady(true);
  }, []);
  const change = (next: TodoPrefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {}
  };

  const everyone = prefs.kinds.includes("other");
  const load = useCallback(
    (fresh = false) => {
      const q = [fresh && "fresh=1", everyone && "scope=all"].filter(Boolean).join("&");
      fetch(`/api/home/todos${q ? `?${q}` : ""}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => (j.ok ? setD(j) : setFailed(true)))
        .catch(() => setFailed(true));
    },
    [everyone],
  );
  useEffect(() => {
    if (ready) load();
  }, [load, ready]);

  const today = orgDay(new Date().toISOString());
  const groups = applyTodoPrefs(d?.todos ?? [], prefs, today);
  const todos = groups.flatMap((g) => g.todos);
  const overdue = todos.filter((t) => t.overdue).length;
  let budget = all ? Infinity : SHOWN;

  return (
    <WidgetCard
      title="To-dos"
      trailing={
        <span className="flex items-center gap-2">
          {overdue > 0 && <Chip tone="danger">{overdue} overdue</Chip>}
          <IconButton label="To-do settings" onClick={() => setPanel(true)}>
            <SlidersMark />
          </IconButton>
        </span>
      }
    >
      {failed ? (
        <p className="text-[12px] text-neutral-500">Could not read the to-dos from JobTread.</p>
      ) : !d ? (
        <Skeleton className="h-24 w-full rounded-control" />
      ) : todos.length === 0 ? (
        <p className="text-[12px] text-neutral-500">
          {d.todos.length ? "Nothing matches the settings." : "Nothing open."}
          {!d.linked &&
            " This account is not linked to a JobTread user, so only the Office job's and unclaimed to-dos show."}
        </p>
      ) : (
        <div>
          {groups.map((g) => {
            const rows = g.todos.slice(0, Math.max(budget, 0));
            budget -= rows.length;
            if (!rows.length) return null;
            return (
              <div key={g.label}>
                {g.label && (
                  <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {prefs.group === "kind" ? KIND_LABEL[g.label as HomeTodo["kind"]] : g.label}
                  </div>
                )}
                <ul className="divide-y divide-line-soft">
                  {rows.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setOpen(t)}
                        className="block min-h-11 w-full rounded-inner px-1 py-1.5 text-left hover:bg-line-soft"
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
                            t.kind === "mine" || t.kind === "unclaimed"
                              ? t.jobName
                              : t.assignees.join(", ") || t.jobName,
                          ]}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
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
      {open && (
        <Dialog onClose={() => setOpen(null)} label={open.name}>
          <ItemForm
            key={open.id}
            entry={{
              job: { id: open.jobId ?? "", name: open.jobName ?? "No job", days: [], total: 0 },
              item: {
                id: open.id,
                name: open.name,
                kind: "todo",
                phase: "",
                start: open.due ?? "",
                end: open.due ?? "",
                startTime: "",
                endTime: "",
                description: open.description,
              },
              day: 0,
            }}
            editable={can("home")}
            onClose={() => setOpen(null)}
            onSaved={() => {
              setOpen(null);
              load(true);
            }}
          />
        </Dialog>
      )}
      {panelUsed && (
        <Sheet open={panel} onClose={() => setPanel(false)} title="To-do settings">
          <TodoSettings prefs={prefs} onChange={change} />
        </Sheet>
      )}
    </WidgetCard>
  );
}

function TodoSettings({ prefs, onChange }: { prefs: TodoPrefs; onChange: (p: TodoPrefs) => void }) {
  const set = (patch: Partial<TodoPrefs>) => onChange({ ...prefs, ...patch });
  const kinds = (Object.keys(KIND_LABEL) as HomeTodo["kind"][]).map((k) => (
    <Toggle
      key={k}
      checked={prefs.kinds.includes(k)}
      onChange={(on) => set({ kinds: on ? [...prefs.kinds, k] : prefs.kinds.filter((x) => x !== k) })}
      label={k === "other" ? "Other people's to-dos" : KIND_LABEL[k]}
    />
  ));
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-neutral-500">Saved on this device.</p>
      <div className="space-y-1">
        <div className="text-[12px] font-semibold">Show</div>
        {kinds}
        <Toggle
          checked={prefs.hideUndated}
          onChange={(on) => set({ hideUndated: on })}
          label="Hide to-dos with no due date"
        />
      </div>
      <div className="space-y-1">
        <div className="text-[12px] font-semibold">Due within</div>
        <Segmented
          label="Due within"
          value={prefs.within}
          onChange={(within) => set({ within })}
          options={[
            { value: "any", label: "Any" },
            { value: "0", label: "Today" },
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
          ]}
        />
      </div>
      <div className="space-y-1">
        <div className="text-[12px] font-semibold">Sort</div>
        <Segmented
          label="Sort"
          value={prefs.sort}
          onChange={(sort) => set({ sort })}
          options={[
            { value: "urgency", label: "Urgency" },
            { value: "due", label: "Due" },
            { value: "job", label: "Job" },
            { value: "name", label: "Name" },
          ]}
        />
      </div>
      <div className="space-y-1">
        <div className="text-[12px] font-semibold">Group</div>
        <Segmented
          label="Group"
          value={prefs.group}
          onChange={(group) => set({ group })}
          options={[
            { value: "none", label: "None" },
            { value: "kind", label: "Whose" },
            { value: "job", label: "Job" },
          ]}
        />
      </div>
      <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_PREFS)}>
        Reset
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------- week */

/** The next seven days from now, time left to right (WeekAhead.tsx). */
function WeekWidget() {
  return (
    <WidgetCard
      title={
        <Link href="/schedule" className="hover:text-accent hover:underline">
          Schedule
        </Link>
      }
    >
      <WeekAhead />
    </WidgetCard>
  );
}

/* ------------------------------------------------------------------- crew */

interface ClockedJob {
  jobId: string;
  jobName: string;
  people: { name: string; code: string }[];
}

/** Who is clocked in, and where: the island map with a dot per job that has
 *  someone on the clock (the number is how many). Read-only. */
function CrewWidget() {
  const [clocked, setClocked] = useState<ClockedJob[] | null>(null);
  const [jobs, setJobs] = useState<MapJob[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/home/clocked", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.ok ? setClocked(j.jobs) : setFailed(true)))
      .catch(() => setFailed(true));
    fetch("/api/jobs?withPhase=1")
      .then((r) => r.json())
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => {});
  }, []);
  const mapJobs: MapJob[] = (clocked ?? []).flatMap((c) => {
    const j = jobs.find((x) => x.id === c.jobId);
    return j ? [{ ...j, count: c.people.length }] : [];
  });
  const total = (clocked ?? []).reduce((n, c) => n + c.people.length, 0);

  return (
    <WidgetCard title="Clocked in" trailing={clocked ? <Chip>{total}</Chip> : null}>
      {failed ? (
        <p className="text-[12px] text-neutral-500">Could not read the clocks from JobTread.</p>
      ) : !clocked ? (
        <Skeleton className="h-40 w-full rounded-control" />
      ) : (
        <>
          <div className="h-[220px] [&_svg]:min-h-0 [&_svg]:flex-1">
            <LopezMap jobs={mapJobs} legend={false} pad={6} className="h-full" color="var(--accent, #c2410c)" />
          </div>
          {clocked.length === 0 ? (
            <p className="text-[12px] text-neutral-500">Nobody is clocked in.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-soft">
              {clocked.map((c) => (
                <li key={c.jobId} className="py-1.5 text-[13px]">
                  <span className="font-medium">{c.jobName}</span>
                  <ul className="text-neutral-500">
                    {c.people.map((p) => (
                      <li key={`${p.name}|${p.code}`}>
                        {p.name}
                        {p.code ? ` · ${p.code}` : " · no cost code"}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
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
        <Skeleton className="h-32 w-full rounded-control" />
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

/* ---------------------------------------------------------- unpaid bills */

/**
 * Every unpaid or part-paid Bill from November 2026 on, newest first
 * (rules in `src/lib/unpaidBills.ts`). A tap opens the bill in a pop-up.
 */
function UnpaidBillsWidget() {
  const [data, setData] = useState<UnpaidBills | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    fetch("/api/accounts-payable/unpaid", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not read the bills.");
        setData(j);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not read the bills."));
  }, [reload]);

  return (
    <WidgetCard
      title="Unpaid bills"
      trailing={
        <Link
          href="/accounts-payable"
          className="text-[11px] font-semibold text-accent hover:underline"
        >
          Accounts Payable
        </Link>
      }
    >
      {error ? (
        <p className="text-[12px] text-neutral-500">{error}</p>
      ) : !data ? (
        <Skeleton className="h-32 w-full rounded-control" />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-[26px] font-bold tabular-nums tracking-tight">
              {money0(data.owed)}
            </span>
            <MetaLine
              items={[
                `${data.bills.length} ${data.bills.length === 1 ? "bill" : "bills"} owed`,
                `from ${fmtDate(data.from)}`,
              ]}
            />
          </div>
          {data.bills.length === 0 ? (
            <p className="text-[12px] text-neutral-500">Every bill is paid.</p>
          ) : (
            <ul className="mt-2 max-h-[360px] divide-y divide-line-soft overflow-y-auto">
              {data.bills.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(b.id)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-inner px-1 py-1.5 text-left text-[13px] hover:bg-line-soft"
                  >
                    <span className="w-16 shrink-0 tabular-nums text-neutral-500">
                      <span className="block">{shortDate(b.issueDate)}</span>
                      <span className="block text-[11px]">
                        Due {b.dueDate ? shortDate(b.dueDate) : "—"}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{b.vendor}</span>
                      <span className="block truncate text-[12px] text-neutral-500">
                        {[b.jobName, b.customerName].filter(Boolean).join(" · ") || "No job"}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="tabular-nums">{money(b.owed)}</span>
                      {(b.paid === "partial" || b.status === "draft") && (
                        <span className="flex gap-1">
                          {b.status === "draft" && <Chip>Draft</Chip>}
                          {b.paid === "partial" && <Chip tone="warning">Part paid</Chip>}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {openId && (
        <Dialog
          size="xl"
          pad={false}
          label="Bill"
          onClose={() => {
            setOpenId("");
            setReload((n) => n + 1);
          }}
        >
          <BillView key={openId} docId={openId} embedded inset />
        </Dialog>
      )}
    </WidgetCard>
  );
}

/**
 * The office inbox and the mail forwarded from keillor@ (label Keillor), newest
 * first (`src/lib/officeInbox.ts`). Read-only; a tap opens the thread in Gmail.
 */
function InboxWidget() {
  const [threads, setThreads] = useState<InboxThread[] | null>(null);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState<"all" | InboxSource>("all");
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState("");
  useEffect(() => {
    fetch("/api/home/inbox", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not read the mailbox.");
        setThreads(j.threads ?? []);
        setPartial(Boolean(j.partial));
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not read the mailbox."));
  }, [reload]);

  const rows = (threads ?? []).filter((t) => show === "all" || t.source === show);

  return (
    <WidgetCard
      title="Inbox"
      trailing={
        <span className="flex items-baseline gap-3">
          <button
            type="button"
            onClick={() => {
              setThreads(null);
              setReload((n) => n + 1);
            }}
            className="text-[11px] font-semibold text-accent hover:underline"
          >
            Refresh
          </button>
          <a
            href="https://mail.google.com/mail/u/?authuser=office%40ascentbuildingco.com"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-accent hover:underline"
          >
            Gmail
          </a>
        </span>
      }
    >
      <Segmented
        label="Which mail"
        value={show}
        onChange={setShow}
        options={[
          { value: "all", label: "All" },
          { value: "office", label: "Office" },
          { value: "keillor", label: "Keillor" },
        ]}
      />
      {error ? (
        <p className="mt-2 text-[12px] text-neutral-500">{error}</p>
      ) : !threads ? (
        <Skeleton className="mt-2 h-32 w-full rounded-control" />
      ) : (
        <>
          {partial && (
            <p className="mt-2 text-[12px] text-warn">One of the two mailboxes did not answer.</p>
          )}
          {rows.length === 0 ? (
            <p className="mt-2 text-[12px] text-neutral-500">No mail here.</p>
          ) : (
            <ul className="mt-2 max-h-[360px] divide-y divide-line-soft overflow-y-auto">
              {rows.map((t) => (
                <li key={t.threadId}>
                  <button
                    type="button"
                    onClick={() => setOpenId(t.threadId)}
                    className="flex min-h-11 w-full items-start gap-3 rounded-inner px-1 py-1.5 text-left text-[13px] hover:bg-line-soft"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-medium">{t.sender}</span>
                        {t.messages > 1 && (
                          <span className="shrink-0 text-[11px] text-neutral-500">{t.messages}</span>
                        )}
                      </span>
                      <span className="block truncate">{t.subject}</span>
                      <span className="block truncate text-[12px] text-neutral-500">{t.preview}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-[12px] tabular-nums text-neutral-500">
                      <span>{mailTime(t.date)}</span>
                      {t.source === "keillor" && <Chip>Keillor</Chip>}
                      {t.attachments > 0 && <span aria-label="Has attachments">📎</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {openId && <MailThread threadId={openId} onClose={() => setOpenId("")} />}
    </WidgetCard>
  );
}

/**
 * One email thread, read in the app (`/api/home/inbox/thread`), newest message
 * last. Under it: Gmail on the web (opens this thread) and, on an iPhone or
 * iPad, the Gmail app (opens the app; Gmail has no app link to one thread).
 */
function MailThread({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [data, setData] = useState<ThreadRead | null>(null);
  const [error, setError] = useState("");
  const [apple, setApple] = useState(false);
  useEffect(() => {
    setApple(isAppleTouch(navigator.userAgent, navigator.maxTouchPoints ?? 0));
    fetch(`/api/home/inbox/thread?id=${encodeURIComponent(threadId)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not read the email.");
        setData(j);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not read the email."));
  }, [threadId]);

  return (
    <Dialog
      size="lg"
      label="Email"
      title={data?.subject ?? "Email"}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {apple && (
            <a href={GMAIL_APP_URL} className={btn("secondary")}>
              Gmail app
            </a>
          )}
          <a href={threadUrl(threadId)} target="_blank" rel="noreferrer" className={btn("primary")}>
            Open in Gmail
          </a>
        </div>
      }
    >
      {error ? (
        <p className="text-[13px] text-neutral-500">{error}</p>
      ) : !data ? (
        <Skeleton className="h-40 w-full rounded-control" />
      ) : (
        <div className="divide-y divide-line-soft">
          {data.olderLeftOut > 0 && (
            <p className="pb-2 text-[12px] text-neutral-500">
              {data.olderLeftOut} older {data.olderLeftOut === 1 ? "message" : "messages"} not shown.
            </p>
          )}
          {data.messages.map((m, i) => (
            <div key={i} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate font-semibold">{senderName(m.from)}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-neutral-500">
                  {mailTime(m.date)}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                {m.text || "(no text)"}
              </p>
              {m.attachments.length > 0 && (
                <MetaLine className="mt-1.5" items={m.attachments.map((a) => `📎 ${a.name}`)} />
              )}
            </div>
          ))}
          <TagThread threadId={threadId} />
        </div>
      )}
    </Dialog>
  );
}

/**
 * Tag the thread for a job (`/api/home/inbox/tag` → appscript `tagEmailThread`).
 * The Apps Script scans act on the tag; a to-do or invoice tag writes to
 * JobTread on the next scan, so the button names what will happen.
 */
function TagThread({ threadId }: { threadId: string }) {
  const [kind, setKind] = useState<TagKind | "">("");
  const [jobs, setJobs] = useState<{ jobId: string; label: string }[] | null>(null);
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const needsJob = kind !== "" && tagNeedsJob(kind);

  useEffect(() => {
    if (!needsJob || jobs) return;
    fetch("/api/home/inbox/tag", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not read the job list.");
        setJobs(j.jobs ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not read the job list."));
  }, [needsJob, jobs]);

  const apply = async () => {
    if (!kind || (needsJob && !jobId)) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/home/inbox/tag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, kind, jobId: needsJob ? jobId : undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not tag the email.");
      setDone(j.message || "Tagged.");
      toast("Tagged");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not tag the email.");
    } finally {
      setBusy(false);
    }
  };

  const note = TAG_KINDS.find((t) => t.kind === kind)?.note;

  return (
    <div className="space-y-2 pt-3">
      <p className="text-[12px] font-semibold text-neutral-500">Tag for a job</p>
      {done ? (
        <p className="text-[13px] text-ok">{done}</p>
      ) : (
        <>
          <Select
            aria-label="Tag"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as TagKind | "");
              setError("");
            }}
          >
            <option value="">Pick a tag…</option>
            {TAG_KINDS.map((t) => (
              <option key={t.kind} value={t.kind}>
                {t.label}
              </option>
            ))}
          </Select>
          {needsJob &&
            (jobs ? (
              <Select aria-label="Job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Pick a job…</option>
                {jobs.map((j) => (
                  <option key={j.jobId} value={j.jobId}>
                    {j.label}
                  </option>
                ))}
              </Select>
            ) : (
              !error && <Skeleton className="h-11 w-full rounded-control" />
            ))}
          {note && <p className="text-[12px] text-neutral-500">{note}</p>}
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <Button disabled={!kind || (needsJob && !jobId) || busy} onClick={apply}>
            {busy ? "Tagging…" : "Apply tag"}
          </Button>
        </>
      )}
    </div>
  );
}

/** Today: "2:15 PM". Earlier: "Nov 18". */
function mailTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Nov 18" — the year is plain from the list's start date. */
const shortDate = (d: string) =>
  d
    ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "—";

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
        Saved for your account. A phone always shows This week, To-dos and Unpaid bills. This week is always full
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
