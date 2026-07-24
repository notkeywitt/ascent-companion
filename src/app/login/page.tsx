"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { AscentIcon } from "@/components/AscentLogo";
import { Banner, Button, btn, inputCls } from "@/components/ui";

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

  const primary = btn("primary", "lg", "w-full");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      {/* Brand lockup, over the brand hairline the app chrome carries. */}
      <AscentIcon className="mb-6 h-14 w-14 rounded-md" />
      <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-offblack dark:text-cream">
        Ascent
        <br />
        Building Co.
      </p>
      <div className="mb-5 mt-3 h-0.5 w-10 bg-brand" aria-hidden />
      <h1 className="mb-5 text-2xl font-bold tracking-tight">Sign in</h1>

      {inIframe ? (
        <>
          <a href={origin || "/"} target="_blank" rel="noreferrer" className={primary}>
            Open in a new tab to sign in ↗
          </a>
          <p className="mt-2 text-xs text-neutral-500">
            Google sign-in can’t run inside the side panel. Sign in once in a browser tab; the
            panel will then stay signed in.
          </p>
        </>
      ) : (
        <button onClick={() => signIn("google", { callbackUrl: next })} className={primary}>
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
            className={inputCls + " !py-2.5"}
          />
          {error && <Banner tone="error">{error}</Banner>}
          <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
            {busy ? "…" : "Enter"}
          </Button>
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
