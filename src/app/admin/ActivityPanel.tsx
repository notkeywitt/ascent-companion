"use client";

import { useCallback, useEffect, useState } from "react";

import { SOURCE_LABEL } from "@/components/FindingsInbox";
import { Banner, Button, Loading, SectionLabel, Select } from "@/components/ui";

interface TopView {
  viewId: string;
  label: string;
  count: number;
}
interface UserActivity {
  email: string;
  logins: number;
  views: number;
  codings: number;
  lastLogin: string | null;
  lastActive: string | null;
  topViews: TopView[];
}
interface RouteActivity {
  key: string;
  label: string;
  views: number;
  users: number;
}
interface RecodeEntry {
  line: string;
  from: string;
  to: string;
}
interface RecentActivity {
  email: string;
  kind: "login" | "view" | "coding";
  path: string;
  viewId: string;
  recodes: RecodeEntry[];
  at: string;
}
interface KindStats {
  source: string;
  kind: string;
  seen: number;
  open: number;
  selfResolved: number;
  closed?: number;
  dismissed: number;
  snoozed: number;
}
interface UsageSummary {
  findingKinds?: KindStats[];
  days: number;
  since: string;
  totals: { activeUsers: number; logins: number; views: number; codings: number };
  users: UserActivity[];
  routes: RouteActivity[];
  recent: RecentActivity[];
}

const RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
] as const;

