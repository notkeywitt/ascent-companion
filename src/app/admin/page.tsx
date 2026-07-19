"use client";

import { useEffect, useState } from "react";

import { Button, Loading, PageHeader, SectionLabel, inputCls } from "@/components/ui";

interface Member {
  email: string;
  addedBy: string;
  createdAt: string;
}

export default function AdminPage() {
  const [envAdmins, setEnvAdmins] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/team");
      const j = await res.json();
      setEnvAdmins(j.envAdmins ?? []);
      setMembers(j.members ?? []);
      setMe(j.me ?? null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) return;
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      setEmail("");
      const j = await res.json();
      setMembers(j.members ?? []);
    }
  }
  async function remove(em: string) {
    const res = await fetch(`/api/team?email=${encodeURIComponent(em)}`, { method: "DELETE" });
    if (res.ok) setMembers((await res.json()).members ?? []);
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Team Access"
        description={`Who can sign in with Google.${me ? ` You're ${me}.` : ""}`}
        className="!mb-4"
      />

      <form onSubmit={add} className="mb-5 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@ascentbuildingco.com"
          className={inputCls}
        />
        <Button type="submit" className="shrink-0">
          Add
        </Button>
      </form>

      {loading && <Loading label="Loading team…" />}

      {envAdmins.length > 0 && (
        <div className="mb-4">
          <SectionLabel className="mb-1">Founders (set in hosting config)</SectionLabel>
          <ul className="space-y-1">
            {envAdmins.map((e) => (
              <li
                key={e}
                className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700/60"
              >
                <span>{e}</span>
                <span className="text-xs text-neutral-400">always allowed</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SectionLabel className="mb-1">Members</SectionLabel>
      <ul className="space-y-1">
        {members.map((m) => (
          <li
            key={m.email}
            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700/60 dark:bg-ink-raised"
          >
            <span>{m.email}</span>
            <button
              onClick={() => remove(m.email)}
              className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
            >
              Remove
            </button>
          </li>
        ))}
        {!loading && members.length === 0 && (
          <li className="rounded-lg border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500 dark:border-neutral-700">
            No added members yet — just the founders above.
          </li>
        )}
      </ul>
    </main>
  );
}
