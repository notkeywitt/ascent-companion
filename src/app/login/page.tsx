"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function Login() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";

  const [inIframe, setInIframe] = useState(false);
  const [origin, setOrigin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setInIframe(window.self !== window.top);
    } catch {
      setInIframe(true);
    }
    setOrigin(window.location.origin);
  }, []);

  async function pwSubmit(e: React.FormEvent) {
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

  const btn =
    "flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
        Ascent Companion
      </p>
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Sign in</h1>

      {inIframe ? (
        <>
          <a href={origin || "/"} target="_blank" rel="noreferrer" className={btn}>
            Open in a new tab to sign in ↗
          </a>
          <p className="mt-2 text-xs text-neutral-500">
            Google sign-in can’t run inside the side panel. Sign in once in a browser tab; the
            panel will then stay signed in.
          </p>
        </>
      ) : (
        <button onClick={() => signIn("google", { callbackUrl: next })} className={btn}>
          Sign in with Google
        </button>
      )}

      <details className="mt-5">
        <summary className="cursor-pointer text-xs text-neutral-500">or use the shared password</summary>
        <form onSubmit={pwSubmit} className="mt-2 space-y-2">
          <input
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
            className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold hover:border-accent disabled:opacity-50 dark:border-neutral-700"
          >
            {busy ? "…" : "Enter"}
          </button>
        </form>
      </details>
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
