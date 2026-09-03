"use client";

import { useMemo, useState } from "react";
import {
  Banner,
  Button,
  Card,
  Input,
  Label,
  MetaLine,
  Select,
  SectionHeading,
  Textarea,
  Toggle,
} from "@/components/ui";
import type { CustomFieldValue } from "./types";

/**
 * The one edit form behind every record on this page — a job, a customer, a
 * contact, a site.
 *
 * All four save through `POST /api/clients/update`, which decides what is
 * writable; this component only decides what to DRAW. Two consequences worth
 * knowing:
 *
 *   • **Save sends only what changed.** The route rejects an empty patch, so a
 *     Save with nothing dirty is disabled rather than sent. Sending the whole
 *     form back on every save would journal untouched fields as writes.
 *   • **The answer redraws from JobTread, not from the form.** `onSaved` is
 *     handed the record as the server re-read it, because JobTread derives
 *     fields from what was saved — a location's tidied address, city, state and
 *     ZIP all follow from its free-text address — and the form's own values
 *     would show the text that was typed instead.
 *
 * A field the API holds read-only is drawn as text with the reason underneath,
 * never as a disabled input — a greyed-out box invites a click that can never
 * work.
 */

export type ScalarKind = "text" | "textarea" | "date" | "select" | "toggle";

export interface ScalarSpec {
  /** The JobTread field name. Must appear in the route's allowlist to save. */
  name: string;
  label: string;
  kind: ScalarKind;
  options?: { value: string; label: string }[];
  maxLength?: number;
  placeholder?: string;
  help?: string;
}

export type RecordKind = "job" | "account" | "contact" | "location";

/** A read-only fact drawn beside the editable ones. */
export interface ReadOnlyRow {
  label: string;
  value: React.ReactNode;
  note?: string;
}

type Draft = Record<string, string | boolean>;

function initialDraft(scalars: ScalarSpec[], values: Record<string, unknown>): Draft {
  const out: Draft = {};
  for (const s of scalars) {
    const raw = values[s.name];
    out[s.name] = s.kind === "toggle" ? raw === true : raw == null ? "" : String(raw);
  }
  return out;
}

function initialFields(fields: CustomFieldValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.editable) out[f.fieldId] = f.values[0] ?? "";
  }
  return out;
}

