"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { AscentIcon } from "@/components/AscentLogo";
import { btn } from "@/components/ui";

function Login() {
  const search = useSearchParams();
  const next = search.get("next") || "/";

  const [inIframe, setInIframe] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    try {
      setInIframe(window.self !== window.top);
    } catch {
      setInIframe(true);
    }
    setOrigin(window.location.origin);
  }, []);


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
