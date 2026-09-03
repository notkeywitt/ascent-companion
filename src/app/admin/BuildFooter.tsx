"use client";

/**
 * The version tracker: which build of each half of the system is running.
 *
 * The Assistant's own stamp costs nothing — next.config.mjs freezes the commit,
 * branch, subject and build time into the bundle, so this renders them straight
 * from `process.env` with no request. The Apps Script back end's stamp DOES cost
 * a round trip (a cold Apps Script GET is seconds), so it sits behind a button
 * rather than slowing every visit to /admin.
 *
 * Read it after a deploy to answer the one question a green deploy does not:
 * is the code I just shipped the code that is actually serving?
 */
import { useEffect, useState } from "react";

import { Button, MetaLine, SectionLabel } from "@/components/ui";

// Static member reads, so Next can substitute them at build time. Do not
// rewrite these as `process.env[name]` — a computed key is not replaced, and
// the footer would go blank in production with nothing to explain why.
const SHA = process.env.APP_BUILD_SHA || "";
const REF = process.env.APP_BUILD_REF || "";
const SUBJECT = process.env.APP_BUILD_MESSAGE || "";
const BUILT_AT = process.env.APP_BUILD_TIME || "";
const BUILD_ENV = process.env.APP_BUILD_ENV || "";

interface BackEnd {
  build?: string;
  service?: string;
  checkedAt?: string;
  error?: string;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function BuildFooter() {
  // Formatted on the client only: the server renders in UTC and the phone
  // renders in Pacific, and a differing string is a hydration error.
  const [builtAt, setBuiltAt] = useState("");
  const [backEnd, setBackEnd] = useState<BackEnd | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setBuiltAt(fmtWhen(BUILT_AT));
  }, []);

  async function check() {
    setChecking(true);
    try {
      const res = await fetch("/api/admin/build", { cache: "no-store" });
      setBackEnd((await res.json()) as BackEnd);
    } catch (err) {
      setBackEnd({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="mt-10 border-t border-line-soft pt-4">
      <SectionLabel>Build</SectionLabel>

      <div className="mt-2 space-y-1.5">
        <div>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Assistant{" "}
            <span className="font-mono">{SHA ? SHA.slice(0, 7) : "unknown"}</span>
          </p>
          <MetaLine
            items={[
              REF,
              BUILD_ENV,
              builtAt ? `built ${builtAt}` : null,
              SUBJECT,
            ]}
          />
        </div>

        <div>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Back end{" "}
            <span className="font-mono">
              {backEnd?.build || (backEnd?.error ? "unknown" : "not checked")}
            </span>
          </p>
          <MetaLine
            items={[
              backEnd?.error ?? null,
              backEnd?.checkedAt ? `checked ${fmtWhen(backEnd.checkedAt)}` : null,
              backEnd ? null : "Apps Script — ask it when you need to know",
            ]}
          />
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={check}
        disabled={checking}
      >
        {checking ? "Checking…" : "Check back end"}
      </Button>
    </section>
  );
}
