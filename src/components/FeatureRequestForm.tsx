"use client";

import { useState } from "react";

import { Button, inputCls } from "@/components/ui";

/**
 * The new Feature Request form. One form, two places: the /requests page and
 * the admin's Home button (OfficeHome), which opens it in a sheet.
 * Posts to /api/feature-requests and calls `onDone` after a save.
 */
export function FeatureRequestForm({
  onDone,
  className = "",
}: {
  onDone: () => void;
  className?: string;
}) {
  const [form, setForm] = useState({ title: "", detail: "", requester: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm({ title: "", detail: "", requester: "" });
      onDone();
    } catch {
      setError("The request did not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={create} className={`space-y-2 ${className}`}>
      <input
        autoFocus
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        placeholder="What do you want? (required)"
        className={inputCls}
      />
      <textarea
        value={form.detail}
        onChange={(e) => setForm({ ...form, detail: e.target.value })}
        placeholder="Any details — where it goes, how it should work…"
        rows={3}
        className={inputCls}
      />
      <input
        value={form.requester}
        onChange={(e) => setForm({ ...form, requester: e.target.value })}
        placeholder="Your name"
        className={inputCls}
      />
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? "Saving…" : "Submit request"}
      </Button>
    </form>
  );
}
