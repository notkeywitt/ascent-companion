"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import { useAccess } from "@/components/AccessProvider";
import { useCopy } from "@/components/CopyProvider";
import { NoticeText } from "@/components/NoticeText";
import { Button, Card, Loading, SectionHeading, btn, inputCls } from "@/components/ui";
import { KloiCastButton } from "@/components/KloiCast";
import { toggleKloi, useKloi } from "@/lib/kloi";
import type { MapJob } from "@/lib/lopezMap";
import { useNearestJobs } from "@/lib/nearestJob";

const LopezMap = dynamic(() => import("@/components/LopezMap").then((m) => m.LopezMap));

interface HomeJob extends MapJob {
  customer?: string;
}
interface HomeNotice {
  id: number;
  title: string;
  body: string;
}

/**
 * The field Home (owner, 2026-11-15): the island map with every job on it, the
 * job you are clocked into (else the nearest one) ringed; the radio and
 * LopezRocks side by side; your notices; and a box to send a request or a bug
 * without leaving the page. Every part self-hides when its view or data is
 * missing. A field phone reads only /api/jobs, /api/employee-time/clock and
 * /api/notices here, all open to every role.
 */
export function FieldHome() {
  const access = useAccess();
  const c = useCopy();
  const kloi = useKloi();
  const [jobs, setJobs] = useState<HomeJob[] | null>(null);
  const [clockedId, setClockedId] = useState<string | null>(null);
  const [notices, setNotices] = useState<HomeNotice[] | null>(null);

  useEffect(() => {
    fetch("/api/jobs?withPhase=1")
      .then((r) => r.json())
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => setJobs([]));
    fetch("/api/employee-time/clock", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setClockedId(j.openEntry?.jobId ?? null))
      .catch(() => {});
    fetch("/api/notices")
      .then((r) => r.json())
      .then((j) => setNotices(j.notices ?? []))
      .catch(() => setNotices([]));
  }, []);

  // Clocked in: that job. Otherwise the nearest, once the phone gives a fix.
  const { nearest } = useNearestJobs(jobs ?? [], !clockedId && !!jobs);
  const highlightId = clockedId ?? nearest?.id ?? null;

  return (
    <main className="w-full max-w-2xl space-y-4 px-4 pb-10 pt-3 pad:pt-5">
      <div className="-mx-3 h-[38vh] min-h-[220px] [&_svg]:min-h-0 [&_svg]:flex-1">
        {jobs ? (
          <LopezMap
            jobs={jobs}
            selectedId={highlightId}
            legend={false}
            pad={6}
            className="h-full"
            label="Map of Lopez Island with job locations"
          />
        ) : (
          <Loading />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={toggleKloi}
          aria-pressed={kloi.playing}
          className={btn("secondary", "md", "min-h-12 w-full")}
        >
          {kloi.castDevice && kloi.playing ? `❚❚ Pause KLOI on ${kloi.castDevice}` : kloi.playing ? "❚❚ Pause KLOI" : kloi.failed ? "KLOI — try again" : "▶ KLOI radio"}
        </button>
          <KloiCastButton className={btn("secondary", "md", "col-span-2 min-h-12 w-full")} />
        {access.can("lopezrocks") ? (
          <Link href="/lopezrocks" className={btn("secondary", "md", "min-h-12 w-full")}>
            Lopez Rocks
          </Link>
        ) : (
          <span />
        )}
      </div>

      <section>
        <SectionHeading className="mb-2">Notifications</SectionHeading>
        <Card className="space-y-2">
          {notices === null ? (
            <Loading />
          ) : notices.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing new.</p>
          ) : (
            notices.map((n) => (
              <div key={n.id}>
                <p className="text-sm font-semibold">{n.title}</p>
                {n.body && (
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">
                    <NoticeText body={n.body} />
                  </p>
                )}
              </div>
            ))
          )}
        </Card>
      </section>

      {access.can("requests") && <RequestBox examples={c("home.request.examples")} />}
    </main>
  );
}

/** One box: type it, send it. The first line is the title; the rest is the detail. */
function RequestBox({ examples }: { examples: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "sent" | "error">("idle");
  // Picked after mount: a random pick on the server would not match the browser's.
  const [hint, setHint] = useState("");
  const lines = useMemo(() => examples.split("\n").map((l) => l.trim()).filter(Boolean), [examples]);
  useEffect(() => {
    if (lines.length) setHint(lines[Math.floor(Math.random() * lines.length)]);
  }, [lines]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || state === "saving") return;
    setState("saving");
    const [first, ...rest] = body.split("\n");
    try {
      const res = await fetch("/api/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: first.slice(0, 200), detail: [first.slice(200), ...rest].join("\n").trim() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setText("");
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <section>
      <SectionHeading className="mb-2">Make a request for an app update or report a bug.</SectionHeading>
      <form onSubmit={send} className="space-y-2">
        <textarea
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (state !== "saving") setState("idle");
          }}
          placeholder={hint}
          aria-label="Request or bug report"
          className={inputCls}
        />
        {state === "error" && <p className="text-[12px] text-danger">The request did not save. Try again.</p>}
        {state === "sent" && <p className="text-[12px] text-neutral-500">Sent. Thank you.</p>}
        <Button type="submit" className="w-full" disabled={!text.trim() || state === "saving"}>
          {state === "saving" ? "Sending…" : "Send"}
        </Button>
      </form>
    </section>
  );
}