export function RecordEditor({
  kind,
  id,
  jobId,
  heading,
  scalars,
  values,
  fields,
  readOnly = [],
  onSaved,
}: {
  kind: RecordKind;
  id: string;
  /** Journal context when the record is not itself a job. */
  jobId?: string;
  heading: string;
  scalars: ScalarSpec[];
  /** Current values, by JobTread field name. */
  values: Record<string, unknown>;
  fields: CustomFieldValue[];
  readOnly?: ReadOnlyRow[];
  /** Handed JobTread's own post-write values so the caller can redraw. */
  onSaved?: (saved: Record<string, unknown>) => void;
}) {
  // Keyed remount by the caller (see `key={record.id}`) is what resets these,
  // so a saved record redrawing does not fight a half-typed field.
  const [draft, setDraft] = useState<Draft>(() => initialDraft(scalars, values));
  const [fieldDraft, setFieldDraft] = useState<Record<string, string>>(() =>
    initialFields(fields),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const editableFields = useMemo(() => fields.filter((f) => f.editable), [fields]);
  const lockedFields = useMemo(
    () => fields.filter((f) => !f.editable && f.values.length > 0),
    [fields],
  );

  const dirtyScalars = useMemo(() => {
    const out: Record<string, string | boolean> = {};
    for (const s of scalars) {
      const was = s.kind === "toggle" ? values[s.name] === true : String(values[s.name] ?? "");
      if (draft[s.name] !== was) out[s.name] = draft[s.name];
    }
    return out;
  }, [draft, scalars, values]);

  const dirtyFields = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of editableFields) {
      const was = f.values[0] ?? "";
      if ((fieldDraft[f.fieldId] ?? "") !== was) out[f.fieldId] = fieldDraft[f.fieldId] ?? "";
    }
    return out;
  }, [fieldDraft, editableFields]);

  const dirtyCount = Object.keys(dirtyScalars).length + Object.keys(dirtyFields).length;

  async function save() {
    if (dirtyCount === 0) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/clients/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          id,
          jobId,
          fields: dirtyScalars,
          customFieldValues: dirtyFields,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        previewed?: boolean;
        saved?: Record<string, unknown>;
      };
      if (!res.ok || json.error) throw new Error(json.error ?? `Save failed (HTTP ${res.status})`);
      if (json.previewed) {
        setNote("Writes are switched off on this deployment — nothing was sent to JobTread.");
        return;
      }
      setNote("Saved to JobTread.");
      if (json.saved) onSaved?.(json.saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <SectionHeading
        trailing={
          dirtyCount > 0 ? (
            <span className="text-[11px] font-semibold text-accent">
              {dirtyCount} unsaved
            </span>
          ) : undefined
        }
      >
        {heading}
      </SectionHeading>

      <Card className="space-y-3">
        {scalars.map((s) => (
          <div key={s.name}>
            <Label htmlFor={`${id}-${s.name}`}>{s.label}</Label>
            {s.kind === "toggle" ? (
              <Toggle
                checked={draft[s.name] === true}
                onChange={(v) => setDraft((d) => ({ ...d, [s.name]: v }))}
                label={draft[s.name] === true ? "Yes" : "No"}
              />
            ) : s.kind === "select" ? (
              <Select
                id={`${id}-${s.name}`}
                value={String(draft[s.name] ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [s.name]: e.target.value }))}
              >
                <option value="">—</option>
                {(s.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : s.kind === "textarea" ? (
              <Textarea
                id={`${id}-${s.name}`}
                rows={4}
                maxLength={s.maxLength}
                placeholder={s.placeholder}
                value={String(draft[s.name] ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [s.name]: e.target.value }))}
              />
            ) : (
              <Input
                id={`${id}-${s.name}`}
                type={s.kind === "date" ? "date" : "text"}
                maxLength={s.maxLength}
                placeholder={s.placeholder}
                value={String(draft[s.name] ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [s.name]: e.target.value }))}
              />
            )}
            {s.help && (
              <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{s.help}</p>
            )}
          </div>
        ))}

        {editableFields.map((f) => (
          <div key={f.fieldId}>
            <Label htmlFor={`${id}-${f.fieldId}`}>{f.name}</Label>
            {f.type === "option" && f.options.length > 0 ? (
              <Select
                id={`${id}-${f.fieldId}`}
                value={fieldDraft[f.fieldId] ?? ""}
                onChange={(e) =>
                  setFieldDraft((d) => ({ ...d, [f.fieldId]: e.target.value }))
                }
              >
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : f.type === "text" ? (
              <Textarea
                id={`${id}-${f.fieldId}`}
                rows={3}
                value={fieldDraft[f.fieldId] ?? ""}
                onChange={(e) =>
                  setFieldDraft((d) => ({ ...d, [f.fieldId]: e.target.value }))
                }
              />
            ) : (
              <Input
                id={`${id}-${f.fieldId}`}
                type={
                  f.type === "date"
                    ? "date"
                    : f.type === "emailAddress"
                      ? "email"
                      : f.type === "phoneNumber"
                        ? "tel"
                        : f.type === "number"
                          ? "number"
                          : "text"
                }
                value={fieldDraft[f.fieldId] ?? ""}
                onChange={(e) =>
                  setFieldDraft((d) => ({ ...d, [f.fieldId]: e.target.value }))
                }
              />
            )}
          </div>
        ))}
      </Card>

      {(readOnly.length > 0 || lockedFields.length > 0) && (
        <Card pad={false} className="divide-y divide-line-soft">
          {readOnly.map((r) => (
            <div key={r.label} className="px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {r.label}
                </span>
                <span className="min-w-0 break-words text-right text-sm tabular-nums">
                  {r.value || "—"}
                </span>
              </div>
              {r.note && <MetaLine items={[r.note]} className="mt-1" />}
            </div>
          ))}
          {lockedFields.map((f) => (
            <div key={f.fieldId} className="px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {f.name}
                </span>
                <span className="min-w-0 break-words text-right text-sm">
                  {f.values.join(", ")}
                </span>
              </div>
              <MetaLine
                items={["Holds several values at once — edit it in JobTread until the write is probed"]}
                className="mt-1"
              />
            </div>
          ))}
        </Card>
      )}

      {error && <Banner tone="error">{error}</Banner>}
      {note && <Banner tone={note.startsWith("Saved") ? "success" : "warning"}>{note}</Banner>}

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={dirtyCount === 0 || saving}>
          {saving ? "Saving…" : "Save to JobTread"}
        </Button>
        {dirtyCount > 0 && !saving && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(initialDraft(scalars, values));
              setFieldDraft(initialFields(fields));
              setError("");
              setNote("");
            }}
          >
            Discard
          </Button>
        )}
      </div>
    </section>
  );
}
