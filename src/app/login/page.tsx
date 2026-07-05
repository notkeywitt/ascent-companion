"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function Login() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) router.push(next);
      else setError("Wrong password");
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
        Ascent Companion
      </p>
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Sign in</h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "…" : "Enter"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Login />
    </Suspense>
  );
}