/** Compact "time ago" (e.g. "3h ago", "2d ago"), or "—" for a missing stamp. */
function fromNow(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Full local timestamp for hover/title. */
function fullTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ActivityPanel() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showFeed, setShowFeed] = useState(false);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage?days=${d}`);
      if (!res.ok) {
        setErr(res.status === 403 ? "Only admins can view activity." : "Failed to load activity.");
        setData(null);
        return;
      }
      setData(await res.json());
      setErr("");
    } catch {
      setErr("Failed to load activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(days);
  }, [days, load]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-40 !py-1 text-xs"
        >
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => load(days)}>
          Refresh
        </Button>
      </div>

      {err && (
        <Banner tone="error" className="mb-4">
          {err}
        </Banner>
      )}

      {loading && <Loading label="Loading activity…" />}

      {!loading && data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Active people" value={data.totals.activeUsers} />
            <Stat label="Sign-ins" value={data.totals.logins} />
            <Stat label="Page views" value={data.totals.views} />
            <Stat label="Coding saves" value={data.totals.codings} />
          </div>

          <div className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-x-8">
          <div>
          <SectionLabel className="mb-1">Pages</SectionLabel>
          <ul className="mb-5 divide-y divide-line-soft rounded-lg border border-line bg-white text-sm dark:divide-white/10 dark:bg-ink-raised">
            {data.routes.map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                <span className="min-w-0 truncate">{r.label}</span>
                <span className="shrink-0 text-xs text-neutral-500">
                  <strong className="text-neutral-700 dark:text-neutral-300">{r.views}</strong> view
                  {r.views === 1 ? "" : "s"} · {r.users} {r.users === 1 ? "person" : "people"}
                </span>
              </li>
            ))}
            {data.routes.length === 0 && (
              <li className="px-3 py-3 text-center text-neutral-500">No page views in this window yet.</li>
            )}
          </ul>

          </div>
          <div>
          <SectionLabel className="mb-1">People</SectionLabel>
          <ul className="space-y-2">
            {data.users.map((u) => (
              <li
                key={u.email}
                className="rounded-lg border border-line bg-white px-3 py-2 text-sm dark:bg-ink-raised"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{u.email}</span>
                  <span
                    className="shrink-0 text-xs text-neutral-500"
                    title={fullTime(u.lastActive)}
                  >
                    active {fromNow(u.lastActive)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
                  <span>
                    <strong className="text-neutral-700 dark:text-neutral-300">{u.logins}</strong>{" "}
                    sign-in{u.logins === 1 ? "" : "s"}
                  </span>
                  <span>
                    <strong className="text-neutral-700 dark:text-neutral-300">{u.views}</strong>{" "}
                    view{u.views === 1 ? "" : "s"}
                  </span>
                  {u.codings > 0 && (
                    <span>
                      <strong className="text-neutral-700 dark:text-neutral-300">
                        {u.codings}
                      </strong>{" "}
                      coding save{u.codings === 1 ? "" : "s"}
                    </span>
                  )}
                  <span title={fullTime(u.lastLogin)}>last sign-in {fromNow(u.lastLogin)}</span>
                </div>
                {u.topViews.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {u.topViews.map((t) => (
                      <span
                        key={t.viewId}
                        className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-white/5 dark:text-neutral-400"
                      >
                        {t.label} · {t.count}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
            {data.users.length === 0 && (
              <li className="rounded-lg border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
                No activity in this window yet.
              </li>
            )}
          </ul>

          {data.recent.length > 0 && (
            <div className="mt-5">
              <button
                onClick={() => setShowFeed((s) => !s)}
                className="text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
              >
                {showFeed ? "Hide" : "Show"} recent activity ({data.recent.length})
              </button>
              {showFeed && (
                <ul className="mt-2 space-y-1">
                  {data.recent.map((r, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-line-soft px-2.5 py-1.5 text-xs dark:border-white/10"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-neutral-500">{r.email.split("@")[0]}</span>{" "}
                          {r.kind === "login" ? (
                            <span className="font-medium text-ok">
                              signed in
                            </span>
                          ) : r.kind === "coding" ? (
                            <span className="font-medium text-accent dark:text-accent-soft">
                              saved coding{r.path ? ` on ${r.path}` : ""}
                            </span>
                          ) : (
                            <span className="text-neutral-600 dark:text-neutral-300">
                              opened {r.path}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-neutral-400" title={fullTime(r.at)}>
                          {fromNow(r.at)}
                        </span>
                      </div>
                      {r.kind === "coding" && r.recodes.length > 0 && (
                        <ul className="mt-1 space-y-0.5 border-l-2 border-line pl-2.5 dark:border-white/10">
                          {r.recodes.map((rc, j) => (
                            <li key={j} className="text-[11px] text-neutral-500 dark:text-neutral-400">
                              <span className="text-neutral-700 dark:text-neutral-300">{rc.line}</span>
                              : {rc.from} <span className="text-neutral-400">→</span> {rc.to}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          </div>
          </div>

          <SectionLabel className="mb-1 mt-6">Warnings, last 90 days</SectionLabel>
          {(data.findingKinds ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">No findings yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-white dark:bg-ink-raised">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Warning</th>
                    <th className="px-2 py-1.5 text-right font-medium">Seen</th>
                    <th className="px-2 py-1.5 text-right font-medium">Open</th>
                    <th className="px-2 py-1.5 text-right font-medium">Self-resolved</th>
                    <th className="px-2 py-1.5 text-right font-medium">Month closed</th>
                    <th className="px-2 py-1.5 text-right font-medium">Dismissed</th>
                    <th className="px-2 py-1.5 text-right font-medium">Snoozed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft dark:divide-white/10">
                  {data.findingKinds!.map((k) => (
                    <tr key={`${k.source}/${k.kind}`}>
                      <td className="px-3 py-1.5">
                        {SOURCE_LABEL[k.source] ?? k.source}
                        {k.kind && <span className="text-neutral-500"> · {k.kind}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{k.seen}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{k.open}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{k.selfResolved}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{k.closed ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{k.dismissed}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{k.snoozed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 text-xs text-neutral-400">
            Findings first seen in the last 90 days. Each finding counts once: Dismissed (any dismissal), else
            Self-resolved (the source stopped reporting it), else Month closed (an invoice-review or pre-send
            finding still open when its billing month passed send day; it leaves the inbox but was never fixed),
            else Snoozed (hidden now), else Open. The five add up to Seen. Invoice review also counts months before the inbox existed; for those, Dismissed means it
            carried a ruling when last seen, and Snoozed is always 0.
          </p>

          <p className="mt-4 text-xs text-neutral-400">
            Activity older than 180 days is dropped automatically.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-center dark:bg-ink-raised">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}
