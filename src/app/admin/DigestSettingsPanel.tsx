"use client";

import { useEffect, useMemo, useState } from "react";

import { Banner, Button, Input, Loading, SectionLabel, Toggle } from "@/components/ui";
import { categoryLabel } from "@/lib/digest/settings";

/**
 * Admin → Digest — tune the Daily Digest's checks (on/off, thresholds, watch
 * and ignore lists) without a redeploy. Everything here talks to
 * /api/admin/digest-settings (admin-gated); the actual defaults still live in
 * src/lib/digest/settings.ts — this only edits the DB-backed override layered
 * on top (src/lib/digest/overrides.ts).
 *
 * Adding a brand-new check is NOT done here — that's real code (a new file
 * under checks/), same as any other feature change.
 */

interface CheckSettings {
  id: string;
  title: string;
  category: string;
  default: { enabled: boolean; config: Record<string, unknown> };
  override: { enabled?: boolean; config?: Record<string, unknown> } | null;
  effective: { enabled: boolean; config: Record<string, unknown> };
}

/** "lookbackDays" -> "Lookback Days" — good enough without a per-field label map. */
function fieldLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function toFieldString(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

/** Parses a field back to the DEFAULT value's type — a number field stays a
 *  number, an array field splits on commas, everything else is a string. */
function parseField(raw: string, defaultValue: unknown): unknown {
  if (typeof defaultValue === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultValue;
  }
  if (Array.isArray(defaultValue)) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return raw;
}

export function DigestSettingsPanel() {
  const [checks, setChecks] = useState<CheckSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/digest-settings");
      if (!res.ok) {
        setErr(res.status === 403 ? "Only admins can tune the digest." : "Failed to load digest settings.");
        return;
      }
      setChecks((await res.json()).checks ?? []);
      setErr("");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function setEnabled(id: string, enabled: boolean) {
    const res = await fetch("/api/admin/digest-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkId: id, enabled }),
    });
    if (res.ok) setChecks((await res.json()).checks ?? []);
  }

  async function saveConfig(id: string, config: Record<string, unknown>) {
    const res = await fetch("/api/admin/digest-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkId: id, config }),
    });
    if (res.ok) setChecks((await res.json()).checks ?? []);
  }

  async function resetToDefault(id: string) {
    const res = await fetch(`/api/admin/digest-settings?checkId=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) setChecks((await res.json()).checks ?? []);
  }

  // Group in the order checks already come back (registry order), so the
  // grouping needs no separate category list to stay in sync with.
  const groups = useMemo(() => {
    const byCategory = new Map<string, CheckSettings[]>();
    for (const c of checks) {
      if (!byCategory.has(c.category)) byCategory.set(c.category, []);
      byCategory.get(c.category)!.push(c);
    }
    return [...byCategory.entries()];
  }, [checks]);

  return (
    <div>
      {err && (
        <Banner tone="error" className="mb-4">
          {err}
        </Banner>
      )}
      {loading && <Loading label="Loading digest settings…" />}

      <div className="space-y-5">
        {groups.map(([category, items]) => (
          <div key={category}>
            <SectionLabel className="mb-2">{categoryLabel(category)}</SectionLabel>
            <ul className="space-y-2">
              {items.map((c) => (
                <CheckRow
                  key={c.id}
                  check={c}
                  onToggle={(enabled) => setEnabled(c.id, enabled)}
                  onSaveConfig={(config) => saveConfig(c.id, config)}
                  onReset={() => resetToDefault(c.id)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function CheckRow({
  check,
  onToggle,
  onSaveConfig,
  onReset,
}: {
  check: CheckSettings;
  onToggle: (enabled: boolean) => void;
  onSaveConfig: (config: Record<string, unknown>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const configKeys = Object.keys(check.default.config);
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(configKeys.map((k) => [k, toFieldString(check.effective.config[k])])),
  );

  const isOverridden = check.override !== null;

  function save() {
    const config: Record<string, unknown> = {};
    for (const k of configKeys) config[k] = parseField(fields[k] ?? "", check.default.config[k]);
    onSaveConfig(config);
  }

  return (
    <li className="rounded-lg border border-line bg-white px-3 py-2 text-sm dark:bg-ink-raised">
      <div className="flex items-center justify-between gap-2">
        <Toggle checked={check.effective.enabled} onChange={onToggle} label={check.title} />
        <div className="flex shrink-0 items-center gap-3">
          {isOverridden && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">override</span>
          )}
          {configKeys.length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
            >
              Settings
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-line-soft pt-3 dark:border-white/10">
          {configKeys.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <label className="w-40 shrink-0 text-xs text-neutral-500">{fieldLabel(k)}</label>
              <Input
                value={fields[k] ?? ""}
                onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                className="flex-1"
              />
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            {isOverridden ? (
              <button
                onClick={onReset}
                className="text-xs font-semibold text-neutral-500 hover:text-accent"
              >
                Reset to default
              </button>
            ) : (
              <span />
            )}
            <Button onClick={save} size="sm">
              Save
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
