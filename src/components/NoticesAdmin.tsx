"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Banner,
  Button,
  Card,
  Chip,
  FilterChip,
  Input,
  Label,
  Loading,
  MetaLine,
  SectionHeading,
  SectionLabel,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui";
import { ROLES, type Role } from "@/lib/views";
import {
  NOTICE_TONES,
  ROLE_PLURAL,
  audienceLabel,
  noticeEmails,
  noticeRoles,
  noticeStatus,
  type NoticeDisplay,
  type NoticeStatus,
  type NoticeTone,
} from "@/lib/notices";

/**
 * Notices — the authoring surface (the /notices page, and Admin → Notices).
 *
 * OFFICE + ADMIN, gated by the `notices` view id. Everything here talks to
 * /api/admin/notices, which enforces the same gate server-side.
 *
 * One notice answers four questions, and this panel asks them in that order:
 * what it says, how it shows (banner or popup), when it shows, and who sees it.
 * The status of a posted notice — Live, Scheduled, Ended, Off — is computed with
 * the SAME functions the reader's feed filters on (src/lib/notices.ts), so a row
 * that reads "Live" here is on somebody's screen right now.
 */

interface Notice {
  id: number;
  title: string;
  body: string;
  tone: string;
  display: string;
  dismissible: boolean;
  startsAt: string;
  endsAt: string;
  audienceType: string;
  audienceValue: string;
  audienceRoles: string;
  audienceEmails: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  readCount: number;
}

interface Person {
  email: string;
  role: string;
}

const TONE_LABEL: Record<NoticeTone, string> = {
  info: "Info",
  warning: "Warning",
  success: "Success",
};

const STATUS_LABEL: Record<NoticeStatus, string> = {
  live: "Live",
  scheduled: "Scheduled",
  ended: "Ended",
  off: "Off",
};

/* ------------------------------------------------------- local time helpers */

/**
 * ISO → the value an `<input type="datetime-local">` wants, in the DEVICE's
 * time zone. The input has no zone of its own, so the conversion has to happen
 * on both edges: an author types "Monday 7am" and means their own morning.
 */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The datetime-local value back to an ISO stamp (the value is local time). */
