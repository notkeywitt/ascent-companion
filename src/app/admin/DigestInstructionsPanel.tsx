"use client";

import { useEffect, useState } from "react";

import { Banner, Button, Loading, SectionLabel, Textarea } from "@/components/ui";

/**
 * Admin → Digest — the STANDING INSTRUCTIONS manager. These are the owner's
 * durable "how to write the brief" preferences, injected into the digest
 * summary prompt every morning (see src/lib/digest/instructions.ts). The reply
 * box on the home screen adds and drops them conversationally; this is the
 * see-them-all-and-remove surface, talking to /api/admin/digest-instructions.
 */

interface Instruction {
  id: number;
  text: string;
  createdBy: string;
}

export function DigestInstructionsPanel() {
  const [items, setItems] = useState<Instruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/digest-instructions");
      if (!res.ok) {
        setErr(res.status === 403 ? "Only admins can edit the digest's instructions." : "Failed to load instructions.");
        return;
      }
      setItems((await res.json()).instructions ?? []);
      setErr("");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/digest-instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setItems((await res.json()).instructions ?? []);
        setDraft("");
        setErr("");
      } else {
        setErr((await res.json().catch(() => ({}))).error || "Couldn't save that.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    const res = await fetch(`/api/admin/digest-instructions?id=${id}`, { method: "DELETE" });
    if (res.ok) setItems((await res.json()).instructions ?? []);
  }

  return (
    <div className="mb-6">
      <SectionLabel className="mb-1">Standing Instructions</SectionLabel>
      <p className="mb-2 text-xs text-neutral-500">
        Lasting notes for how the morning brief is written — Claude applies every one each day
        (&ldquo;stop mentioning the logo-update emails&rdquo;, &ldquo;always list overdue invoices
        first&rdquo;). This is memory for the digest, not a to-do list. You can also add or drop these
        by replying to the digest on the home screen.
      </p>

      {err && (
        <Banner tone="error" className="mb-2">
          {err}
        </Banner>
      )}

      <div className="mb-3">
        <Textarea
          rows={2}
          placeholder={`Add an instruction — e.g. "don't flag anything under $50"`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saving}
        />
        <div className="mt-2 flex justify-end">
          <Button onClick={add} size="sm" disabled={saving || !draft.trim()}>
            {saving ? "Adding…" : "Add"}
          </Button>
        </div>
      </div>

      {loading ? (
        <Loading label="Loading instructions…" />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-neutral-500">
          No standing instructions yet. Claude writes the brief from the checks alone.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2 text-sm dark:bg-ink-raised"
            >
              <span className="min-w-0 flex-1">{it.text}</span>
              <button
                onClick={() => remove(it.id)}
                className="shrink-0 text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
