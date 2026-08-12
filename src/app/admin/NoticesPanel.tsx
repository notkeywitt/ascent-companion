"use client";

import { useEffect, useState } from "react";

import {
  Banner,
  Button,
  Input,
  Label,
  Loading,
  SectionLabel,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui";
import { ROLES, type Role } from "@/lib/views";

/**
 * Admin → Notices — author the announcements that pop up for users. A notice is
 * aimed at everyone, a role, or one person, carries a tone, and is toggled
 * active/off. Everything here talks to /api/admin/notices (admin-gated).
 */

interface Notice {
  id: number;
  title: string;
  body: string;
  tone: string;
  audienceType: string;
  audienceValue: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  readCount: number;
}

type AudienceType = "all" | "role" | "user";
const TONES: { value: string; label: string }[] = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "success", label: "Success" },
];
const ROLE_LABEL: Record<Role, string> = {
  admin: "Admins",
  office: "Office",
  lead: "Leads",
  field: "Field",
};

function audienceText(n: Notice): string {
  if (n.audienceType === "all") return "Everyone";
  if (n.audienceType === "role") return `${ROLE_LABEL[n.audienceValue as Role] ?? n.audienceValue} role`;
  return n.audienceValue;
}

export function NoticesPanel() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // New-notice form.
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState("info");
  const [audienceType, setAudienceType] = useState<AudienceType>("all");
  const [role, setRole] = useState<Role>("field");
  const [userEmail, setUserEmail] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/notices");
      if (!res.ok) {
        setErr(res.status === 403 ? "Only admins can manage notices." : "Failed to load notices.");
        return;
      }
      setNotices((await res.json()).notices ?? []);
      setErr("");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const audienceValue = audienceType === "role" ? role : audienceType === "user" ? userEmail.trim() : "";
    setSaving(true);
    try {
      const res = await fetch("/api/admin/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, tone, audienceType, audienceValue }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Could not save the notice.");
        return;
      }
      setNotices(j.notices ?? []);
      setTitle("");
      setBody("");
      setTone("info");
      setAudienceType("all");
      setRole("field");
      setUserEmail("");
      setErr("");
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: number, fields: Partial<Pick<Notice, "active">>) {
    const res = await fetch("/api/admin/notices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    });
    if (res.ok) setNotices((await res.json()).notices ?? []);
  }

  async function remove(id: number) {
    const res = await fetch(`/api/admin/notices?id=${id}`, { method: "DELETE" });
    if (res.ok) setNotices((await res.json()).notices ?? []);
  }

  return (
    <div>
      {err && (
        <Banner tone="error" className="mb-4">
          {err}
        </Banner>
      )}

      <form onSubmit={create} className="mb-6 space-y-3 rounded-xl border border-line p-4">
        <SectionLabel>New notice</SectionLabel>
        <div>
          <Label htmlFor="notice-title">Title</Label>
          <Input
            id="notice-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Time sheets due Friday"
          />
        </div>
        <div>
          <Label htmlFor="notice-body">Message</Label>
          <Textarea
            id="notice-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What you want the team to know…"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="notice-tone">Tone</Label>
            <Select id="notice-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="notice-audience">Show to</Label>
            <Select
              id="notice-audience"
              value={audienceType}
              onChange={(e) => setAudienceType(e.target.value as AudienceType)}
            >
              <option value="all">Everyone</option>
              <option value="role">A role</option>
              <option value="user">One person</option>
            </Select>
          </div>
        </div>
        {audienceType === "role" && (
          <div>
            <Label htmlFor="notice-role">Role</Label>
            <Select id="notice-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </div>
        )}
        {audienceType === "user" && (
          <div>
            <Label htmlFor="notice-email">Person&rsquo;s email</Label>
            <Input
              id="notice-email"
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="teammate@gmail.com"
            />
          </div>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !title.trim()}>
            {saving ? "Posting…" : "Post notice"}
          </Button>
        </div>
        <p className="text-xs text-neutral-500">
          Notices pop up the next time someone opens the app. Each person sees it once —
          dismissing it keeps it gone. Turn a notice off below to stop showing it to anyone who
          hasn&rsquo;t seen it yet.
        </p>
      </form>

      {loading && <Loading label="Loading notices…" />}

      <SectionLabel className="mb-2">Posted notices</SectionLabel>
      <ul className="space-y-2">
        {notices.map((n) => (
          <li
            key={n.id}
            className="rounded-lg border border-line bg-white px-3 py-2.5 text-sm dark:bg-ink-raised"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{n.title}</p>
                {n.body && <p className="mt-0.5 whitespace-pre-wrap text-xs text-neutral-500">{n.body}</p>}
                <p className="mt-1 text-xs text-neutral-400">
                  {audienceText(n)} · {n.tone} · seen by {n.readCount}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Toggle
                  checked={n.active}
                  onChange={(next) => patch(n.id, { active: next })}
                  label={n.active ? "On" : "Off"}
                />
                <button
                  onClick={() => remove(n.id)}
                  className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
        {!loading && notices.length === 0 && (
          <li className="rounded-lg border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
            No notices yet. Post one above and it&rsquo;ll pop up for the people you choose.
          </li>
        )}
      </ul>
    </div>
  );
}
