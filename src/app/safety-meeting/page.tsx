"use client";

import { useEffect, useRef, useState } from "react";

import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { Banner, Button, Label, PageHeader, btn, inputCls } from "@/components/ui";

interface Employee {
  name: string;
  position: string;
  id: string;
}

interface Attendee {
  name: string;
  position: string;
  signaturePng: string;
}

interface SaveResult {
  ok: boolean;
  meetingId?: string;
  count?: number;
  folderUrl?: string;
  pdfUrl?: string;
  error?: string;
}

function today() {
  // Local date as YYYY-MM-DD for the <input type="date"> default.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function SafetyMeetingPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadErr, setLoadErr] = useState("");

  const [date, setDate] = useState(today());
  const [topic, setTopic] = useState("");
  const [admin, setAdmin] = useState("");

  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [currentName, setCurrentName] = useState("");
  const [hasInk, setHasInk] = useState(false);

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [saveErr, setSaveErr] = useState("");

  const padRef = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/employees");
        const json = await res.json();
        if (!res.ok || json.ok === false) {
          setLoadErr(json.error || "Could not load employees.");
          return;
        }
        setEmployees(json.employees ?? []);
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : "Could not load employees.");
      }
    })();
  }, []);

  const added = new Set(attendees.map((a) => a.name));
  // Everyone can be the meeting lead; the signer list drops those already added.
  const signerOptions = employees.filter((e) => !added.has(e.name));

  function addAttendee() {
    if (!currentName) return;
    const png = padRef.current?.toDataURL();
    if (!png) {
      alert("Please have this person sign before adding.");
      return;
    }
    const emp = employees.find((e) => e.name === currentName);
    setAttendees((list) => [
      ...list,
      { name: currentName, position: emp?.position ?? "", signaturePng: png },
    ]);
    padRef.current?.clear();
    setHasInk(false);
    setCurrentName("");
  }

  function removeAttendee(name: string) {
    setAttendees((list) => list.filter((a) => a.name !== name));
  }

  async function save() {
    setSaveErr("");
    if (!topic.trim()) return setSaveErr("Add a meeting topic.");
    if (!admin.trim()) return setSaveErr("Choose who ran the meeting.");
    if (attendees.length === 0) return setSaveErr("Add at least one signed attendee.");

    setSaving(true);
    try {
      const res = await fetch("/api/safety-meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, topic: topic.trim(), admin: admin.trim(), attendees }),
      });
      const json: SaveResult = await res.json();
      if (!res.ok || json.ok === false) {
        setSaveErr(json.error || "Save failed.");
        return;
      }
      setResult(json);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function startAnother() {
    setResult(null);
    setTopic("");
    setAttendees([]);
    setCurrentName("");
    setHasInk(false);
    padRef.current?.clear();
  }

  const cardCls =
    "rounded-xl border border-line bg-white p-3  dark:bg-ink-raised";

  // ---- Success screen -----------------------------------------------------
  if (result?.ok) {
    return (
      <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
        <PageHeader title="Safety Meeting" className="!mb-0" />
        <div className={"mt-4 " + cardCls}>
          <div className="text-lg font-semibold text-green-700 dark:text-green-400">
            Saved ✓ {result.count} signature{result.count === 1 ? "" : "s"}
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {topic} — {date}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {result.pdfUrl && (
              <a href={result.pdfUrl} target="_blank" rel="noreferrer" className={btn("primary")}>
                Open roster PDF
              </a>
            )}
            {result.folderUrl && (
              <a
                href={result.folderUrl}
                target="_blank"
                rel="noreferrer"
                className={btn("secondary")}
              >
                Open Drive folder
              </a>
            )}
          </div>
          <Button variant="secondary" className="mt-4 w-full" onClick={startAnother}>
            Start another meeting
          </Button>
        </div>
      </main>
    );
  }

  // ---- Capture screen -----------------------------------------------------
  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Safety Meeting"
        description="Set the meeting details, then pass the iPad around — each person picks their name and signs."
        className="!mb-4"
      />

      {loadErr && (
        <Banner tone="error" className="mb-4">
          {loadErr}
        </Banner>
      )}

      {/* Meeting header */}
      <section className={"mb-4 space-y-2 " + cardCls}>
        <Label className="!mb-0">Date</Label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />

        <Label className="!mb-0 pt-1">Topic</Label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Ladder safety"
          className={inputCls}
        />

        <Label className="!mb-0 pt-1">Meeting lead</Label>
        <select value={admin} onChange={(e) => setAdmin(e.target.value)} className={inputCls}>
          <option value="">Select…</option>
          {employees.map((e) => (
            <option key={e.id || e.name} value={e.name}>
              {e.name}
            </option>
          ))}
        </select>
      </section>

      {/* Attendee count + list */}
      {attendees.length > 0 && (
        <section className={"mb-4 " + cardCls}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Signed in ({attendees.length})
          </div>
          <ul className="space-y-1">
            {attendees.map((a) => (
              <li key={a.name} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="font-medium">{a.name}</span>
                  {a.position && (
                    <span className="text-neutral-500"> — {a.position}</span>
                  )}
                </span>
                <button
                  onClick={() => removeAttendee(a.name)}
                  className="shrink-0 text-xs font-semibold text-red-600 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Current signer */}
      <section className={"mb-4 space-y-2 " + cardCls}>
        <Label className="!mb-0">Attendee</Label>
        <select
          value={currentName}
          onChange={(e) => setCurrentName(e.target.value)}
          className={inputCls}
        >
          <option value="">Select employee…</option>
          {signerOptions.map((e) => (
            <option key={e.id || e.name} value={e.name}>
              {e.name}
              {e.position ? ` — ${e.position}` : ""}
            </option>
          ))}
        </select>

        <Label className="!mb-0 pt-1">Signature</Label>
        <SignaturePad ref={padRef} onChange={(empty) => setHasInk(!empty)} />

        <div className="flex gap-2 pt-1">
          <Button
            variant="secondary"
            onClick={() => {
              padRef.current?.clear();
              setHasInk(false);
            }}
          >
            Clear
          </Button>
          <Button className="flex-1" onClick={addAttendee} disabled={!currentName || !hasInk}>
            Add attendee
          </Button>
        </div>
      </section>

      {saveErr && (
        <Banner tone="error" className="mb-3">
          {saveErr}
        </Banner>
      )}

      <Button
        size="lg"
        className="w-full !text-base"
        onClick={save}
        disabled={saving || attendees.length === 0}
      >
        {saving
          ? "Saving…"
          : `Save meeting${attendees.length ? ` (${attendees.length})` : ""}`}
      </Button>
    </main>
  );
}