function fromLocalInput(value: string): string {
  if (!value) return "";
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

/** "Sep 8, 7:00 AM" — short enough for a meta line. */
function shortStamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The window as one phrase, or "" when the notice has no schedule at all. */
function windowText(n: Notice): string {
  const from = shortStamp(n.startsAt);
  const to = shortStamp(n.endsAt);
  if (from && to) return `${from} → ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "";
}

/* -------------------------------------------------------------------- form */

interface Draft {
  title: string;
  body: string;
  tone: string;
  display: NoticeDisplay;
  dismissible: boolean;
  everyone: boolean;
  roles: Role[];
  emails: string[];
  startsAt: string; // datetime-local value
  endsAt: string; // datetime-local value
}

const EMPTY_DRAFT: Draft = {
  title: "",
  body: "",
  tone: "info",
  display: "banner",
  dismissible: true,
  everyone: true,
  roles: [],
  emails: [],
  startsAt: "",
  endsAt: "",
};

function draftFrom(n: Notice): Draft {
  const roles = noticeRoles(n).filter((r): r is Role => ROLES.includes(r as Role));
  const emails = noticeEmails(n);
  return {
    title: n.title,
    body: n.body,
    tone: n.tone,
    display: n.display === "popup" ? "popup" : "banner",
    dismissible: n.dismissible,
    everyone: roles.length === 0 && emails.length === 0,
    roles,
    emails,
    startsAt: toLocalInput(n.startsAt),
    endsAt: toLocalInput(n.endsAt),
  };
}

/** The payload shape both POST (new) and PATCH (edit) accept. */
function payloadFrom(d: Draft) {
  return {
    title: d.title.trim(),
    body: d.body.trim(),
    tone: d.tone,
    display: d.display,
    dismissible: d.display === "popup" ? true : d.dismissible,
    audienceType: d.everyone ? "all" : "targeted",
    audienceRoles: d.everyone ? [] : d.roles,
    audienceEmails: d.everyone ? [] : d.emails,
    startsAt: fromLocalInput(d.startsAt),
    endsAt: fromLocalInput(d.endsAt),
  };
}

function NoticeForm({
  people,
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  people: Person[];
  initial: Draft;
  submitLabel: string;
  busy: boolean;
  onSubmit: (payload: ReturnType<typeof payloadFrom>) => void;
  onCancel?: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setD((prev) => ({ ...prev, [key]: value }));

  const toggleRole = (role: Role) =>
    set("roles", d.roles.includes(role) ? d.roles.filter((r) => r !== role) : [...d.roles, role]);
  const togglePerson = (email: string) =>
    set(
      "emails",
      d.emails.includes(email) ? d.emails.filter((e) => e !== email) : [...d.emails, email],
    );

  const targetsNobody = !d.everyone && d.roles.length === 0 && d.emails.length === 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!d.title.trim() || targetsNobody) return;
        onSubmit(payloadFrom(d));
      }}
      className="space-y-3.5 rounded-xl border border-line p-4"
    >
      <div>
        <Label htmlFor="notice-title">Title</Label>
        <Input
          id="notice-title"
          value={d.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Time sheets due Friday"
        />
      </div>
      <div>
        <Label htmlFor="notice-body">Message</Label>
        <Textarea
          id="notice-body"
          value={d.body}
          onChange={(e) => set("body", e.target.value)}
          rows={3}
          placeholder="What you want the team to know…"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="notice-display">Show as</Label>
          <Select
            id="notice-display"
            value={d.display}
            onChange={(e) => set("display", e.target.value as NoticeDisplay)}
          >
            <option value="banner">Banner under the header</option>
            <option value="popup">Popup they must close</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="notice-tone">Tone</Label>
          <Select id="notice-tone" value={d.tone} onChange={(e) => set("tone", e.target.value)}>
            {NOTICE_TONES.map((t) => (
              <option key={t} value={t}>
                {TONE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {d.display === "banner" && (
        <Toggle
          checked={d.dismissible}
          onChange={(next) => set("dismissible", next)}
          label={d.dismissible ? "Reader can dismiss it" : "Stays until it ends or is switched off"}
        />
      )}

      <div className="space-y-2 border-t border-line-soft pt-3.5">
        <SectionLabel>When</SectionLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="notice-starts">Starts</Label>
            <Input
              id="notice-starts"
              type="datetime-local"
              value={d.startsAt}
              onChange={(e) => set("startsAt", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="notice-ends">Ends</Label>
            <Input
              id="notice-ends"
              type="datetime-local"
              value={d.endsAt}
              onChange={(e) => set("endsAt", e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          Leave blank to start now and never expire. Times are this device&rsquo;s clock.
        </p>
      </div>

      <div className="space-y-2 border-t border-line-soft pt-3.5">
        <SectionLabel>Who sees it</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <FilterChip on={d.everyone} onClick={() => set("everyone", true)}>
            Everyone
          </FilterChip>
          <FilterChip on={!d.everyone} onClick={() => set("everyone", false)}>
            Pick groups &amp; people
          </FilterChip>
        </div>

        {!d.everyone && (
          <div className="space-y-2.5 pt-1">
            <div>
              <Label>Groups</Label>
              <div className="flex flex-wrap gap-2">
                {ROLES.map((r) => (
                  <FilterChip key={r} on={d.roles.includes(r)} onClick={() => toggleRole(r)}>
                    {ROLE_PLURAL[r]}
                  </FilterChip>
                ))}
              </div>
            </div>
            <div>
              <Label>People</Label>
              {people.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  No sign-in accounts yet — add people under Admin first.
                </p>
              ) : (
                <Card pad={false} className="max-h-56 overflow-y-auto">
                  {people.map((p) => {
                    const on = d.emails.includes(p.email);
                    return (
                      <button
                        key={p.email}
                        type="button"
                        onClick={() => togglePerson(p.email)}
                        aria-pressed={on}
                        className="flex min-h-11 w-full items-center gap-2.5 border-b border-line-soft px-3 py-2 text-left last:border-b-0 transition hover:bg-accent/5 dark:hover:bg-white/5"
                      >
                        <span
                          aria-hidden
                          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${
                            on
                              ? "border-accent bg-accent text-accent-fg"
                              : "border-line-strong text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{p.email}</span>
                        <span className="shrink-0 text-[11.5px] text-neutral-500 dark:text-neutral-400">
                          {ROLE_PLURAL[p.role as Role] ?? p.role}
                        </span>
                      </button>
                    );
                  })}
                </Card>
              )}
            </div>
            {targetsNobody && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Pick at least one group or person, or choose Everyone.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-line-soft pt-3.5">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy || !d.title.trim() || targetsNobody}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------- panel */

export function NoticesAdmin() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/notices");
      if (!res.ok) {
        setErr(
          res.status === 403
            ? "Only office and admin can manage notices."
            : "Failed to load notices.",
        );
        return;
      }
      const j = await res.json();
      setNotices(j.notices ?? []);
      setPeople(j.people ?? []);
      setErr("");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  /** Every write answers with the fresh list, so one helper covers all of them. */
  async function send(init: RequestInit & { url?: string }) {
    const { url = "/api/admin/notices", ...rest } = init;
    setSaving(true);
    try {
      const res = await fetch(url, rest);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Could not save the notice.");
        return false;
      }
      setNotices(j.notices ?? []);
      setErr("");
      return true;
    } finally {
      setSaving(false);
    }
  }

  const jsonInit = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // One clock for the whole render, so two rows can't disagree about a window
  // edge they share.
  const now = Date.now();
  const live = useMemo(
    () => notices.filter((n) => noticeStatus(n, now) === "live").length,
    [notices, now],
  );

  return (
    <div>
      {err && (
        <Banner tone="error" className="mb-4">
          {err}
        </Banner>
      )}

      {composing ? (
        <div className="mb-6">
          <SectionHeading className="mb-2">New notice</SectionHeading>
          <NoticeForm
            people={people}
            initial={EMPTY_DRAFT}
            submitLabel="Post notice"
            busy={saving}
            onCancel={() => setComposing(false)}
            onSubmit={async (payload) => {
              if (await send(jsonInit("POST", payload))) setComposing(false);
            }}
          />
        </div>
      ) : (
        <div className="mb-6 flex items-center justify-between gap-3">
          <MetaLine
            items={[
              `${notices.length} notice${notices.length === 1 ? "" : "s"}`,
              live > 0 ? `${live} showing now` : "none showing now",
            ]}
          />
          <Button
            onClick={() => {
              setEditing(null);
              setComposing(true);
            }}
          >
            New notice
          </Button>
        </div>
      )}

      {loading && <Loading label="Loading notices…" />}

      <SectionHeading className="mb-2">Posted notices</SectionHeading>
      <Card pad={false} className="divide-y divide-line-soft">
        {notices.map((n) => {
          const status = noticeStatus(n, now);
          const win = windowText(n);
          const isEditing = editing === n.id;
          return (
            <div key={n.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
                    <span className="truncate">{n.title}</span>
                    {/* Only the two states worth a mark get one: showing now,
                        and waiting to. Ended/Off read quietly below. */}
                    {status === "live" && <Chip tone="success">Live</Chip>}
                    {status === "scheduled" && <Chip tone="info">Scheduled</Chip>}
                  </p>
                  {n.body && (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-neutral-500 dark:text-neutral-400">
                      {n.body}
                    </p>
                  )}
                  <MetaLine
                    className="mt-1"
                    items={[
                      status === "ended" || status === "off" ? STATUS_LABEL[status] : "",
                      audienceLabel(n),
                      n.display === "popup" ? "popup" : n.dismissible ? "banner" : "banner, standing",
                      n.tone,
                      win,
                      `seen by ${n.readCount}`,
                    ]}
                  />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Toggle
                    checked={n.active}
                    onChange={(next) => send(jsonInit("PATCH", { id: n.id, active: next }))}
                    label={n.active ? "On" : "Off"}
                  />
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <button
                      onClick={() => {
                        setComposing(false);
                        setEditing(isEditing ? null : n.id);
                      }}
                      className="text-accent hover:underline"
                    >
                      {isEditing ? "Close" : "Edit"}
                    </button>
                    <button
                      onClick={() =>
                        send({ url: `/api/admin/notices?id=${n.id}`, method: "DELETE" })
                      }
                      className="text-red-600 hover:underline dark:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
              {isEditing && (
                <div className="mt-3">
                  <NoticeForm
                    people={people}
                    initial={draftFrom(n)}
                    submitLabel="Save changes"
                    busy={saving}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (payload) => {
                      if (await send(jsonInit("PATCH", { id: n.id, ...payload }))) setEditing(null);
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
        {!loading && notices.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-neutral-500">
            No notices yet. Post one and it shows up for the people you choose.
          </p>
        )}
      </Card>

      <p className="mt-3 text-xs text-neutral-500">
        Each person sees a notice once — dismissing it keeps it gone on every device they use.
        Switch one off to stop showing it to anyone who has not seen it yet.
      </p>
    </div>
  );
}
