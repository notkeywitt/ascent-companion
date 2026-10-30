"use client";

import { useEffect, useState } from "react";

import { JobPicker, jobLabel } from "@/components/JobPicker";
import { Banner, Button, Chip, EmptyState, Label, ListCard, Loading, MetaLine, SectionHeading, Select } from "@/components/ui";
import type { SignalChat, SignalRule } from "@/lib/signalChats";

const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

const RULES: { id: SignalRule; label: string }[] = [
  { id: "", label: "Not set" },
  { id: "job", label: "A job" },
  { id: "office", label: "Office group (no job)" },
  { id: "skip", label: "Don't send" },
];

/** Not-set chats first (they need a decision), then the newest. */
const order = (a: SignalChat, b: SignalChat) =>
  Number(a.rule !== "") - Number(b.rule !== "") || b.lastAt.localeCompare(a.lastAt);

/**
 * The AscentBot page's Signal chats: every chat the office Mac mini reported
 * (scripts/signal-sync/), each assigned to a job, the office, or nothing. Only
 * job and office chats are sent. Each save takes effect on the Mac's next run.
 */
export function SignalChats() {
  const [chats, setChats] = useState<SignalChat[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(init?: RequestInit) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/ascentbot/signal", init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
      setChats((body.chats as SignalChat[]).sort(order));
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void call();
  }, []);

  const notSet = chats?.filter((c) => c.rule === "").length ?? 0;

  return (
    <section>
      <SectionHeading trailing={notSet ? <Chip tone="warning">{notSet} not set</Chip> : undefined}>Signal chats</SectionHeading>
      <p className="mb-3 text-xs text-neutral-500">
        The office Mac mini sends new Signal messages at 7 AM and 5 PM. A chat set to a job is filed under that job; an
        office group is searchable from any job. Not set and Don&apos;t send chats stay on the Mac. A new chat shows up
        here after the Mac&apos;s next run.
      </p>
      {err && <Banner tone="error">{err}</Banner>}
      {!chats ? (
        err ? null : <Loading />
      ) : chats.length ? (
        <ListCard>
          {chats.map((c) => (
            <ChatRow
              key={c.chat}
              chat={c}
              busy={busy}
              onSave={(next) =>
                call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat: c.chat, ...next }) })
              }
            />
          ))}
        </ListCard>
      ) : (
        <EmptyState>The Mac mini has not reported any Signal chats yet.</EmptyState>
      )}
    </section>
  );
}

function ChatRow({
  chat,
  busy,
  onSave,
}: {
  chat: SignalChat;
  busy: boolean;
  onSave: (next: { rule: SignalRule; jobId: string; jobName: string }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState<SignalRule>(chat.rule);
  const [jobId, setJobId] = useState(chat.jobId);
  const [jobName, setJobName] = useState(chat.jobName);
  const dirty = rule !== chat.rule || (rule === "job" && jobId !== chat.jobId);
  const removes = (rule === "" || rule === "skip") && chat.kept > 0;

  const status =
    chat.rule === "job" ? (
      <Chip tone="success">{chat.jobName || "Job"}</Chip>
    ) : chat.rule === "office" ? (
      <Chip tone="info">Office</Chip>
    ) : chat.rule === "skip" ? (
      <Chip>Don&apos;t send</Chip>
    ) : (
      <Chip tone="warning">Not set</Chip>
    );

  return (
    <div className="px-3 py-2.5">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight">{chat.chat}</span>
          <MetaLine
            items={[
              chat.type === "group" ? "Group" : "Direct",
              `${chat.messages} messages`,
              chat.lastAt ? `last ${day(chat.lastAt)}` : null,
              chat.kept ? `${chat.kept} in AscentBot` : null,
            ]}
          />
        </span>
        {status}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <Label>Send to AscentBot as</Label>
            <Select value={rule} onChange={(e) => setRule(e.target.value as SignalRule)}>
              {RULES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          {rule === "job" && (
            <div>
              <Label>Job</Label>
              <JobPicker
                value={jobId}
                onChange={setJobId}
                onSelect={(j) => setJobName(j ? jobLabel(j) : "")}
                includeAll={false}
                placeholder="Choose a job…"
                fallbackLabel={chat.jobName || undefined}
              />
            </div>
          )}
          {chat.type !== "group" && (rule === "job" || rule === "office") && (
            <p className="text-xs text-neutral-500">A direct chat: everyone who can ask AscentBot could see what it holds.</p>
          )}
          {removes && (
            <p className="text-xs text-neutral-500">Saving removes its {chat.kept} messages from AscentBot&apos;s memory.</p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={busy || !dirty || (rule === "job" && !jobId)}
              onClick={async () => {
                if (removes && !confirm(`Remove ${chat.kept} messages of "${chat.chat}" from AscentBot's memory?`)) return;
                if (await onSave({ rule, jobId: rule === "job" ? jobId : "", jobName: rule === "job" ? jobName : "" })) setOpen(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
