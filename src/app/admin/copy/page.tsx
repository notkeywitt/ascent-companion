"use client";

import { useCallback, useEffect, useState } from "react";

import {
  Banner,
  Button,
  Input,
  Loading,
  PageHeader,
  SectionHeading,
  Textarea,
} from "@/components/ui";

/**
 * Admin → Page Text — reword the app's on-screen copy without a deploy.
 *
 * Each field is one registry key (src/lib/copy.ts). Editing a box and hitting
 * Save writes an override row; the change is live on the next page load, with
 * no rebuild — the layout reads overrides per request.
 *
 * CLEARING a box reverts that string to the wording shipped in the code, which
 * is why there's no separate delete: blank means "use the default".
 */

interface Entry {
  key: string;
  label: string;
  short: boolean;
  text: string; // shipped default
  value: string; // what renders today
  overridden: boolean;
}

interface Group {
  group: string;
  entries: Entry[];
}

export default function PageTextEditor() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/copy");
      if (!res.ok) throw new Error(res.status === 403 ? "Admins only." : `Load failed (${res.status})`);
      const json = (await res.json()) as { groups: Group[] };
      setGroups(json.groups);
      const d: Record<string, string> = {};
      for (const g of json.groups) for (const e of g.entries) d[e.key] = e.value;
      setDraft(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(entry: Entry) {
    setSaving(entry.key);
    setError("");
    try {
      const res = await fetch("/api/admin/copy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: entry.key, value: draft[entry.key] ?? "" }),
      });
      const json = (await res.json()) as { value?: string; overridden?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
      // Reflect what the server actually stored (a cleared box comes back as the
      // shipped default), so the box and the badge can't drift from the DB.
      setGroups((gs) =>
        gs.map((g) => ({
          ...g,
          entries: g.entries.map((e) =>
            e.key === entry.key
              ? { ...e, value: json.value ?? e.text, overridden: json.overridden ?? false }
              : e,
          ),
        })),
      );
      setDraft((d) => ({ ...d, [entry.key]: json.value ?? entry.text }));
      setSaved(entry.key);
      setTimeout(() => setSaved((k) => (k === entry.key ? null : k)), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <Loading label="Loading page text…" />;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24">
      <PageHeader
        title="Page Text"
        description="Reword what the app says. Changes go live immediately — no deploy."
      />

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      <Banner tone="info" className="mb-6">
        Clear a box and save to put back the original wording.
      </Banner>

      {groups.map((g) => (
        <section key={g.group} className="mb-8">
          <SectionHeading>{g.group}</SectionHeading>
          <div className="rounded-lg border border-line">
            {g.entries.map((e, i) => {
              const value = draft[e.key] ?? "";
              const dirty = value !== e.value;
              const isLong = !e.short && e.text.length > 40;
              return (
                <div
                  key={e.key}
                  className={`p-4 ${i > 0 ? "border-t border-line-soft" : ""}`}
                >
                  <label htmlFor={e.key} className="mb-2 block text-sm font-medium">
                    {e.label}
                    {e.overridden && (
                      <span className="ml-2 text-xs font-normal text-neutral-500">edited</span>
                    )}
                  </label>

                  {isLong ? (
                    <Textarea
                      id={e.key}
                      rows={2}
                      value={value}
                      onChange={(ev) => setDraft((d) => ({ ...d, [e.key]: ev.target.value }))}
                    />
                  ) : (
                    <Input
                      id={e.key}
                      value={value}
                      onChange={(ev) => setDraft((d) => ({ ...d, [e.key]: ev.target.value }))}
                    />
                  )}

                  <div className="mt-2 flex items-center gap-3">
                    <Button
                      onClick={() => void save(e)}
                      disabled={!dirty || saving === e.key}
                    >
                      {saving === e.key ? "Saving…" : "Save"}
                    </Button>
                    {saved === e.key && <span className="text-xs text-neutral-500">Saved</span>}
                    {e.overridden && !dirty && (
                      <button
                        type="button"
                        className="text-xs underline text-neutral-500"
                        onClick={() => {
                          setDraft((d) => ({ ...d, [e.key]: "" }));
                        }}
                      >
                        Revert to default
                      </button>
                    )}
                  </div>

                  {e.overridden && (
                    <p className="mt-2 text-xs text-neutral-500">
                      Default: {e.text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
