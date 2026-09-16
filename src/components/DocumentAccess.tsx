"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Button, EmptyState, Loading, MetaLine } from "@/components/ui";

/**
 * The client's "Document Access" list on vendor bills, added to in one press.
 *
 * JobTread shares a document by naming a membership on it (an `ace`), one
 * document at a time. This is that control in bulk: the same list, over either
 * a whole billing month or a single bill, so the office can let a client read
 * the bills behind their invoice without opening forty documents.
 *
 * ONE component for both scopes — `ym` for the month, `docId` for one bill. The
 * server reads a docId's job off the document itself, so the contacts offered
 * are always that job's customer and nobody else's.
 *
 * Used inside the Tracking Sheets closing-row dialog (the month) and in the
 * bill card's own "Client access" block (one bill).
 */

/** /api/document-access — who can already read the bills in scope, and how many. */
interface DocAccess {
  billCount: number;
  writesEnabled: boolean;
  contacts: {
    membershipId: string;
    name: string;
    emailAddress: string;
    roleName: string;
    /** How many of the bills in scope already list this contact. */
    granted: number;
  }[];
}

export function DocumentAccess({
  jobId,
  ym,
  docId,
  scopeLabel,
}: {
  jobId?: string;
  ym?: string;
  docId?: string;
  /** Names the scope in a result line — "September 2026" or "this bill". */
  scopeLabel: string;
}) {
  const [access, setAccess] = useState<DocAccess | null>(null);
  const [error, setError] = useState("");
  /** The membership currently being granted — one row's button at a time. */
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const scope: Record<string, string> = docId
    ? { docId }
    : { jobId: jobId ?? "", ym: ym ?? "" };

  const query = new URLSearchParams(scope).toString();

  const load = useCallback(async () => {
    setAccess(null);
    setError("");
    try {
      const r = await fetch(`/api/document-access?${query}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? "Could not read document access");
      setAccess(j as DocAccess);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read document access");
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Give ONE contact everything in scope. Bills they already reach are skipped. */
  const grant = async (membershipId: string) => {
    setBusy(membershipId);
    setMsg(null);
    try {
      const r = await fetch("/api/document-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scope, membershipId }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? "Could not give access");
      const n = j.previewed ? j.wouldAdd : j.added;
      const verb = j.previewed ? "Would add" : "Added";
      setMsg({
        tone: j.failed?.length ? "error" : "success",
        text:
          `${verb} ${j.name || "that contact"} to ${n} bill${n === 1 ? "" : "s"} · ${scopeLabel}` +
          (j.already ? ` (${j.already} already shared)` : "") +
          (j.failed?.length
            ? ` — ${j.failed.length} failed: ${j.failed.slice(0, 2).join("; ")}`
            : "."),
      });
      await load();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Could not give access" });
    } finally {
      setBusy("");
    }
  };

  if (error) return <Banner tone="error">{error}</Banner>;
  if (!access) return <Loading label="Reading document access…" />;
  if (access.contacts.length === 0) {
    return (
      <EmptyState>
        No customer contact on this job&apos;s client yet. Add one in JobTread first — Document
        Access can only name someone who already has a login.
      </EmptyState>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {access.contacts.map((c) => {
          const all = access.billCount > 0 && c.granted >= access.billCount;
          return (
            <li
              key={c.membershipId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-line px-3 py-2.5 text-sm dark:border-neutral-700"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                <MetaLine
                  items={[
                    c.emailAddress,
                    c.roleName,
                    // One bill reads "shared" / "not shared"; a month counts.
                    access.billCount === 1
                      ? all
                        ? "shared"
                        : "not shared"
                      : `${c.granted} of ${access.billCount} bills`,
                  ]}
                />
              </span>
              <Button
                variant={all ? "secondary" : "primary"}
                size="sm"
                className="min-h-11 shrink-0 sm:min-h-0"
                disabled={all || access.billCount === 0 || busy !== ""}
                onClick={() => grant(c.membershipId)}
              >
                {busy === c.membershipId
                  ? "Adding…"
                  : all
                    ? "Has access"
                    : access.billCount === 1
                      ? "Give access"
                      : `Add to ${access.billCount - c.granted}`}
              </Button>
            </li>
          );
        })}
      </ul>

      {msg && (
        <Banner tone={msg.tone} className="mt-2">
          {msg.text}
        </Banner>
      )}

      {!access.writesEnabled && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          Writes are disabled on this deployment — this will preview only.
        </p>
      )}
    </>
  );
}
