"use client";

import { PageTabs, LOOK_TABS } from "@/components/PageTabs";
import { toast } from "@/components/Toast";
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
import { AdminTabs } from "@/app/admin/AdminTabs";

/**
 * Admin → Page Text — reword the app's on-screen copy without a deploy.
 *
 * Each field is one registry key (src/lib/copy.ts). Editing a box and hitting
 * Save writes an override row; the change is live on the next page load, with
 * no rebuild — the layout reads overrides per request.
 *
 * Each field has three radio choices: Default (the wording shipped in the code),
 * Custom (the text box turns on) and Blank (show nothing). Default and Blank
 * turn the text box off.
 */

type Mode = "default" | "custom" | "blank";

interface Entry {
  key: string;
  label: string;
  short: boolean;
  tokens: string[];
  text: string; // shipped default
  value: string; // what renders today
  overridden: boolean;
  blank: boolean;
}

function savedMode(e: Entry): Mode {
  return e.blank ? "blank" : e.overridden ? "custom" : "default";
}

interface Group {
  group: string;
  entries: Entry[];
}

export default function PageTextEditor() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/copy");
      if (!res.ok) throw new Error(res.status === 403 ? "Admins only." : `Load failed (${res.status})`);
      const json = (await res.json()) as { groups: Group[] };
      setGroups(json.groups);
      const d: Record<string, string> = {};
      const m: Record<string, Mode> = {};
      for (const g of json.groups)
        for (const e of g.entries) {
          d[e.key] = e.blank ? e.text : e.value;
          m[e.key] = savedMode(e);
        }
      setDraft(d);
      setModes(m);
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
        body: JSON.stringify({
          key: entry.key,
          mode: modes[entry.key] ?? "default",
          value: draft[entry.key] ?? "",
        }),
      });
      const json = (await res.json()) as {
        value?: string;
        overridden?: boolean;
        mode?: Mode;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
      // Reflect what the server actually stored (a cleared box comes back as the
      // shipped default), so the box and the badge can't drift from the DB.
      setGroups((gs) =>
        gs.map((g) => ({
          ...g,
          entries: g.entries.map((e) =>
            e.key === entry.key
              ? {
                  ...e,
                  value: json.value ?? e.text,
                  overridden: json.overridden ?? false,
                  blank: json.mode === "blank",
                }
              : e,
          ),
        })),
      );
      setDraft((d) => ({
        ...d,
        [entry.key]: json.mode === "custom" ? (json.value ?? entry.text) : entry.text,
      }));
      toast("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <Loading label="Loading page text…" />;

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 lg:max-w-[1600px]">
      <AdminTabs />
      <PageTabs tabs={LOOK_TABS} />
      <PageHeader title="Page Text" />

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      <Banner tone="info" className="mb-6">
        Pick Default, Custom or Blank for each line. Custom turns the box on. Blank shows nothing.
      </Banner>

      <div className="lg:columns-2 lg:gap-8 2xl:columns-3">
      {groups.map((g) => (
        <section key={g.group} className="mb-8 break-inside-avoid-column">
          <SectionHeading>{g.group}</SectionHeading>
          <div className="rounded-control border border-line">
            {g.entries.map((e, i) => {
              const mode = modes[e.key] ?? "default";
              const value = mode === "default" ? e.text : (draft[e.key] ?? "");
              const dirty =
                mode !== savedMode(e) || (mode === "custom" && value !== e.value);
              const isLong = !e.short && e.text.length > 40;
              // A dropped {token} silently loses the value it stood for (the
              // month, a count), so say so before it's saved — but don't block
              // it: a rewording that genuinely doesn't need the value is valid.
              const missing =
                mode === "custom" ? e.tokens.filter((t) => !value.includes(`{${t}}`)) : [];
              return (
                <div
                  key={e.key}
                  className={`p-4 ${i > 0 ? "border-t border-line-soft" : ""}`}
                >
                  <label htmlFor={e.key} className="mb-2 block text-sm font-medium">
                    {e.label}
                    {e.overridden && (
                      <span className="ml-2 text-xs font-normal text-neutral-500">
                        {e.blank ? "blank" : "edited"}
                      </span>
                    )}
                  </label>

                  <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {(["default", "custom", "blank"] as const).map((m) => (
                      <label key={m} className="inline-flex items-center gap-1.5">
                        <input
                          type="radio"
                          name={`mode-${e.key}`}
                          checked={mode === m}
                          onChange={() => setModes((s) => ({ ...s, [e.key]: m }))}
                        />
                        {m === "default" ? "Default" : m === "custom" ? "Custom" : "Blank"}
                      </label>
                    ))}
                  </div>

                  {isLong ? (
                    <Textarea
                      id={e.key}
                      rows={2}
                      disabled={mode !== "custom"}
                      value={mode === "blank" ? "" : value}
                      onChange={(ev) => setDraft((d) => ({ ...d, [e.key]: ev.target.value }))}
                    />
                  ) : (
                    <Input
                      id={e.key}
                      disabled={mode !== "custom"}
                      value={mode === "blank" ? "" : value}
                      onChange={(ev) => setDraft((d) => ({ ...d, [e.key]: ev.target.value }))}
                    />
                  )}

                  {e.tokens.length > 0 && (
                    <p className="mt-1.5 text-xs text-neutral-500">
                      Keep {e.tokens.map((t) => `{${t}}`).join(", ")} — it fills in the real value.
                      {missing.length > 0 && (
                        <span className="ml-1 font-medium text-warn">
                          Missing {missing.map((t) => `{${t}}`).join(", ")}.
                        </span>
                      )}
                    </p>
                  )}

                  <div className="mt-2 flex items-center gap-3">
                    <Button
                      onClick={() => void save(e)}
                      disabled={!dirty || saving === e.key || (mode === "custom" && value.trim() === "")}
                    >
                      {saving === e.key ? "Saving…" : "Save"}
                    </Button>
                  </div>

                  {e.overridden && mode !== "default" && (
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
      </div>
    </main>
  );
}
