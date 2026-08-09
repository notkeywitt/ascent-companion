"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Banner, Button, EmptyState, PageHeader, Spinner, Textarea } from "@/components/ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

// Human-friendly labels for the tool activity chip.
const TOOL_LABEL: Record<string, string> = {
  list_jobs: "Looking up jobs",
  get_unbilled: "Checking unbilled",
  get_coding_queue: "Reading the coding queue",
  get_bill_detail: "Opening a bill",
  get_job_budget: "Reading the budget",
  get_cost_to_complete: "Computing cost to complete",
  list_vendors: "Looking up vendors",
};

function Chat() {
  const search = useSearchParams();
  const jobId = (search.get("jobId") ?? "").trim();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState(""); // live tool activity
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, status]);

  function appendToAssistant(delta: string) {
    setMessages((prev) => {
      const copy = prev.slice();
      const last = copy[copy.length - 1];
      if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + delta };
      return copy;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setError("");
    setStatus("");
    setInput("");

    const outgoing: Msg[] = [...messages, { role: "user", content: text }];
    // Show the user turn + an empty assistant turn we stream into.
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: outgoing, jobId: jobId || undefined }),
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Request failed (HTTP ${res.status}).`);
        // Drop the empty assistant placeholder.
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let sawText = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: {
            type: string;
            text?: string;
            name?: string;
            error?: string;
          };
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "text" && ev.text) {
            sawText = true;
            setStatus("");
            appendToAssistant(ev.text);
          } else if (ev.type === "tool" && ev.name) {
            setStatus((TOOL_LABEL[ev.name] ?? ev.name) + "…");
          } else if (ev.type === "error" && ev.error) {
            setError(ev.error);
          } else if (ev.type === "done") {
            setStatus("");
          }
        }
      }
      // If the model answered purely by ending without text, leave a hint.
      if (!sawText) {
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && !last.content) {
            copy[copy.length - 1] = { ...last, content: "(no answer returned)" };
          }
          return copy;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setMessages((prev) => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));
    } finally {
      setStreaming(false);
      setStatus("");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <main className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-xl flex-col px-4 pb-4 pt-6">
      <PageHeader
        title="Assistant"
        description={
          jobId
            ? "Ask about the selected job's bills, budget, or unbilled amounts."
            : "Ask about jobs, vendor bills, budgets, and unbilled amounts. Pick a job above to scope questions to it."
        }
      />

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
        {messages.length === 0 && (
          <EmptyState>
            Try: “What&apos;s unbilled on the Miller job?”, “Show the coding queue”, or “Which
            cost codes are over budget on this job?”
          </EmptyState>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm " +
                (m.role === "user"
                  ? "bg-accent text-accent-fg"
                  : "border border-line bg-white  dark:bg-ink-raised")
              }
            >
              {m.content || (streaming && i === messages.length - 1 ? <Spinner /> : "")}
            </div>
          </div>
        ))}

        {streaming && status && (
          <p className="flex items-center gap-2 pl-1 text-xs text-neutral-500">
            <Spinner />
            {status}
          </p>
        )}
      </div>

      {error && (
        <Banner tone="error" className="mt-2">
          {error}
        </Banner>
      )}

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask about a job, bill, budget…"
          disabled={streaming}
          className="resize-none"
        />
        <Button onClick={send} disabled={streaming || !input.trim()} size="lg">
          {streaming ? <Spinner /> : "Send"}
        </Button>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Chat />
    </Suspense>
  );
}
