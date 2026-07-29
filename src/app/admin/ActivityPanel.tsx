"use client";

import { useCallback, useEffect, useState } from "react";

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
  lastLogin: string | null;
  lastActive: string | null;
  topViews: TopView[];
}
interface RecentActivity {
  email: string;
  kind: "login" | "view";
  path: string;
  viewId: string;
  at: string;
}
interface UsageSummary {
  days: number;
  since: string;
  totals: { activeUsers: number; logins: number; views: number };
  users: UserActivity[];
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
  return new Date(iso).toLocaleDateString();
}

/** Full local timestamp for hover/title. */
function fullTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleString();
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
          <div className="mb-4 grid grid-cols-3 gap-2">
            <Stat label="Active people" value={data.totals.activeUsers} />
            <Stat label="Sign-ins" value={data.totals.logins} />
            <Stat label="Page views" value={data.totals.views} />
          </div>

          <SectionLabel className="mb-1">People</SectionLabel>
          <ul className="space-y-2">
            {data.users.map((u) => (
              <li
                key={u.email}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700/60 dark:bg-ink-raised"
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
                      className="flex items-center justify-between gap-2 rounded-md border border-neutral-100 px-2.5 py-1.5 text-xs dark:border-white/10"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-neutral-500">{r.email.split("@")[0]}</span>{" "}
                        {r.kind === "login" ? (
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            signed in
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
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-center dark:border-neutral-700/60 dark:bg-ink-raised">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}
